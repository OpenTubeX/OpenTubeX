#!/bin/sh

set -e

DEB_PATH=$1

# Only the pinned package download below gets the workflow token. It
# authenticates GitHub API requests that hit the anonymous rate limit on shared
# runners. Nothing else in this container, including tools quick-sharun
# downloads, should see it.
github_token=${GITHUB_TOKEN-}
unset GITHUB_TOKEN

if [ ! -f "$DEB_PATH" ]; then
	>&2 echo "ERROR: Debian package not found: $1"
	exit 1
fi

# Retry pacman because the package mirror occasionally stalls mid-download.
# Completed downloads stay in the cache, so each attempt resumes where it stopped.
pacman_retry() {
	for attempt in 1 2 3 4 5; do
		pacman "$@" && return 0
		>&2 echo "pacman failed (attempt $attempt/5), retrying..."
		sleep $((attempt * 5))
	done
	return 1
}

# The image empties the package cache after every transaction. Keep the
# downloads, so CI can cache them between runs.
rm -f /etc/pacman.d/hooks/package-cleanup.hook

# Install packaging tools (mirrors anylinux-setup-action)
pacman-key --init
pacman_retry -Syy --noconfirm archlinux-keyring
pacman_retry -Syu --noconfirm \
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
TOOLS_SOURCE=https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/63759aceda3a0cb9446a4e3c2aebe3af5e5c697d/useful-tools
wget --retry-connrefused --tries=30 \
	"$TOOLS_SOURCE"/quick-sharun.sh -O /usr/local/bin/quick-sharun
wget --retry-connrefused --tries=30 \
	"$TOOLS_SOURCE"/get-debloated-pkgs.sh -O /usr/local/bin/get-debloated-pkgs
chmod +x /usr/local/bin/quick-sharun /usr/local/bin/get-debloated-pkgs
GITHUB_TOKEN=$github_token get-debloated-pkgs --add-common --prefer-nano
# Drop superseded package versions, so CI's cached package directory keeps
# only what this run installed.
pacman -Sc --noconfirm >/dev/null

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

