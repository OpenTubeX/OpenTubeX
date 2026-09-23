#!/usr/bin/env bash
set -euo pipefail

tag="$1"
version="${tag#v}"
max_attempts="${RELEASE_ASSET_MAX_ATTEMPTS:-60}"
retry_delay="${RELEASE_ASSET_RETRY_DELAY:-15}"

expected_assets=(
  "opentubex_${version}_amd64.deb"
  "opentubex_${version}_arm64.deb"
  "opentubex_${version}_armv7l.deb"
  "opentubex-${version}.amd64.rpm"
  "opentubex-${version}.arm64.rpm"
  "opentubex-${version}-linux-x64-portable.zip"
  "opentubex-${version}-linux-arm64-portable.zip"
  "opentubex-${version}-android-arm64-v8a.apk"
  "opentubex-${version}-android-armeabi-v7a.apk"
  "opentubex-${version}-android-x86.apk"
  "opentubex-${version}-android-x86_64.apk"
  "opentubex-${version}-android-universal.apk"
)

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  missing=()
  for asset in "${expected_assets[@]}"; do
    if ! wget --spider --quiet "https://github.com/OpenTubeX/OpenTubeX/releases/download/${tag}/${asset}"; then
      missing+=("$asset")
    fi
  done

  if (( ${#missing[@]} == 0 )); then
    echo "Release $tag serves all package assets."
    exit 0
  fi
  echo "Release $tag is missing ${#missing[@]} package assets (attempt $attempt/$max_attempts)."

  if (( attempt < max_attempts )); then
    sleep "$retry_delay"
  fi
done

echo "Release $tag did not serve the required package assets before dispatch." >&2
exit 1
