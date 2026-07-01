#!/bin/sh

set -e

DEB_PATH=$1

if [ ! -f "$DEB_PATH" ]; then
	>&2 echo "ERROR: Debian package not found: $1"
	exit 1
fi

# Install packaging tools (mirrors anylinux-setup-action)
pacman-key --init
pacman -Syy --noconfirm archlinux-keyring
pacman -Syu --noconfirm \
	7zip             \
	base-devel       \
	freetype2        \
	libx11           \
	libxrandr        \
	libxss           \
	nspr             \
	nss              \
	nss-mdns         \
	nss-myhostname   \
	patchelf         \
	pipewire-audio   \
	pipewire-jack    \
	pulseaudio       \
	pulseaudio-alsa  \
	unzip            \
	wget             \
	xorg-server-xvfb \
	zsync

mkdir -p /usr/local/bin
TOOLS_SOURCE=https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/refs/heads/main/useful-tools
wget --retry-connrefused --tries=30 \
	"$TOOLS_SOURCE"/quick-sharun.sh -O /usr/local/bin/quick-sharun
wget --retry-connrefused --tries=30 \
	"$TOOLS_SOURCE"/get-debloated-pkgs.sh -O /usr/local/bin/get-debloated-pkgs
chmod +x /usr/local/bin/quick-sharun /usr/local/bin/get-debloated-pkgs
get-debloated-pkgs --add-common --prefer-nano

mkdir -p ./AppDir/bin
extracted_deb=$(mktemp -d)
trap 'rm -rf "$extracted_deb"' EXIT

# Extract .deb and get the path to the data.tar.*
bsdtar -xf "$DEB_PATH" -C "$extracted_deb"
data_archive=$(set -- "$extracted_deb"/data.tar.* && echo "$1")
bsdtar -xf "$data_archive" -C "$extracted_deb"

cp -rv "$extracted_deb"/opt/OpenTubeX/* ./AppDir/bin
cp -v  "$extracted_deb"/usr/share/icons/hicolor/scalable/apps/opentubex.svg ./AppDir/.DirIcon
cp -v  "$extracted_deb"/usr/share/icons/hicolor/scalable/apps/opentubex.svg ./AppDir/
cp -v  "$extracted_deb"/usr/share/applications/opentubex.desktop  ./AppDir/

# use the .deb name as reference for the name of the final appimage
# replace .deb for .AppImage and replace _ for -
OUTNAME=$(basename "$DEB_PATH" .deb | sed 's/_/-/g').AppImage

ARCH=$(uname -m)
export ARCH
export OUTNAME
export OUTPATH=./build
export ADD_HOOKS=self-updater.hook:fix-namespaces.hook
export DEPLOY_OPENGL=1
export DEPLOY_VULKAN=1
export DEPLOY_PIPEWIRE=1
export STARTUPWMCLASS=opentubex
export MAIN_BIN=opentubex

quick-sharun ./AppDir/bin/*
quick-sharun --make-appimage

