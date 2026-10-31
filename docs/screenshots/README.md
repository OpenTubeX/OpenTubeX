# Updating the README and website screenshots

From the repository root, run:

```sh
pnpm run screenshots
```

Install `yt-dlp`, its JavaScript runtime such as Deno, and `ffmpeg` on your PATH
for the app's yt-dlp playback engine, which the original watch screenshot used.
On Linux, also install `xorg-server-xvfb` and `xorg-xauth`.

The command packs the current app, then uses Playwright to capture its Electron
window at 1710 × 1026 in English. It starts a private X server on Linux so capture
windows stay off your desktop, including on Wayland.

The command creates or replaces six PNGs in this directory:

| Files | View |
| --- | --- |
| `OpenTubeX1-dark.png`, `OpenTubeX1-light.png` | Subscriptions, with Kurzgesagt's current videos |
| `OpenTubeX2-dark.png`, `OpenTubeX2-light.png` | [Flying over Japan](https://www.youtube.com/watch?v=AY5qcIq5u2g&t=13318), paused at 3:41:58 |
| `OpenTubeX3-dark.png`, `OpenTubeX3-light.png` | Settings, maximized on the General category |

Both themes use the same loaded feed and paused video. The script uses a fresh
temporary profile and removes it when finished. Your subscriptions, settings,
history, and cookies are not used.

Settings are captured first with the app defaults. The capture process uses an
English system locale and switches the system color scheme for each theme.
The app's locale and theme preferences stay at System Default. Only after the
settings captures does the script select yt-dlp for the watch page and disable
automatic feed refresh while capturing the subscriptions.

Internet access is required. Metadata, thumbnails, and playback come from
YouTube through the app. If YouTube blocks playback or an image fails to load,
the command fails without replacing the existing screenshots. Captures from
that attempt and a failure screenshot are kept in `e2e/results/screenshots/`.
Review the images before committing them. Video lists and metadata can change
between runs.

The capture sequence lives in `e2e/screenshots/capture.spec.mjs`. The channel,
video, timestamp, and dimensions live in `e2e/helpers/screenshots.mjs`, shared
with the automatic theme discussion previews. If you already packed the current source,
run `node _scripts/screenshots.mjs` to repeat the capture without repacking.
The regular E2E suites do not update these files.

YouTube blocks GitHub-hosted runners, so the theme discussion previews replay a
recording of the same scenes from `e2e/fixtures/theme-previews/` and
`e2e/fixtures/innertube/capture/`. Re-record it after changing the channel,
video, or timestamp, or to refresh the content. Put any exported custom theme in
a directory as `theme.json`, pack the app, and run:

```sh
E2E_RECORD=1 THEME_PREVIEW_DIR=<directory> pnpm exec playwright test -c e2e/theme-previews/playwright.config.mjs
```

Recording needs the same tools as the README capture. Commit the two fixture
directories, but not the player script it also records under
`e2e/fixtures/innertube/shared/`.

The Flatpark submission and official Flatpak release workflows reuse these
committed images through `_scripts/syncAppStreamScreenshots.mjs`. The helper
updates the AppStream gallery with both themes, reads dimensions from the PNGs,
and uses `development` image URLs for official Flatpak builds. Flatpark checks
out the release tag and uses that tag in its image URLs. The helper preserves
the rest of each package's metadata. Package releases do not run the capture
command.

## Android

The website shows phone screenshots of the Android app. To refresh them, build
the debug APK, start an emulator, and pass its serial:

```sh
pnpm run capacitor:sync:android
(cd android && ./gradlew assembleDebug)
pnpm run screenshots:android emulator-5554
```

The command installs `android/app/build/outputs/apk/debug/app-debug.apk`, which
is the OpenTubeX Dev app, and **clears that app's data** so the captures start
from app defaults. Use an emulator, or a device where losing the Dev app's data
is fine. The device language must be English (United States).

It connects to the app's WebView with Playwright, captures the same views as
the desktop command, and saves the full screen with `adb screencap`:

| Files | View |
| --- | --- |
| `OpenTubeX1-mobile-dark.png`, `OpenTubeX1-mobile-light.png` | Subscriptions |
| `OpenTubeX2-mobile-dark.png`, `OpenTubeX2-mobile-light.png` | Flying over Japan, paused at 3:41:58 |
| `OpenTubeX3-mobile-dark.png`, `OpenTubeX3-mobile-light.png` | Settings, on the General category |

The phone captures enable Appearance > Move Settings to App Header, so Settings
opens as an app page without a minimize button. Emulators report the host
keyboard as a hardware keyboard, so the command tells the app that none is
attached, as on a phone.

Unlike the desktop command, the watch page uses the default built-in playback
engine. Clearing the app's data restores the yt-dlp version bundled in the
APK, which can be too old for YouTube to serve its streams.

While capturing, the command sets the display to 1080 × 2340 at 420 dpi,
switches the system dark theme, and uses System UI demo mode for a clean
status bar showing 12:00. It restores these settings afterwards. If a scene
fails, no images are replaced, and the command prints the directory with that
attempt's captures and a failure screenshot.

The command also copies the dark captures to
`fastlane/metadata/android/en-US/images/phoneScreenshots/` as `1.png` to
`3.png`. F-Droid and IzzyOnDroid show those in their app listings. The
[OpenTubeX F-Droid repository](https://github.com/OpenTubeX/fdroid) downloads
them from `development` each time it publishes. Pushing new images publishes a
nightly, which triggers that.
