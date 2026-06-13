#!/usr/bin/env bash

set -euo pipefail

readonly VERSION="${1:?Usage: $0 <version> <runtime> [update-info]}"
readonly RUNTIME="${2:?Usage: $0 <version> <runtime> [update-info]}"
readonly UPDATE_INFO="${3:-}"

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly BUILD_DIR="$ROOT_DIR/build"
readonly QUICK_SHARUN_URL="https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/refs/heads/main/useful-tools/quick-sharun.sh"

case "$RUNTIME" in
  linux-x64)
    appimage_arch="x86_64"
    deb_arch="amd64"
    appimage_name="OpenTubeX-$VERSION.AppImage"
    ;;
  linux-arm64)
    appimage_arch="aarch64"
    deb_arch="arm64"
    appimage_name="OpenTubeX-$VERSION-arm64.AppImage"
    ;;
  *)
    if [[ "$RUNTIME" == linux-armv7l ]]; then
      printf 'Anylinux AppImages are not supported for ARMv7: sharun only publishes x86_64 and aarch64 binaries.\n' >&2
      printf 'Use the classic static-runtime AppImage conversion in CI instead.\n' >&2
    else
      printf 'Unsupported Anylinux AppImage runtime: %s\n' "$RUNTIME" >&2
    fi
    exit 1
    ;;
esac

if [[ "$(uname -m)" != "$appimage_arch" ]]; then
  printf 'Anylinux AppImages must be packaged on the target architecture (%s), got %s.\n' "$appimage_arch" "$(uname -m)" >&2
  exit 1
fi

for command_name in bsdtar wget; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

deb_path="$BUILD_DIR/opentubex_${VERSION}_${deb_arch}.deb"
if [[ ! -f "$deb_path" ]]; then
  printf 'Missing Debian package: %s\n' "$deb_path" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$work_dir/deb" "$work_dir/root" "$work_dir/AppDir/bin" "$work_dir/out"

bsdtar -xf "$deb_path" -C "$work_dir/deb"
data_archive="$(printf '%s\n' "$work_dir"/deb/data.tar.* | head -n 1)"
if [[ ! -f "$data_archive" ]]; then
  printf 'Could not find data archive inside %s\n' "$deb_path" >&2
  exit 1
fi

bsdtar -xf "$data_archive" -C "$work_dir/root"

app_payload="$work_dir/root/opt/OpenTubeX"
desktop_file="$work_dir/root/usr/share/applications/opentubex.desktop"
icon_file="$work_dir/root/usr/share/icons/hicolor/scalable/apps/opentubex.svg"

if [[ ! -d "$app_payload" || ! -f "$desktop_file" || ! -f "$icon_file" ]]; then
  printf 'The Debian package did not contain the expected OpenTubeX payload, desktop file, or icon.\n' >&2
  exit 1
fi

cp -a "$app_payload"/. "$work_dir/AppDir/bin/"
cp "$desktop_file" "$work_dir/AppDir/"
cp "$icon_file" "$work_dir/AppDir/"
cp "$icon_file" "$work_dir/AppDir/.DirIcon"
sed -i 's|^Exec=.*|Exec=opentubex %U|' "$work_dir/AppDir/opentubex.desktop"

quick_sharun="$work_dir/quick-sharun"
wget -q "$QUICK_SHARUN_URL" -O "$quick_sharun"
chmod +x "$quick_sharun"

target_appimage="$BUILD_DIR/$appimage_name"
rm -f "$target_appimage" "$target_appimage.zsync"

export ADD_HOOKS="self-updater.hook"
export APPDIR="$work_dir/AppDir"
export ARCH="$appimage_arch"
export DEPLOY_DATADIR="${DEPLOY_DATADIR:-0}"
export DEPLOY_OPENGL=1
export DEPLOY_PIPEWIRE=1
export DEPLOY_VULKAN=1
export MAIN_BIN=opentubex
export OUTNAME="$appimage_name"
export OUTPATH="$work_dir/out"
export STARTUPWMCLASS=opentubex
export UPINFO="$UPDATE_INFO"

"$quick_sharun" "$APPDIR"/bin/*
"$quick_sharun" --make-appimage

produced_appimage="$(printf '%s\n' "$work_dir"/out/*.AppImage | head -n 1)"
if [[ ! -f "$produced_appimage" ]]; then
  printf 'quick-sharun did not produce an AppImage.\n' >&2
  exit 1
fi

mv "$produced_appimage" "$target_appimage"
if [[ -f "$produced_appimage.zsync" ]]; then
  mv "$produced_appimage.zsync" "$target_appimage.zsync"
elif compgen -G "$work_dir/out/*.AppImage.zsync" >/dev/null; then
  mv "$(printf '%s\n' "$work_dir"/out/*.AppImage.zsync | head -n 1)" "$target_appimage.zsync"
fi

if [[ -f "$target_appimage.zsync" ]]; then
  sed -i "s|^Filename: .*|Filename: $appimage_name|" "$target_appimage.zsync"
fi

chmod +x "$target_appimage"
printf 'Anylinux AppImage created at %s\n' "$target_appimage"
