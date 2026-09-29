#!/usr/bin/env bash
set -euo pipefail

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/_scripts" "$fixture/bin" \
  "$fixture/ios/App/Python.xcframework" \
  "$fixture/ios/App/python-packages/yt_dlp" \
  "$fixture/ios/App/python-packages/yt_dlp_ejs" \
  "$fixture/ios/App/python-packages/yt_dlp_plugins/extractor"
cp "$(dirname "$0")/../_scripts/setupIosYtDlp.sh" "$fixture/_scripts/setupIosYtDlp.sh"
cp "$(dirname "$0")/../_scripts/iosYtDlpWebkitNavigation.patch" "$fixture/_scripts/"
printf '3.14-b11' > "$fixture/ios/App/Python.xcframework/.opentubex-release-tag"
touch "$fixture/ios/App/python-packages/yt_dlp_plugins/extractor/webkit_jsi.py"
printf 'obsolete pins' > "$fixture/ios/App/python-packages/.pins"

cat > "$fixture/bin/python3" <<'PYTHON'
#!/usr/bin/env bash
if [[ "$1" == '-m' ]]; then
  printf 'download\n' >> "$IOS_SETUP_TEST_CALLS"
else
  mkdir -p "$3/yt_dlp" "$3/yt_dlp_ejs" "$3/yt_dlp_plugins/extractor" "$3/certifi"
  touch "$3/yt_dlp_plugins/extractor/webkit_jsi.py"
  touch "$3/certifi/cacert.pem"
fi
PYTHON
chmod +x "$fixture/bin/python3"

cat > "$fixture/bin/patch" <<'PATCH'
#!/usr/bin/env bash
cat > /dev/null
PATCH
chmod +x "$fixture/bin/patch"

export IOS_SETUP_TEST_CALLS="$fixture/calls"
PATH="$fixture/bin:$PATH" bash "$fixture/_scripts/setupIosYtDlp.sh"
[[ "$(cat "$IOS_SETUP_TEST_CALLS")" == download ]]
patch_sha="$(shasum -a 256 "$fixture/_scripts/iosYtDlpWebkitNavigation.patch" | cut -d' ' -f1)"
[[ "$(cat "$fixture/ios/App/python-packages/.pins")" == "yt-dlp==2026.8.19 yt-dlp-ejs==0.8.0 yt-dlp-apple-webkit-jsi==0.1.1 certifi==2026.7.22 $patch_sha" ]]
[[ -f "$fixture/ios/App/python-packages/certifi/cacert.pem" ]]
PATH="$fixture/bin:$PATH" bash "$fixture/_scripts/setupIosYtDlp.sh"
[[ "$(wc -l < "$IOS_SETUP_TEST_CALLS")" == 1 ]]
rm "$fixture/ios/App/python-packages/certifi/cacert.pem"
PATH="$fixture/bin:$PATH" bash "$fixture/_scripts/setupIosYtDlp.sh"
[[ "$(wc -l < "$IOS_SETUP_TEST_CALLS")" == 2 ]]
[[ -f "$fixture/ios/App/python-packages/certifi/cacert.pem" ]]

cat > "$fixture/bin/gh" <<'GH'
#!/usr/bin/env bash
printf 'release\n' >> "$IOS_SETUP_TEST_CALLS"
while [[ "$1" != '--dir' ]]; do shift; done
mkdir -p "$2/archive/Python.xcframework"
printf 'fixture' > "$2/archive/Python.xcframework/Info.plist"
tar -czf "$2/Python-3.14-iOS-support.b11.tar.gz" -C "$2/archive" Python.xcframework
GH
chmod +x "$fixture/bin/gh"
printf 'obsolete release' > "$fixture/ios/App/Python.xcframework/.opentubex-release-tag"
PATH="$fixture/bin:$PATH" bash "$fixture/_scripts/setupIosYtDlp.sh"
[[ "$(cat "$fixture/ios/App/Python.xcframework/.opentubex-release-tag")" == '3.14-b11' ]]
[[ "$(wc -l < "$IOS_SETUP_TEST_CALLS")" == 3 ]]
