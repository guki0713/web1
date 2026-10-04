#!/bin/bash
# YouTube playlist CC downloader - macOS/Linux launcher (double-click in Finder)
cd "$(dirname "$0")" || exit 1

if [ ! -x .venv/bin/python ]; then
  echo "[1/2] First run: creating Python environment..."
  if ! python3 -m venv .venv; then
    echo "Python 3 is needed. Install it from https://www.python.org/downloads/ and run again."
    read -r -p "Press Enter to close"
    exit 1
  fi
fi

echo "[2/2] Updating yt-dlp (YouTube changes often, so this runs every time)..."
.venv/bin/python -m pip install -q -U "yt-dlp[default]"
.venv/bin/python -m pip install -q -U curl-cffi >/dev/null 2>&1

.venv/bin/python cc_downloader.py "$@"
echo
read -r -p "Press Enter to close"
