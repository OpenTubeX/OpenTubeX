# Android Capacitor experiment report

Date: 2026-09-02  
Test device: Pixel 8 Pro, Android 16

## Result

Capacitor is a viable Android shell for OpenTubeX. The existing Vue renderer,
direct local API, and Shaka player remain the primary implementation. Normal
videos, Shorts, and HLS livestreams play without routing media payloads through
the Capacitor bridge. The experiment did not reach any stop condition from
issue #1025: video data stays out of the bridge, BotGuard stays isolated, the
WebView lifecycle is stable, and Shaka does not need to be replaced by a native
player.

Android remains an alpha target. The app depends on a current Android System
WebView, and true process-independent subscription refresh is not implemented.

## What works

- Capacitor packages the existing renderer at the trusted
  `https://localhost` origin with the hash router and browser datastore.
- The direct local API supports search, watch metadata, comments, channels,
  playlists, and subscription feeds without an Invidious dependency.
- The sandboxed `sigFrame` evaluates player scripts reliably on Android. A
  second native deciphering WebView would add lifecycle and security surface
  without solving an observed failure, so the experiment does not add one.
- A shared renderer adapter selects the Electron or Capacitor PO-token host and
  keeps player-script evaluation behind one interface.
- Android PO-token requests use an isolated, endpoint-restricted BotGuard
  WebView. Requests run through a FIFO queue, time out, and destroy the WebView
  before the next request starts.
- SABR and `googlevideo` response bodies stream directly into the main WebView.
  Seeking, repeated source replacement, 720p60 to 1080p60 manual quality
  changes, captions, fullscreen, rotation, and a complete 10:34 video passed on
  the physical device.
- Android Back, App Links, background audio, Picture-in-Picture, sleep and
  unlock, forced process recovery, phone and tablet layouts, the mobile tab
  organizer, and local persistence passed physical testing.
- Small sync-server JSON requests use Capacitor's native HTTP client so sync
  does not depend on browser CORS headers. Media requests are unaffected.
- Separate, additive, and shared tab modes passed between a private-X-server
  Electron instance and the physical Android installation. In separate mode,
  the phone retained its one local tab and offered two desktop tabs. Additive
  handoff produced three tabs while retaining the original. Shared mode then
  converged both installations to the same three tabs.
- Versioned tab sessions use the separate encrypted `sessionsV2` collection.
  A physical two-client test wrote the legacy `sessions` collection after
  `sessionsV2` existed and confirmed that the versioned revision and ciphertext
  did not change. Released clients can therefore continue using `sessions`
  without corrupting new device-scoped state.

## Native Android code required

The reusable renderer still needs narrow Android host code for:

- Capacitor activity setup, trusted-origin bridge restrictions, Android Back,
  App Links, system bars, orientation, hardware-keyboard state, and
  Picture-in-Picture;
- small YouTube and sync-server HTTP requests that cannot rely on WebView CORS,
  plus streaming interceptors and the SABR request registry for media;
- isolated, queued BotGuard and PO-token execution;
- live-reminder notifications and adaptive/themed launcher icons.

Player-script deciphering does not require native Android code because the
existing sandboxed frame remained reliable.

## Known limitation: background subscription refresh

Subscription refresh currently owns Vuex state, the browser IndexedDB
datastore, local-API parsing, cache reconciliation, automatic downloads, and
profile updates inside the renderer. Android WorkManager cannot safely update
that state after the renderer process has died. A worker that only posts a
notification or waits for the next foreground launch would not satisfy the
requirement, while duplicating the local API and persistence model in Java
would undermine the shared-code result of this experiment.

The correct follow-up is to extract a headless refresh and persistence layer
that both the renderer and an Android worker can call. That worker can then use
Android 16 progress-centric notifications and a conventional determinate
notification on Android 7–15. This is deferred as a separately scoped feature;
the current app refreshes overdue feeds when it returns to the foreground.

## Automated and physical verification

- Unit suite: all 743 tests passed, including the native HTTP adapter,
  session-compatibility, and session-merge coverage.
- Android JVM tests passed, including FIFO queue ordering.
- Capacitor production packing, Android sync, and the debug APK build passed.
- The APK was installed and launched only for Android user 0. The final cold
  launch completed in 468 ms.
- Real-device WebView automation verified local search and active 1920×1080
  playback with advancing time and no media error.
- The cross-device sync flow and released-client isolation scenario passed
  against a temporary local sync server, after which the account, server data,
  and temporary tailnet endpoint were removed.
- No Android virtual device or system image was installed on the test host.
  The supplied physical Android 16 device was used as the stronger runtime
  target; responsive Electron E2E tests continue to cover repeatable mobile UI
  behavior in CI.

The physical stress slice recorded total PSS of 192,877 KB before stress and
175,316 KB afterward. No crash or ANR occurred. The measured signed universal
release APK is 9,878,513 bytes (9.42 MiB).

## Distribution

The separate public [`OpenTubeX/fdroid`](https://github.com/OpenTubeX/fdroid)
repository publishes a signed F-Droid index and a GitHub Pages landing page
with a QR code and manual instructions. Stable and nightly Android application
IDs coexist. Release and nightly workflows dispatch updates to that
repository. The signed repository URL is:

```text
https://fdroid.opentubex.org/repo?fingerprint=99BCBB15868B41FE7263E409746D4ABCFC4D32262BEF2AB0B494BBA0929347CD
```

The Pages deployment is configured and passing. Publishing the custom hostname
still requires the DNS operator to add a `fdroid` CNAME pointing to
`opentubex.github.io`; HTTPS enforcement can be enabled after GitHub validates
that record.

Repository fingerprint:

```text
99BCBB15868B41FE7263E409746D4ABCFC4D32262BEF2AB0B494BBA0929347CD
```

The sync server must accept the `sessionsV2` encrypted collection before the
new tab-session client is released. Existing stable and nightly releases do not
yet contain Android assets, so the F-Droid repository initially publishes an
empty signed index and begins listing apps with the first Android release.
