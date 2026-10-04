"""오프라인 테스트 — 네트워크 없이 파서·트랙 선택·이어받기·차단 대기를 검증한다.

    python -m unittest ytcc/test_cc_downloader.py
"""
import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cc_downloader as cc  # noqa: E402
from yt_dlp.utils import DownloadError  # noqa: E402

JSON3_ASR = json.dumps({'events': [
    {'tStartMs': 0, 'dDurationMs': 99999, 'id': 1, 'wpWinPosId': 1},           # 창 설정(글자 없음)
    {'tStartMs': 0, 'dDurationMs': 4000, 'segs': [{'utf8': '안녕하세요'}, {'utf8': ' 여러분', 'tOffsetMs': 500}]},
    {'tStartMs': 2500, 'dDurationMs': 50, 'aAppend': 1, 'segs': [{'utf8': '\n'}]},  # 줄바꿈만
    {'tStartMs': 2500, 'dDurationMs': 3000, 'segs': [{'utf8': '오늘은'}, {'utf8': ' 자막 이야기'}]},
    {'tStartMs': 3_725_000, 'dDurationMs': 1500, 'segs': [{'utf8': '끝 &amp; 마무리'}]},
]}).encode()

VTT_ROLLING = """WEBVTT
Kind: captions
Language: en

00:00:00.320 --> 00:00:02.870 align:start position:0%

hello<00:00:00.640><c> everyone</c>

00:00:02.870 --> 00:00:02.880 align:start position:0%
hello everyone


00:00:02.880 --> 00:00:05.000 align:start position:0%
hello everyone
today<00:00:03.200><c> we</c><00:00:03.500><c> talk</c>

00:00:05.000 --> 00:00:05.010 align:start position:0%
today we talk

"""

VTT_MANUAL = """WEBVTT

1
00:01:00.000 --> 00:01:02.500
첫째 줄
<i>둘째 줄</i>

2
01:00:00,000 --> 01:00:01,000
Tom &amp; Jerry
"""


def fmts(lang, tlang=False):
    q = f'&tlang={lang}' if tlang else ''
    return [{'ext': e, 'url': f'https://yt/api/timedtext?lang=x{q}&fmt={e}'} for e in ('json3', 'srv3', 'vtt')]


class ParserTest(unittest.TestCase):
    def test_json3_asr(self):
        cues = cc.parse_json3(JSON3_ASR)
        self.assertEqual([t for _, _, t in cues], ['안녕하세요 여러분', '오늘은 자막 이야기', '끝 &amp; 마무리'])
        self.assertEqual(cues[0][:2], (0, 2500))  # 다음 자막 시작에서 끝을 자른다
        self.assertIn('01:02:05,000 --> 01:02:06,500', cc.to_srt(cues))
        self.assertTrue(cc.to_txt(cues).startswith('[00:00:00] 안녕하세요 여러분\n[00:00:02] 오늘은'))

    def test_vtt_rolling_has_no_repeats(self):
        cues = cc.parse_vtt(VTT_ROLLING)
        self.assertEqual([t for _, _, t in cues], ['hello everyone', 'today we talk'])
        self.assertEqual(cues[0][0], 320)
        self.assertEqual(cues[1][0], 2880)

    def test_vtt_manual_multiline_and_hour_comma(self):
        cues = cc.parse_vtt(VTT_MANUAL)
        self.assertEqual(cues[0], (60000, 62500, '첫째 줄 둘째 줄'))
        self.assertEqual(cues[1], (3_600_000, 3_601_000, 'Tom & Jerry'))


class PickTrackTest(unittest.TestCase):
    def info(self, **kw):
        return {'language': kw.get('language'), 'subtitles': kw.get('subtitles', {}),
                'automatic_captions': kw.get('autos', {})}

    def test_manual_beats_auto(self):
        info = self.info(language='ko', subtitles={'ko': fmts('ko'), 'live_chat': fmts('x')},
                         autos={'ko-orig': fmts('ko'), 'ko': fmts('ko'), 'en': fmts('en', True)})
        kind, lang, fmt = cc.pick_track(info, ['orig'])
        self.assertEqual((kind, lang, fmt['ext']), ('manual', 'ko', 'json3'))

    def test_orig_auto_when_no_manual(self):
        info = self.info(autos={'en-orig': fmts('en'), 'en': fmts('en'), 'ko': fmts('ko', True)})
        self.assertEqual(cc.pick_track(info, ['orig'])[:2], ('auto', 'en'))

    def test_specific_lang_region_match_and_translate_opt_in(self):
        info = self.info(language='en', subtitles={'ko-KR': fmts('ko')}, autos={'en-orig': fmts('en')})
        self.assertEqual(cc.pick_track(info, ['ko'])[:2], ('manual', 'ko-KR'))
        info = self.info(language='en', autos={'en-orig': fmts('en'), 'en': fmts('en'), 'ko': fmts('ko', True)})
        self.assertIsNone(cc.pick_track(info, ['ko']))
        self.assertEqual(cc.pick_track(info, ['ko'], allow_translate=True)[:2], ('translated', 'ko'))
        self.assertEqual(cc.pick_track(info, ['ko', 'orig'])[:2], ('auto', 'en'))

    def test_old_ytdlp_without_orig_label(self):
        info = self.info(autos={'ja': fmts('ja'), 'ko': fmts('ko', True)})
        self.assertEqual(cc.pick_track(info, ['orig'])[:2], ('auto', 'ja'))

    def test_vtt_only_and_none(self):
        info = self.info(subtitles={'en': [{'ext': 'vtt', 'url': 'u'}]})
        self.assertEqual(cc.pick_track(info, ['orig'])[2]['ext'], 'vtt')
        self.assertIsNone(cc.pick_track(self.info(), ['orig']))


class MiscTest(unittest.TestCase):
    def test_safe_name(self):
        self.assertEqual(cc.safe_name('a/b:c*?"<>|d.  '), 'a b c d')
        self.assertEqual(cc.safe_name(''), '제목없음')
        self.assertEqual(len(cc.safe_name('가' * 300)), 80)

    def test_classify(self):
        self.assertEqual(cc.classify_error("Sign in to confirm you're not a bot"), 'blocked')
        self.assertEqual(cc.classify_error('ERROR: [youtube] x: Private video'), 'unavailable')
        self.assertEqual(cc.classify_error('Connection reset'), 'error')


# ───────── 가짜 yt-dlp 로 전체 흐름 ─────────

class FakeResp:
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def read(self):
        return self.data


class FakeYDL:
    calls = []
    block_once = set()

    VIDEOS = {
        'aaaaaaaaaaa': {'title': '첫 영상', 'language': 'ko', 'subtitles': {}, 'automatic_captions': {'ko-orig': fmts('ko')}},
        'bbbbbbbbbbb': {'title': '자막 없는 영상', 'subtitles': {}, 'automatic_captions': {}},
        'ccccccccccc': 'Private video',
        'ddddddddddd': {'title': '두번째/영상?', 'subtitles': {'en': fmts('en')}, 'automatic_captions': {}},
    }

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def extract_info(self, url, download=False, process=True):
        if self.opts.get('extract_flat'):
            return {'title': '테스트 재생목록', 'entries': [{'id': k, 'title': (v['title'] if isinstance(v, dict) else '비공개')}
                                                    for k, v in self.VIDEOS.items()]}
        vid = url.rsplit('=', 1)[1]
        self.calls.append(vid)
        if vid in self.block_once:
            self.block_once.discard(vid)
            raise DownloadError("ERROR: [youtube] x: Sign in to confirm you're not a bot")
        v = self.VIDEOS[vid]
        if isinstance(v, str):
            raise DownloadError(f'ERROR: [youtube] {vid}: {v}')
        return {'id': vid, **v}

    def _parse_impersonate_targets(self, imp):
        return None, []

    def urlopen(self, req):
        return FakeResp(JSON3_ASR)


class EndToEndTest(unittest.TestCase):
    def args(self, out, **kw):
        base = dict(url='https://www.youtube.com/playlist?list=PLx', lang='orig', translate=False, out=out,
                    sleep=0, cookies_from_browser=None, cookies=None, retry=False, max=None)
        return argparse.Namespace(**{**base, **kw})

    def test_full_run_block_wait_and_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            FakeYDL.calls, FakeYDL.block_once = [], {'ddddddddddd'}
            waits = []
            self.assertEqual(cc.run(self.args(tmp), FakeYDL, sleep=waits.append), 0)
            folder = Path(tmp) / '테스트 재생목록'
            self.assertIn(60, waits)  # 차단 → 1분 대기 후 같은 영상 재시도
            self.assertEqual(FakeYDL.calls.count('ddddddddddd'), 2)
            self.assertTrue((folder / '0001 첫 영상 [aaaaaaaaaaa].srt').is_file())
            txt = (folder / '0004 두번째 영상 [ddddddddddd].txt').read_text(encoding='utf-8')
            self.assertIn('# 자막: en (업로더 자막)', txt)
            self.assertIn('[00:00:02] 오늘은 자막 이야기', txt)
            state = json.loads((folder / '_진행상황.json').read_text(encoding='utf-8'))
            self.assertEqual({k: v['status'] for k, v in state.items()},
                             {'aaaaaaaaaaa': 'ok', 'bbbbbbbbbbb': 'nocc', 'ccccccccccc': 'unavailable', 'ddddddddddd': 'ok'})
            merged = (folder / '_전체합본.txt').read_text(encoding='utf-8')
            self.assertLess(merged.index('첫 영상'), merged.index('두번째'))
            csv_text = (folder / '_목록.csv').read_text(encoding='utf-8-sig')
            self.assertIn('볼 수 없는 영상', csv_text)

            # 다시 실행: 끝난 영상은 건너뛴다
            FakeYDL.calls = []
            cc.run(self.args(tmp), FakeYDL, sleep=lambda s: None)
            self.assertEqual(FakeYDL.calls, [])
            # --retry: 자막 없음·볼 수 없음만 다시
            cc.run(self.args(tmp, retry=True), FakeYDL, sleep=lambda s: None)
            self.assertEqual(sorted(FakeYDL.calls), ['bbbbbbbbbbb', 'ccccccccccc'])

    def test_stops_after_persistent_block(self):
        class AlwaysBlocked(FakeYDL):
            def extract_info(self, url, download=False, process=True):
                if self.opts.get('extract_flat'):
                    return super().extract_info(url)
                raise DownloadError('ERROR: HTTP Error 429: Too Many Requests')

        with tempfile.TemporaryDirectory() as tmp:
            waits = []
            self.assertEqual(cc.run(self.args(tmp), AlwaysBlocked, sleep=waits.append), 1)
            self.assertEqual(waits, [60, 120, 240, 480, 960, 1800])


if __name__ == '__main__':
    unittest.main()
