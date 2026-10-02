#!/usr/bin/env bash
set -euo pipefail

release_id="$1"
pattern="$2"
expected_count="$3"

release="$(gh api "repos/${GITHUB_REPOSITORY}/releases/${release_id}")"
urls="$(jq --raw-output --arg pattern "$pattern" \
  '.assets[] | select(.name | test($pattern)) | .browser_download_url' <<< "$release")"
mapfile -t assets <<< "$urls"
if [[ -z "$urls" || "${#assets[@]}" -ne "$expected_count" ]]; then
  echo "Expected $expected_count release assets matching $pattern." >&2
  exit 1
fi

for url in "${assets[@]}"; do
  bash "$(dirname "$0")/wait-for-release-asset.sh" "$url"
done
