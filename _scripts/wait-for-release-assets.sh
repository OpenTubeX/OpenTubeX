#!/usr/bin/env bash
set -euo pipefail

release_id="$1"
pattern="$2"
expected_count="$3"
max_attempts="${RELEASE_ASSET_MAX_ATTEMPTS:-60}"
retry_delay="${RELEASE_ASSET_RETRY_DELAY:-15}"

urls=''
assets=()
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if release="$(gh api "repos/${GITHUB_REPOSITORY}/releases/${release_id}")" &&
    urls="$(jq --raw-output --arg pattern "$pattern" \
      '.assets[] | select(.name | test($pattern)) | .browser_download_url' <<< "$release")"; then
    mapfile -t assets <<< "$urls"
    if [[ -n "$urls" && "${#assets[@]}" -eq "$expected_count" ]]; then
      break
    fi
  fi
  echo "Release metadata is incomplete (attempt $attempt/$max_attempts): $release_id"
  if (( attempt < max_attempts )); then
    sleep "$retry_delay"
  fi
done
if [[ -z "$urls" || "${#assets[@]}" -ne "$expected_count" ]]; then
  echo "Expected $expected_count release assets matching $pattern." >&2
  exit 1
fi

for url in "${assets[@]}"; do
  bash "$(dirname "$0")/wait-for-release-asset.sh" "$url"
done
