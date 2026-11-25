#!/usr/bin/env bash
set -euo pipefail

packages="$CODESIGNING_FOLDER_PATH/python-packages"
mkdir -p "$packages"
rsync -a --delete --exclude '__pycache__/' --exclude '*.pyc' "$PROJECT_DIR/python-packages/" "$packages/"
cp "$PROJECT_DIR/App/opentubex_ios_ytdlp.py" "$packages/"
cp "$PROJECT_DIR/App/opentubex_ios_ffmpeg.py" "$packages/"

# The unsigned IPA and simulator still need loadable extension frameworks.
if [[ -z "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]]; then
  export EXPANDED_CODE_SIGN_IDENTITY=-
  export EXPANDED_CODE_SIGN_IDENTITY_NAME='Ad Hoc'
fi

source "$PROJECT_DIR/Python.xcframework/build/utils.sh"
install_stdlib Python.xcframework
python_version="$(find "$CODESIGNING_FOLDER_PATH/python/lib" -maxdepth 1 -type d -name 'python3.*' -print -quit | xargs basename)"
process_dylibs Python.xcframework "python/lib/$python_version/lib-dynload"
process_dylibs Python.xcframework python-packages
