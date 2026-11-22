#!/usr/bin/env bash
set -euo pipefail

url="$1"
max_attempts="${RELEASE_ASSET_MAX_ATTEMPTS:-60}"
retry_delay="${RELEASE_ASSET_RETRY_DELAY:-15}"

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  if wget --spider --quiet --timeout=10 --tries=1 "$url"; then
    echo "Release asset is available: $url"
    exit 0
  fi
  echo "Release asset is unavailable (attempt $attempt/$max_attempts): $url"
  if (( attempt < max_attempts )); then
    sleep "$retry_delay"
  fi
done

echo "Release asset did not become available before dispatch: $url" >&2
exit 1
