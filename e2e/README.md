# End-to-end tests

Playwright drives the packed Electron app (`dist-e2e/main.js`) against an isolated,
per-test userData directory. Isolated browser checks use headless Chromium directly.
Playback tests use the local API (youtubei.js).
Offline metadata tests may use Invidious when they mock every request.

## Running locally

```bash
pnpm exec playwright install --only-shell chromium  # required for browser checks
pnpm run test:e2e:pack      # build dist-e2e/ (required once per code change)
pnpm run test:e2e:offline   # fast suite, no YouTube network needed
pnpm run test:e2e:browser   # isolated Chromium checks, no Electron build needed
pnpm run test:e2e:network   # talks to the real YouTube servers
pnpm run test:e2e           # all suites
```

The tests run a production build from `dist-e2e/`, separate from `dist/`,
so they work (and stay production-mode) even while `pnpm dev` is running.

On Linux with Xvfb installed, each Playwright worker starts its own private
Xvfb display, so test windows stay hidden and parallel workers cannot move
each other's cursor or steal focus. Set `E2E_XVFB=0` to use the current
display instead, or `E2E_XVFB=1` to fail when Xvfb is missing.

To reproduce timing flakes that only happen on slower CI runners, set
`E2E_CPU_THROTTLE` to slow the app's renderer down by that factor, e.g.
`E2E_CPU_THROTTLE=4`. Raise `--timeout` along with it.

Without Xvfb per worker (or on a headless machine) prefix with
`xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24'`.
The screen size matters: xvfb's default 640x480 puts the app into its
mobile layout and breaks selectors.

## Structure

- `helpers/app.mjs` – launches the app with a fresh temp userData dir per test.
  Seed settings/datastores per file via `test.use({ seed: { ... } })`.
  The main process honours `OPENTUBEX_E2E_USER_DATA_DIR` for isolation.
  In offline projects, renderer requests to hosts a test has not routed fail
  from launch on: `www.youtube.com` answers 404, `api.invidious.io` answers
  an empty list, and other hosts abort.
  Loopback servers stay reachable.
  Inside `page.evaluate`, `window.$store` and `window.$router` reach the
  renderer's Vuex store and router in every window, including after reloads.
  Helpers shared with the Android CDP tests in `tests/android` cannot use them.
- `helpers/innertube.mjs` – record/replay for Innertube requests (see below).
- `helpers/media.mjs` – the offline demo video and the fake player response
  that serves it (see below).
- `helpers/watch.mjs` – a fully mocked watch page, playable or unplayable.
- `tests/offline/` – Electron tests that must pass without any external network.
- `tests/browser/` – isolated Chromium checks without Electron or external network.
- `tests/network/` – requires YouTube. Runs nightly and via workflow dispatch.
- `fixtures/innertube/` – gzipped recorded Innertube responses, committed to git.
- `fixtures/media/demo.webm` – 30s VP9/Opus clip with a burnt-in timecode.
- `fixtures/theme-previews/` – images, player metadata, and a still video of
  the README scenes that the theme discussion previews replay (see
  [the screenshot instructions](../docs/screenshots/README.md)).

## Projects

- `offline` – every Electron test in `tests/offline/` except performance checks, at 100% UI scale.
- `offline-95` and `offline-125` – tests tagged `@scale`, again at 95% and 125%.
- `performance` – tests in `*-performance.spec.mjs` files or tagged `@performance`.
- `browser` and `network` – see above.

Tag offline tests that assert geometry, scrolling, measurements, positioning, reflow or
animation boundaries with `@scale` instead of looping over UI scales. The
`uiScale` fixture holds the project's scale; it is seeded as the `uiScale`
setting unless the test seeds its own:

```js
test('keeps the header above the scroller', { tag: '@scale' }, async ({ page, uiScale }) => {
  // ...
})
```

Window sizes and wheel deltas are device pixels, so scale them by
`uiScale / 100` when a test needs a fixed CSS width. Sample pixels with
`webContents.capturePage()` rather than `page.screenshot()`, which Electron
crops to CSS-pixel dimensions at non-100% scales.

Include the scaled projects when running such a test by itself:
`--project=offline --project=offline-95 --project=offline-125`.

Performance checks measure work (layout, style and render counts), resource
retention or responsiveness under CPU throttling. Prefer deterministic counts
over single-run wall-clock budgets: shared runners make those noisy. Use the
paired comparison below for timings. The project runs with one worker and
without tracing.

## Playing a video without YouTube

Media streams can't be recorded, and recorded player responses are useless
(their stream URLs expire, and CI recordings are usually bot checks). So
whenever the player has to run without the live API, the `/youtubei/v1/player`
response is synthesized instead: `demoPlayerResponse()` reports a playable
video with a single progressive format pointing at `fixtures/media/demo.webm`,
which is served locally by `routeDemoMedia()`. Without adaptive formats the
app takes its legacy (progressive) player path, so neither a DASH manifest
nor SABR is involved.

Everything else (title, channel, description, comments, recommendations)
still comes from the recorded `/next` response, so tests that only need
*some* video playing belong in `tests/offline/` — see
`tests/offline/player.spec.mjs` and `mockPlayableWatchPage()`.

## Network fallback

Network tests hit the real YouTube servers on the first attempt. If a test
fails (e.g. bot checks on CI runner IPs), Playwright retries it and the retry
replays recorded fixtures instead: Innertube requests are answered from
`fixtures/innertube/`, all other external network is blocked, and the player
plays the demo video.

Tests whose videos have no recorded fixtures, or that need data the demo
player response doesn't have (adaptive formats), are guarded with
`test.skip(innertube.replay, ...)`. Replay mode is a smoke layer: it verifies
search results, the channel page, playback and navigation against recorded
Innertube data.

Live playback tests wait for either media playback or the app's explicit
IP-block error. GitHub-hosted runners are commonly blocked from streaming
media; in that case only the playback-dependent test is skipped with a clear
reason. Other watch-page assertions continue against the live API, while
unexpected player failures still fail normally.

## Screenshots

To update the full-window README images in both themes, run
`pnpm run screenshots`. See [the screenshot instructions](../docs/screenshots/README.md)
for prerequisites and the fixed video timestamp. This capture runs separately
from the test suites below.

Failures always attach a screenshot. Passing tests do not need to attach
screenshots, including tests with visual assertions.

Use `attachScreenshot` when a capture is useful for preparing a release-note
image. Follow the instructions under "Images" in `release-notes/README.md`;
screenshots are optional test artifacts, not part of the assertions:

```js
test('...', async ({ page, attachScreenshot }) => {
  await attachScreenshot('subscriptions feed')
})
```

To (re-)record fixtures after YouTube-facing changes or for new tests:

```bash
E2E_RECORD=1 pnpm run test:e2e:network
```

Commit the updated files under `fixtures/innertube/`. Player responses are
deliberately not recorded. To force replay mode
locally (validate fixtures without touching the network):

```bash
E2E_USE_FIXTURES=1 pnpm run test:e2e:network
```

## CI

`.github/workflows/e2e.yml`:

- **Pull requests** → browser tests, changed network tests, and changed offline tests repeated without retries.
- **Pushes to `development`** → offline tests at 100% UI scale and browser tests, skipped when a push only changes `static/locales/`, as Weblate PRs do.
- **Nightly** → full offline, scaled, performance, browser, and network suites.
- **Manual dispatch** → all suites by default, or an individual suite.

The offline suite runs after merging instead of on every PR push. A run on
`development` always finishes, and only the latest push waiting behind it runs
next, so one run can cover several merges. When it fails, find the merge that
broke it and fix it on `development`.

The offline and scaled projects share up to 16 CI shards, and the performance
project has its own shards. The cap keeps a full run within GitHub's 20
concurrent jobs. `E2E_XVFB=1` requires each Playwright worker's private Xvfb
display, so windows cannot move each other's cursor or steal focus. With it,
offline shards run two workers; the performance and network projects keep one.
Isolated Chromium checks run in one separate job, so only that runner installs
Chromium. The offline command and dispatch selection include offline and
performance Electron tests and browser checks.

On `development`, the offline project at 100% UI scale runs in full:
Playwright's import-based `--only-changed` selection cannot associate its tests
with source or CSS changes. On PRs, the network project, which talks to YouTube, is limited to
changed tests and passes without running any when none are affected. Network
tests use the fixture fallback on retry. The `repeat` shards run changed
offline tests five times without retries, so a PR cannot add a flaky test; they
are skipped when a shared change selects more than 100 tests. Run the performance project locally with
`pnpm exec playwright test -c e2e/playwright.config.mjs --project=performance`.

The browser job also runs `tests/android/mobile-performance.test.mjs`
(`pnpm run test:mobile-performance`) on every PR and push to `development`. These source-level storage and list checks use `node:test` with
headless Chromium and are not discovered by the normal unit-test glob or
Playwright. They do not replace native Android emulator testing.

The Playwright HTML report and functional-test traces are uploaded as artifacts.
For Electron, Playwright's own trace only lists API calls, so a failed test
also attaches the app's trace, with DOM snapshots, console messages and
network requests, and the main process output.
The performance project disables tracing to avoid distorting measurements.
On CI, Playwright retries each failed test once. A test that passes only on
retry does not fail the run: it gets a warning annotation and an entry in the
open "Flaky E2E tests" issue, which the Flaky E2E Tests workflow maintains.
The paired comparison does not retry.

## Performance comparison

`pnpm run test:performance` runs locally, not in CI. It takes two checkouts
with packed `dist-e2e` builds, a base and a candidate, and measures startup, large cached subscriptions, navigation, scrolling, opening a hovered video, and local playback
against both builds on one runner. It alternates between builds, discards two warm-ups per build, and
compares the median of seven samples. `--summary` writes a Markdown table and
`--output` the raw samples.

An absolute gate fails when the base median is below the limit, the candidate's
lower quartile reaches the limit, and the median increase exceeds the configured
absolute minimum delta. A relative gate fails when the candidate's lower
quartile clears the threshold against the base's upper quartile and the
interquartile increase exceeds the configured minimum delta. It also catches a
material slowdown when every adjacent base/candidate pair exceeds both the
relative and minimum-delta budgets, with at least seven pairs. Overlapping
distributions with inconsistent changes still pass. Elapsed metrics
allow 15%, longest-frame metrics 20%, scrolling renderer work 25%, renderer heap growth 50%, and packed code
size 5%. Each metric's minimum delta lives in `e2e/performance/report.mjs`.

Scrolling measures elapsed time for 60 frames to detect sustained slower frame
delivery, plus renderer CPU work using CDP `TaskDuration`, since extra
work can fit within a frame without changing its duration. Player heap growth
measures five open/play/close tab cycles after a warm-up cycle and forced renderer
garbage collection. Heap metrics cover JavaScript memory, excluding native and GPU
memory. Packed code size includes JavaScript and CSS in nested output directories.
Measurements are validated before comparison; enforcing runs require at least
seven samples. Passing medians above an
absolute limit are marked above budget so existing slow baselines remain visible.
Unmocked YouTube services return controlled HTTP errors, so unrelated requests
cannot put mocked playback into the shared network-recovery backoff queue.

To compare two checkouts locally, build `dist-e2e` in both and run:

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" \
  pnpm run test:performance -- \
  --base /path/to/base-checkout \
  --candidate /path/to/candidate-checkout
```
