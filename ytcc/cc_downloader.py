#!/usr/bin/env python3
"""유튜브 재생목록 자막(CC) 일괄 다운로더.

재생목록 주소 하나로 모든 영상의 자막을 타임라인과 함께 받는다.
개수 제한 없음 · 중단 후 다시 실행하면 이어받기 · 차단(429/봇 확인) 시 자동 대기.

    python cc_downloader.py "https://www.youtube.com/playlist?list=..."
    python cc_downloader.py            # 주소를 물어본다

영상마다 만드는 파일
    0001 제목 [영상ID].srt   타임라인 자막 (자막 편집기·플레이어용)
    0001 제목 [영상ID].txt   [00:01:23] 형식 타임라인 텍스트 (읽기·AI 입력용)
재생목록 폴더 공통
    _전체합본.txt  모든 영상 .txt를 재생목록 순서로 이어 붙인 것
    _목록.csv      영상별 상태 (엑셀에서 바로 열림)
    _진행상황.json 이어받기용 기록 — 지우면 처음부터 다시 받는다
"""
from __future__ import annotations

import argparse
import csv
import html
import importlib.util
import json
import random
import re
import shutil
import sys
import time
from pathlib import Path

# 다시 실행해도 재시도하지 않는 상태. 'error'는 다음 실행 때 다시 시도한다.
FINAL_STATUSES = {'ok', 'nocc', 'unavailable'}
STATUS_KO = {'ok': '완료', 'nocc': '자막 없음', 'unavailable': '볼 수 없는 영상', 'error': '오류(재실행 시 재시도)'}
KIND_KO = {'manual': '업로더 자막', 'auto': '자동 생성', 'translated': '자동 번역'}

BLOCK_PATTERNS = ('sign in to confirm', 'not a bot', 'http error 429', 'too many requests', 'rate-limit', 'rate limit')
UNAVAILABLE_PATTERNS = ('private video', 'video unavailable', 'has been removed', 'members-only', 'members only',
                        'account associated with this video has been terminated', 'no longer available', 'is not available')
MAX_BLOCK_WAITS = 6  # 1·2·4·8·16·30분 대기 후에도 막히면 멈춘다(누적 약 1시간)


class Blocked(Exception):
    """YouTube가 요청을 막았다 — 기다렸다 같은 영상을 다시 시도한다."""


# ───────────────────────── 시간 표기 ─────────────────────────

def srt_time(ms: int) -> str:
    ms = max(0, int(ms))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def clock(ms: int) -> str:
    return srt_time(ms)[:8]


def _vtt_ms(stamp: str) -> int:
    parts = stamp.strip().replace(',', '.').split(':')
    sec = float(parts[-1])
    mins = int(parts[-2]) if len(parts) >= 2 else 0
    hours = int(parts[-3]) if len(parts) >= 3 else 0
    return round(((hours * 60 + mins) * 60 + sec) * 1000)


# ───────────────────────── 자막 파싱 ─────────────────────────
# 모든 파서는 [(시작ms, 끝ms, 문장)] 를 돌려주고 tidy()가 정리한다.

def tidy(cues):
    """빈 줄 제거, 시간순 정렬, 다음 자막과 겹치는 끝시간 자르기, 연속 중복 제거."""
    cues = sorted((s, e, ' '.join(t.split())) for s, e, t in cues)
    out = []
    for s, e, t in cues:
        if not t:
            continue
        if out and out[-1][2] == t:  # 같은 문장이 이어서 반복되면 하나로
            out[-1] = (out[-1][0], max(out[-1][1], e), t)
            continue
        out.append((s, e, t))
    for i in range(len(out) - 1):
        s, e, t = out[i]
        nxt = out[i + 1][0]
        if e > nxt > s:
            out[i] = (s, nxt, t)
    return [(s, max(e, s + 1), t) for s, e, t in out]


def parse_json3(data: bytes | str):
    doc = json.loads(data)
    cues = []
    for ev in doc.get('events') or []:
        segs = ev.get('segs')
        if not segs:
            continue
        text = ''.join(seg.get('utf8', '') for seg in segs).replace('\n', ' ').strip()
        start = ev.get('tStartMs', 0)
        cues.append((start, start + ev.get('dDurationMs', 0), text))
    return tidy(cues)


_VTT_TIMING = re.compile(r'^\s*((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)')
_TAG = re.compile(r'<[^>]*>')


def parse_vtt(text: str):
    """VTT 자막. 자동 생성 자막의 '굴러가는'(앞 줄 반복) 형식도 중복 없이 펼친다."""
    rolling = '<c>' in text or re.search(r'<\d+:\d+[\d:.]*>', text) is not None
    # 줄 단위로 읽는다: 자동 자막은 본문에 '공백 한 칸 줄'이 있어 빈 줄로 블록을 나누면 깨진다.
    lines = text.replace('﻿', '').splitlines()
    raw = []  # [(시작, 끝, 본문 줄들)]
    for i, ln in enumerate(lines):
        m = _VTT_TIMING.match(ln)
        if m:
            if raw and i >= 2 and lines[i - 1].strip() and not lines[i - 2].strip():
                raw[-1][2].pop()  # 바로 앞 줄은 앞 자막 본문이 아니라 이번 자막의 번호/ID
            raw.append((_vtt_ms(m.group(1)), _vtt_ms(m.group(2)), []))
        elif raw:
            raw[-1][2].append(ln)
    cues, recent = [], []
    for start, end, body in raw:
        body = [html.unescape(_TAG.sub('', ln)).strip() for ln in body]
        body = [ln for ln in body if ln]
        if not rolling:
            cues.append((start, end, ' '.join(body)))
            continue
        for ln in body:
            if ln in recent:
                continue
            cues.append((start, end, ln))
            recent = (recent + [ln])[-3:]
    return tidy(cues)


def parse_subtitle(ext: str, data: bytes):
    if ext == 'json3':
        return parse_json3(data)
    return parse_vtt(data.decode('utf-8', errors='replace'))


def to_srt(cues) -> str:
    return '\n'.join(f'{i}\n{srt_time(s)} --> {srt_time(e)}\n{t}\n' for i, (s, e, t) in enumerate(cues, 1))


def to_txt(cues) -> str:
    return ''.join(f'[{clock(s)}] {t}\n' for s, _, t in cues)


# ───────────────────────── 자막 트랙 고르기 ─────────────────────────

def _match(tracks: dict, lang: str):
    """'ko' 요청에 'ko' 우선, 없으면 'ko-KR' 같은 지역 변형."""
    if lang in tracks:
        return lang
    return next((k for k in tracks if k.lower().startswith(lang.lower() + '-')), None)


def _best_format(fmts):
    by_ext = {f.get('ext'): f for f in fmts or [] if f.get('url')}
    return by_ext.get('json3') or by_ext.get('vtt')


def pick_track(info: dict, langs: list[str], allow_translate: bool = False):
    """우선순위: 업로더 자막 > 원어 자동 생성 자막 > (허용 시) 자동 번역 자막.

    langs 의 'orig' 는 '영상의 원래 언어'. 반환: (종류, 언어코드, 포맷 dict) 또는 None.
    """
    manual = {k: v for k, v in (info.get('subtitles') or {}).items() if k != 'live_chat'}
    autos = info.get('automatic_captions') or {}
    orig_auto = {k[:-5]: v for k, v in autos.items() if k.endswith('-orig')}
    if not orig_auto:  # 구버전 yt-dlp: 번역(tlang)이 아닌 자동 자막이 원어
        orig_auto = {k: v for k, v in autos.items()
                     if (f := _best_format(v)) and 'tlang=' not in f['url']}

    def found(kind, tracks, key):
        fmt = _best_format(tracks[key]) if key else None
        return (kind, key, fmt) if fmt else None

    for lang in langs:
        if lang == 'orig':
            orig = info.get('language') or next(iter(orig_auto), None)
            hit = (orig and found('manual', manual, _match(manual, orig))) \
                or (orig and found('auto', orig_auto, _match(orig_auto, orig))) \
                or found('auto', orig_auto, next(iter(orig_auto), None)) \
                or found('manual', manual, next(iter(manual), None))
        else:
            hit = found('manual', manual, _match(manual, lang)) or found('auto', orig_auto, _match(orig_auto, lang))
        if hit:
            return hit
    if allow_translate:
        for lang in langs:
            if lang != 'orig' and (hit := found('translated', autos, _match(autos, lang))):
                return hit
    return None


# ───────────────────────── 파일·상태 ─────────────────────────

def safe_name(name: str, limit: int = 80) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', name or '')
    name = ' '.join(name.split()).strip(' .')
    return (name[:limit].rstrip(' .') or '제목없음')


def load_state(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_state(path: Path, state: dict):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(path)  # 저장 도중 꺼져도 기존 기록이 깨지지 않게


def classify_error(msg: str) -> str:
    low = msg.lower()
    if any(p in low for p in BLOCK_PATTERNS):
        return 'blocked'
    if any(p in low for p in UNAVAILABLE_PATTERNS):
        return 'unavailable'
    return 'error'


class QuietLogger:
    """yt-dlp 메시지 중 경고만, 같은 내용은 한 번만 보여준다."""

    def __init__(self):
        self.seen = set()

    def debug(self, msg):
        pass

    info = debug

    def warning(self, msg):
        key = re.sub(r'[\w-]{11}', '', msg)[:120]  # 영상ID만 다른 같은 경고는 한 번만
        if key not in self.seen:
            self.seen.add(key)
            print(f'  [경고] {msg[:300]}', flush=True)

    def error(self, msg):
        pass  # 예외로 받아서 직접 분류·표시한다


# ───────────────────────── 다운로드 ─────────────────────────

def ydl_options(args) -> dict:
    opts = {
        'quiet': True, 'no_warnings': False, 'logger': QuietLogger(),
        'skip_download': True, 'noplaylist': False, 'ignore_no_formats_error': True,
        'retries': 3, 'extractor_retries': 3, 'socket_timeout': 30,
        'remote_components': ['ejs:github'],
    }
    runtimes = {name: {} for name in ('deno', 'node', 'bun') if shutil.which(name)}
    if runtimes:
        opts['js_runtimes'] = runtimes
    if args.cookies_from_browser:
        opts['cookiesfrombrowser'] = (args.cookies_from_browser, None, None, None)
    if args.cookies:
        opts['cookiefile'] = args.cookies
    return opts


def fetch(ydl, fmt: dict) -> bytes:
    from yt_dlp.networking import Request
    from yt_dlp.networking.exceptions import HTTPError

    ext = {}
    if fmt.get('impersonate'):  # yt-dlp가 YouTube 자막 요청에 쓰는 브라우저 흉내(가능할 때만)
        try:
            target, _ = ydl._parse_impersonate_targets(fmt['impersonate'])
            if target:
                ext['impersonate'] = target
        except Exception:
            pass
    try:
        with ydl.urlopen(Request(fmt['url'], headers=fmt.get('http_headers') or {}, extensions=ext)) as resp:
            return resp.read()
    except HTTPError as e:
        if e.status == 429:
            raise Blocked('HTTP 429 Too Many Requests') from e
        raise


def process_video(ydl, url: str, langs, allow_translate) -> tuple[str, dict, list]:
    from yt_dlp.utils import DownloadError

    try:  # process=False: 영상 포맷 처리를 건너뛴다 — 자막 목록만 필요하고, 포맷 문제로 실패하지 않는다
        info = ydl.extract_info(url, download=False, process=False)
    except DownloadError as e:
        kind = classify_error(str(e))
        if kind == 'blocked':
            raise Blocked(str(e)) from e
        return kind, {'msg': str(e).replace('ERROR: ', '')[:200]}, []
    track = pick_track(info, langs, allow_translate)
    meta = {'title': info.get('title'), 'duration': info.get('duration'), 'upload_date': info.get('upload_date')}
    if not track:
        return 'nocc', meta, []
    kind, lang, fmt = track
    cues = parse_subtitle(fmt['ext'], fetch(ydl, fmt))
    if not cues:
        return 'nocc', meta, []
    return 'ok', {**meta, 'lang': lang, 'kind': kind}, cues


def write_video_files(folder: Path, base: str, url: str, meta: dict, cues):
    (folder / f'{base}.srt').write_text(to_srt(cues), encoding='utf-8')
    head = (f"# {meta.get('title') or ''}\n# {url}\n"
            f"# 자막: {meta.get('lang')} ({KIND_KO.get(meta.get('kind'), meta.get('kind'))})\n\n")
    (folder / f'{base}.txt').write_text(head + to_txt(cues), encoding='utf-8')


def write_summaries(folder: Path, entries, state: dict):
    with open(folder / '_목록.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['번호', '제목', '주소', '상태', '자막 언어', '자막 종류', '길이(분)', '파일', '메모'])
        for i, e in enumerate(entries, 1):
            st = state.get(e['id'], {})
            dur = st.get('duration') or e.get('duration')
            w.writerow([i, st.get('title') or e.get('title'), e['url'], STATUS_KO.get(st.get('status'), '미처리'),
                        st.get('lang', ''), KIND_KO.get(st.get('kind'), ''), round(dur / 60, 1) if dur else '',
                        st.get('file', ''), st.get('msg', '')])
    with open(folder / '_전체합본.txt', 'w', encoding='utf-8') as out:
        for e in entries:
            st = state.get(e['id'], {})
            path = folder / f"{st.get('file', '')}.txt"
            if st.get('status') == 'ok' and path.is_file():
                out.write('=' * 60 + '\n' + path.read_text(encoding='utf-8') + '\n')


def list_playlist(opts: dict, url: str, ydl_cls):
    with ydl_cls({**opts, 'extract_flat': 'in_playlist'}) as ydl:
        pl = ydl.extract_info(url, download=False)
    entries = []
    for e in pl.get('entries') or [pl]:
        if e and e.get('id'):
            entries.append({'id': e['id'], 'title': e.get('title'), 'duration': e.get('duration'),
                            'url': f"https://www.youtube.com/watch?v={e['id']}"})
    return (pl.get('title') or pl.get('id') or 'playlist'), entries


def run(args, ydl_cls=None, sleep=time.sleep) -> int:
    if ydl_cls is None:
        from yt_dlp import YoutubeDL as ydl_cls
    opts = ydl_options(args)
    print('재생목록을 읽는 중...', flush=True)
    try:
        title, entries = list_playlist(opts, args.url, ydl_cls)
    except Exception as e:
        print(f'재생목록을 읽지 못했습니다: {str(e).replace("ERROR: ", "")[:300]}\n'
              '주소가 맞는지, 재생목록이 공개(또는 일부공개)인지, 인터넷 연결을 확인하세요.', flush=True)
        return 2
    if args.max:
        entries = entries[:args.max]
    folder = Path(args.out) / safe_name(title)
    folder.mkdir(parents=True, exist_ok=True)
    state_path = folder / '_진행상황.json'
    state = load_state(state_path)
    langs = [x.strip() for x in args.lang.split(',') if x.strip()] or ['orig']
    retry = FINAL_STATUSES - {'ok'} if args.retry else set()

    todo = [(i, e) for i, e in enumerate(entries, 1)
            if state.get(e['id'], {}).get('status') not in FINAL_STATUSES - retry]
    print(f'"{title}" — 영상 {len(entries)}개, 이번에 받을 것 {len(todo)}개\n저장 위치: {folder.resolve()}\n', flush=True)

    counts = {'ok': 0, 'nocc': 0, 'unavailable': 0, 'error': 0}
    began, blocks, stopped = time.time(), 0, False
    with ydl_cls(opts) as ydl:
        try:
            n = 0
            while n < len(todo):
                i, e = todo[n]
                base = f"{i:04d} {safe_name(e.get('title'))} [{e['id']}]"
                prefix = f'[{n + 1}/{len(todo)}] {i:04d} {(e.get("title") or e["id"])[:50]}'
                try:
                    status, meta, cues = process_video(ydl, e['url'], langs, args.translate)
                except Blocked as b:
                    blocks += 1
                    if blocks > MAX_BLOCK_WAITS:
                        print(f'\n{prefix}\n  YouTube 차단이 계속됩니다. 여기서 멈춥니다. → README의 "차단될 때" 참고', flush=True)
                        stopped = True
                        break
                    wait = min(60 * 2 ** (blocks - 1), 1800)
                    print(f'{prefix}\n  YouTube가 잠시 막았습니다({str(b)[:80]}). {wait // 60}분 기다린 뒤 이어갑니다...', flush=True)
                    sleep(wait)
                    continue  # 같은 영상 다시
                except Exception as ex:  # 네트워크 끊김 등 — 기록만 하고 다음 영상으로
                    status, meta, cues = 'error', {'msg': f'{type(ex).__name__}: {ex}'[:200]}, []
                blocks = 0
                if status == 'ok':
                    write_video_files(folder, base, e['url'], meta, cues)
                    meta['file'] = base
                state[e['id']] = {**meta, 'status': status}
                save_state(state_path, state)
                counts[status] += 1
                n += 1
                done_rate = (time.time() - began) / n
                eta = done_rate * (len(todo) - n) / 60
                detail = f"{meta.get('lang')}, {KIND_KO[meta['kind']]}, {len(cues)}줄" if status == 'ok' else meta.get('msg', '')
                print(f'{prefix}\n  → {STATUS_KO[status]} {detail}  (남은 예상 {eta:.0f}분)', flush=True)
                if n < len(todo):
                    sleep(random.uniform(args.sleep * 0.5, args.sleep * 1.5))
        except KeyboardInterrupt:
            print('\n중단했습니다. 다시 실행하면 이어서 받습니다.', flush=True)
            stopped = True

    write_summaries(folder, entries, state)
    total = {s: sum(1 for e in entries if state.get(e['id'], {}).get('status') == s) for s in STATUS_KO}
    print(f"\n이번 실행: 완료 {counts['ok']} · 자막 없음 {counts['nocc']} · 볼 수 없음 {counts['unavailable']} · 오류 {counts['error']}")
    print(f"전체 누적: 완료 {total['ok']}/{len(entries)} · 자막 없음 {total['nocc']} · 볼 수 없음 {total['unavailable']} · 오류 {total['error']}")
    left = len(entries) - total['ok'] - total['nocc'] - total['unavailable']
    if left:
        print(f'남은 {left}개는 같은 주소로 다시 실행하면 이어받습니다.')
    print(f'결과: {folder.resolve()}')
    return 1 if stopped else 0


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):  # 윈도우 콘솔에서 한글·특수문자 깨짐 방지
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(description='유튜브 재생목록의 자막(CC)을 타임라인과 함께 모두 받는다.')
    p.add_argument('url', nargs='?', help='재생목록 주소 (없으면 물어본다)')
    p.add_argument('--lang', default='orig',
                   help="받을 자막 언어, 쉼표로 우선순위. 'orig'=영상 원래 언어(기본). 예: ko,en")
    p.add_argument('--translate', action='store_true', help='원하는 언어가 없으면 유튜브 자동 번역 자막이라도 받기')
    p.add_argument('--out', default='자막', help='저장 폴더 (기본: ./자막)')
    p.add_argument('--sleep', type=float, default=3.0, help='영상 사이 대기 초 (기본 3, 차단이 잦으면 늘리기)')
    p.add_argument('--cookies-from-browser', metavar='BROWSER',
                   help='브라우저 로그인 쿠키 사용: chrome, edge, firefox, safari, whale 등 — 차단·연령제한 대응')
    p.add_argument('--cookies', metavar='FILE', help='cookies.txt 파일 사용')
    p.add_argument('--retry', action='store_true', help="'자막 없음'·'볼 수 없음'으로 기록된 영상도 다시 시도")
    p.add_argument('--max', type=int, help='앞에서부터 N개만 (시험용)')
    args = p.parse_args(argv)
    if not args.url:
        try:
            args.url = input('재생목록 주소를 붙여넣고 Enter: ').strip().strip('"\'')
        except EOFError:
            args.url = ''
    if not args.url:
        p.error('재생목록 주소가 필요합니다.')
    if importlib.util.find_spec('yt_dlp') is None:
        print('yt-dlp가 없습니다. 먼저 설치하세요:  python -m pip install -U "yt-dlp[default]"')
        return 2
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
