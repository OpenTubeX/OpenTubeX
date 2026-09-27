#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/ios/App/Python.xcframework"
packages="$root/ios/App/python-packages"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

if [[ ! -d "$runtime" ]]; then
  gh release download 3.14-b11 --repo beeware/Python-Apple-support \
    --pattern 'Python-3.14-iOS-support.b11.tar.gz' --dir "$scratch"
  tar -xzf "$scratch/Python-3.14-iOS-support.b11.tar.gz" -C "$scratch"
  mv "$scratch/Python.xcframework" "$runtime"
fi

if [[ ! -d "$packages/yt_dlp" || ! -d "$packages/yt_dlp_ejs" || ! -f "$packages/yt_dlp_plugins/extractor/webkit_jsi.py" ]]; then
  python3 -m pip download --only-binary=:all: --no-deps --dest "$scratch" \
    'yt-dlp==2026.8.19' 'yt-dlp-ejs==0.8.0' 'yt-dlp-apple-webkit-jsi==0.1.1'
  mkdir -p "$packages"
  python3 - "$scratch" "$packages" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys

for wheel in Path(sys.argv[1]).glob('*.whl'):
    with ZipFile(wheel) as archive:
        archive.extractall(sys.argv[2])
PY
fi
