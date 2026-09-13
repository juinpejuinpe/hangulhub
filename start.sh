#!/bin/sh
# HangulHub launcher — sets up the local environment on first run, then starts
# the app at http://127.0.0.1:8765
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
  echo "First run: creating the local Python environment…"
  python3 -m venv .venv || exit 1
  .venv/bin/python -m pip install -r requirements.txt || exit 1
fi

echo "HangulHub starting at http://127.0.0.1:8765"
exec .venv/bin/python app.py
