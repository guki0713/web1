#!/usr/bin/env python3
"""workout/src/ 를 파일 하나짜리 HTML로 합쳐 workout/index.html 로 낸다.

CSS·JS를 HTML 안에 그대로 삽입하므로, 결과물 1개만 있으면 어디서든(휴대폰 포함)
열린다. 폴더 구조를 신경 쓸 필요가 없고, GitHub Pages에서도 주소가 짧아진다.

사용법:
    python3 tools/build_single_file.py            # workout/index.html 생성
    python3 tools/build_single_file.py -o 경로.html
"""

import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "workout" / "src"
OUT = ROOT / "workout" / "index.html"


def build():
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "style.css").read_text(encoding="utf-8")
    history = (SRC / "history.js").read_text(encoding="utf-8")
    app = (SRC / "app.js").read_text(encoding="utf-8")

    # 스크립트 안의 </script> 는 HTML 파서가 먼저 잡아먹으므로 분리해서 넣는다
    def safe(js):
        return js.replace("</script>", "<\\/script>")

    html = html.replace('<link rel="stylesheet" href="style.css">',
                        "<style>\n" + css + "</style>")
    html = html.replace('<script src="history.js"></script>\n  <script src="app.js"></script>',
                        "<script>\n" + safe(history) + "\n" + safe(app) + "</script>")
    if "<style>" not in html or "window.WORKOUT_HISTORY" not in html:
        sys.exit("삽입 실패: workout/index.html 의 link/script 태그가 예상과 다릅니다")
    return html


def strip_skeleton(html):
    """<!doctype>/<html>/<head>/<body> 껍데기를 벗겨 본문 조각만 남긴다.

    Claude Artifact로 게시할 때는 호스트가 껍데기를 씌우므로 본문만 넘겨야 한다.
    <title>은 탭 이름으로 쓰이도록 남긴다.
    """
    title = "운동일지"
    body = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
    return f"<title>{title}</title>\n" + body.strip() + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default=str(OUT))
    ap.add_argument("--artifact", action="store_true",
                    help="Claude Artifact 게시용으로 html/body 껍데기를 제거")
    args = ap.parse_args()
    html = build()
    if args.artifact:
        html = strip_skeleton(html)
    out = pathlib.Path(args.output)
    out.write_text(html, encoding="utf-8")
    print(f"{out} 생성 ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
