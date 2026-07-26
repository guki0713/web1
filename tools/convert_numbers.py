#!/usr/bin/env python3
"""Apple Numbers 운동일지 → 운동일지 웹앱 데이터 변환기.

연도별 Numbers 파일(월별 시트, 1열=날짜, 이후 열=운동 항목)을 읽어
정규화된 JSON 배열로 변환한다. 웹앱의 시드 데이터(history.js) 생성과
'데이터' 탭의 JSON 가져오기 양쪽에 그대로 쓸 수 있다.

사용법:
    pip install numbers-parser
    python3 tools/convert_numbers.py 2026운동일지.numbers [추가파일...] \
        --js workout/data/history.js      # 웹앱 시드로 저장
    python3 tools/convert_numbers.py 2026운동일지.numbers -o out.json
                                          # 웹앱 '가져오기'용 JSON

출력 레코드: {"d": "2026-07-06", "ex": "pullup", "v": 50, "s": "5×10"}
  d  날짜 (ISO)
  ex 운동 키 (아래 HEADER_MAP 참고)
  v  수량 (회 또는 km)
  s  세트 표기 (셀에 수식으로 적어둔 "5×10+5×10" 등)

수식이 다른 셀을 참조하는 파생 열(푸시업=콤보+단독, 하체 합계, SUM 합계 행)은
자동으로 건너뛴다. 파생 값은 웹앱이 다시 계산한다.
"""

import argparse
import datetime
import json
import re
import sys
import warnings

warnings.filterwarnings("ignore")

try:
    from numbers_parser import Document
except ImportError:
    sys.exit("numbers-parser가 필요합니다: pip install numbers-parser")

# 헤더 문구(연도별로 조금씩 다름) → 정규화된 운동 키
HEADER_MAP = [
    (r"^턱걸이", "pullup"),
    (r"^(푸시업|팔굽혀펴기)$", "pushup"),          # 콤보/단독 분리 이전의 원시 기록
    (r"^(하체|맨몸하체|스쿼트)", "legs"),           # 〃
    (r"^러닝", "running"),
    (r"^복근", "abs"),
    (r"^중량스쿼트", "weighted_squat"),
    (r"^푸시업\s*\+", "combo_upper"),              # 푸시업+로우+해머컬 계열
    (r"^(밀프|스쿼트\+)", "combo_lower"),           # 밀프+스쿼트+카프 계열
    (r"^단독푸시업", "solo_pushup"),
    (r"^단독하체", "solo_legs"),
    (r"^딥스", "dips"),
]

CELL_REF = re.compile(r"[A-Z]+\d+")   # 다른 셀을 참조하는 수식 = 파생 열
MONTH_SHEET = re.compile(r"^(\d+)월$")  # '10월-1' 같은 복사본 시트는 제외


def canon(header):
    header = str(header or "").strip()
    if not header:
        return None
    for pattern, key in HEADER_MAP:
        if re.match(pattern, header):
            return key
    print(f"  경고: 매핑되지 않은 열 '{header}' — 건너뜀", file=sys.stderr)
    return None


def extract(path):
    doc = Document(path)
    entries = []
    for sheet in doc.sheets:
        m = MONTH_SHEET.match(sheet.name)
        if not m:
            continue
        month = int(m.group(1))
        table = sheet.tables[-1]
        keys = [canon(table.cell(0, c).value) for c in range(table.num_cols)]
        for r in range(1, table.num_rows):
            d = table.cell(r, 0).value
            if not isinstance(d, (datetime.datetime, datetime.date)):
                continue
            date = d.date() if isinstance(d, datetime.datetime) else d
            if date.month != month:   # 합계 행의 더미 날짜 제거
                continue
            for c in range(1, table.num_cols):
                if keys[c] is None:
                    continue
                cell = table.cell(r, c)
                value = cell.value
                formula = getattr(cell, "formula", None) or ""
                if formula and (CELL_REF.search(formula)
                                or formula.upper().startswith("SUM")):
                    continue          # 파생 셀
                if value is None or value == "" or not isinstance(value, (int, float)):
                    continue
                rec = {"d": date.isoformat(), "ex": keys[c],
                       "v": int(value) if float(value) % 1 == 0 else round(float(value), 3)}
                if formula:
                    rec["s"] = formula
                entries.append(rec)
    return entries


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", help=".numbers 파일 경로")
    ap.add_argument("-o", "--output", help="JSON 출력 경로 (기본: 표준출력)")
    ap.add_argument("--js", help="웹앱 시드(history.js) 형식으로 저장할 경로")
    args = ap.parse_args()

    merged, seen = [], set()
    for path in args.files:
        entries = extract(path)
        print(f"{path}: {len(entries)}건", file=sys.stderr)
        for e in entries:
            key = (e["d"], e["ex"], e["v"], e.get("s"))
            if key not in seen:
                seen.add(key)
                merged.append(e)
    merged.sort(key=lambda e: (e["d"], e["ex"]))
    payload = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))

    if args.js:
        with open(args.js, "w", encoding="utf-8") as f:
            f.write("// tools/convert_numbers.py 로 생성된 시드 데이터\n")
            f.write("window.WORKOUT_HISTORY=" + payload + ";\n")
        print(f"{args.js} 저장 ({len(merged)}건)", file=sys.stderr)
    elif args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"{args.output} 저장 ({len(merged)}건)", file=sys.stderr)
    else:
        print(payload)


if __name__ == "__main__":
    main()
