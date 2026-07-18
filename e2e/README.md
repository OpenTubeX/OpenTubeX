# End-to-end tests

Playwright drives the packed Electron app (`dist/main.js`) against an isolated,
per-test userData directory. The local API (youtubei.js) is always used —
Invidious is never exercised.

## Running locally

```bash
pnpm run test:e2e:pack      # build dist-e2e/ (required once per code change)
pnpm run test:e2e:offline   # fast suite, no YouTube network needed
pnpm run test:e2e:network   # talks to the real YouTube servers
pnpm run test:e2e           # both
```

The tests run a production build from `dist-e2e/`, separate from `dist/`,
so they work (and stay production-mode) even while `pnpm dev` is running.

On a headless machine (or to avoid windows popping up) prefix with
`xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24'`.
The screen size matters: xvfb's default 640x480 puts the app into its
mobile layout and breaks selectors.

## Structure

- `helpers/app.mjs` – launches the app with a fresh temp userData dir per test.
  Seed settings/datastores per file via `test.use({ seed: { ... } })`.
  The main process honours `OPENTUBEX_E2E_USER_DATA_DIR` for isolation.
- `helpers/innertube.mjs` – record/replay for Innertube requests (see below).
- `tests/offline/` – must pass without any external network. Runs on every PR.
- `tests/network/` – requires YouTube. Runs nightly and via workflow dispatch.
- `fixtures/innertube/` – gzipped recorded Innertube responses, committed to git.

## Network fallback

Network tests hit the real YouTube servers on the first attempt. If a test
fails (e.g. bot checks on CI runner IPs), Playwright retries it and the retry
replays recorded fixtures instead: Innertube requests are answered from
`fixtures/innertube/`, all other external network is blocked.

Media streams (googlevideo.com) are not recorded, and full watch-page
hydration needs the real API, so those assertions are guarded with
`test.skip(innertube.replay, ...)` / `if (!innertube.replay)`. Replay mode
is a smoke layer: it still verifies search results, the channel page, and
navigation against recorded Innertube data.

To (re-)record fixtures after YouTube-facing changes or for new tests:

```bash
E2E_RECORD=1 pnpm run test:e2e:network
```

Commit the updated files under `fixtures/innertube/`. To force replay mode
locally (validate fixtures without touching the network):

```bash
E2E_USE_FIXTURES=1 pnpm run test:e2e:network
```

## CI

`.github/workflows/e2e.yml`:

- **Pull requests** → offline suite (blocking).
- **Nightly / manual dispatch** → network suite with the fixture fallback.

On failure the Playwright HTML report and traces are uploaded as artifacts.
