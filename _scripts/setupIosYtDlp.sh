#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/ios/App/Python.xcframework"
packages="$root/ios/App/python-packages"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
release_tag=3.14-b11
runtime_stamp="$runtime/.opentubex-release-tag"
pins=('yt-dlp==2026.8.19' 'yt-dlp-ejs==0.8.0' 'yt-dlp-apple-webkit-jsi==0.1.1' 'certifi==2026.7.22')
package_stamp="$packages/.pins"
webkit_patch="$root/_scripts/iosYtDlpWebkitNavigation.patch"
package_version="${pins[*]} $(shasum -a 256 "$webkit_patch" | cut -d' ' -f1)"

if [[ ! -d "$runtime" || "$(cat "$runtime_stamp" 2>/dev/null || true)" != "$release_tag" ]]; then
  gh release download "$release_tag" --repo beeware/Python-Apple-support \
    --pattern 'Python-3.14-iOS-support.b11.tar.gz' --dir "$scratch"
  tar -xzf "$scratch/Python-3.14-iOS-support.b11.tar.gz" -C "$scratch"
  rm -rf "$runtime"
  mv "$scratch/Python.xcframework" "$runtime"
  printf '%s' "$release_tag" > "$runtime_stamp"
fi

if [[ "$(cat "$package_stamp" 2>/dev/null || true)" != "$package_version" ||
      ! -d "$packages/yt_dlp" || ! -d "$packages/yt_dlp_ejs" ||
      ! -f "$packages/yt_dlp_plugins/extractor/webkit_jsi.py" ||
      ! -f "$packages/certifi/cacert.pem" ]]; then
  python3 -m pip download --python-version 3.14 --only-binary=:all: --no-deps --dest "$scratch" "${pins[@]}"
  rm -rf "$packages"
  mkdir -p "$packages"
  python3 - "$scratch" "$packages" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import sys

for wheel in Path(sys.argv[1]).glob('*.whl'):
    with ZipFile(wheel) as archive:
        archive.extractall(sys.argv[2])
PY
  patch -d "$packages" -p1 < "$webkit_patch"
  printf '%s' "$package_version" > "$package_stamp"
fi
