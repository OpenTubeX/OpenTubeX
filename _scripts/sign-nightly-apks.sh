#!/usr/bin/env bash
# Signs nightly APKs with the private nightly key. The lineage rotates from the
# public nightly.keystore that signed earlier nightlies, so existing
# installations update, and Android 9+ then rejects APKs signed only with the
# public key. Android 8 keeps verifying the public key's v2 signature.
set -euo pipefail

: "${ANDROID_NIGHTLY_KEYSTORE:?Set ANDROID_NIGHTLY_KEYSTORE to the private nightly keystore.}"
: "${ANDROID_NIGHTLY_STORE_PASSWORD:?Set ANDROID_NIGHTLY_STORE_PASSWORD.}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK.}"
if (( $# == 0 )); then
  echo "Usage: $0 APK..." >&2
  exit 2
fi

expected_signer=ae70934782cd4f6183777e3fbabcfe4cdcb6a51b404afff727c90c49e6907b5a
android_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../android" && pwd)"
build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort --version-sort | tail -n 1)"
apksigner="$build_tools/apksigner"

for apk in "$@"; do
  "$apksigner" sign \
    --v4-signing-enabled false \
    --rotation-min-sdk-version 28 \
    --lineage "$android_dir/nightly.lineage" \
    --ks "$android_dir/nightly.keystore" --ks-key-alias opentubex-nightly --ks-pass pass:opentubex-nightly \
    --next-signer \
    --ks "$ANDROID_NIGHTLY_KEYSTORE" --ks-key-alias opentubex-android-nightly \
    --ks-pass env:ANDROID_NIGHTLY_STORE_PASSWORD \
    "$apk"
  if ! "$apksigner" verify --verbose --print-certs "$apk" 2>/dev/null |
    grep --quiet --line-regexp "V3.0 Signer: certificate SHA-256 digest: $expected_signer"; then
    echo "$apk is not signed with the private nightly key." >&2
    exit 1
  fi
done
