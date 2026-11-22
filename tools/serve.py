#!/usr/bin/env python3
"""로컬에서 전체 기능으로 미리 보기 위한 간이 서버.

`file://`로 직접 열면 대부분은 동작하지만 서비스 워커(오프라인 지원)는
http(s) 주소에서만 등록된다. 그래서 수정한 내용을 제대로 확인하려면
GitHub Pages에 올리기 전에 이 서버로 먼저 띄워 보는 편이 안전하다.

캐시를 꺼 두므로, 새로고침하면 방금 고친 내용이 바로 보인다
(실제 GitHub Pages·서비스 워커는 이전 버전을 한동안 들고 있을 수 있다).

사용법:
    python3 tools/build_single_file.py   # 먼저 빌드
    python3 tools/serve.py               # http://localhost:8000 에서 확인
    python3 tools/serve.py -p 3000       # 다른 포트
"""

import argparse
import functools
import http.server
import pathlib
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-p", "--port", type=int, default=8000)
    ap.add_argument("--no-open", action="store_true", help="브라우저를 자동으로 열지 않는다")
    args = ap.parse_args()

    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    url = f"http://localhost:{args.port}/workout/"
    print(f"서빙 중: {url}  (Ctrl+C로 종료)")
    if not args.no_open:
        webbrowser.open(url)
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료합니다.")


if __name__ == "__main__":
    main()
