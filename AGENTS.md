# Project instructions

These rules apply to everyone who works on OpenTubeX with a coding agent, including contributors working from a fork. Maintainers, meaning people with push access to OpenTubeX (`gh api repos/OpenTubeX/OpenTubeX --jq .permissions.push` prints `true`), also follow [.github/MAINTAINER_AGENT_INSTRUCTIONS.md](.github/MAINTAINER_AGENT_INSTRUCTIONS.md); read it at the start of each task. Everyone else skips it: it covers merging, milestones, review bots, project tracking issues, and pushes to `development`.

Git remote names differ between checkouts, so these files name repositories instead: OpenTubeX is `OpenTubeX/OpenTubeX`, and FreeTube is `FreeTubeApp/FreeTube`, whose `development` branch OpenTubeX regularly merges.

## Contributors

- Open pull requests from your fork against OpenTubeX's `development` branch.
- Do not post bot commands (`@coderabbitai …`, `@cubic-dev-ai …`) or comment on project tracking issues; maintainers handle review bots, milestones, and merging. Address review findings on your PR as usual.
- List unrelated test failures you found, and follow-ups you leave for later, in the PR description.
- When you cannot run a check these rules ask for (an Android emulator, an iOS simulator, a full E2E project), say in the PR what you verified instead.

## Pull requests

Requests such as "implement issue #X" authorize local changes, not a PR. Open a PR only when the user explicitly requests or approves one for that repository. Approval for an application PR does not authorize a website PR, or vice versa.

- Before starting a fix or feature, check `development`'s recent commits, open PRs, and other agent threads if your harness lists them, for the same work, landed or in progress. Do not duplicate it; tell the user what you found and build on it or stop.
- Follow `release-notes/README.md` and `.github/PULL_REQUEST_AGENT_INSTRUCTIONS.md` for release notes and their screenshots and recordings.
- Never end a turn waiting for something that only you or the user can cause. Before you go quiet, name the event that will wake you (a check, a bot reply, a review you requested); if there is none, act or ask the user.
- End the PR description with a blurb about the model and harness that made the changes. Use the public model name the harness reports for the model that made the changes. If the harness does not expose a model name, use the harness name. Do not guess.

## User examples

Screenshots, recordings, logs, URLs, and data the user shares show their own content: video titles, channel names, thumbnails, video and playlist IDs, comments, and account details. Use that content only to understand the task and in replies to the user. Never put it anywhere public or persistent: committed files (code, tests, fixtures, comments), commit messages, PR and issue text, review replies, release notes, or uploaded screenshots and recordings. Replace it with neutral, made-up placeholders that reproduce the property that matters (length, script, special characters, aspect ratio) instead of the original text, and check captures for leftovers before uploading them.

## Follow-ups

Fix follow-ups in the current task by default, including bugs that predate it: a missing test, an edge case or cleanup, a bug in a component you touched or of the same kind as the one you are fixing. "It predates this PR" or "it affects other places too" is not a reason to defer.

Record a follow-up instead only when it lies in an unrelated area, is larger or riskier work, or needs the user's decision. Contributors list it in the PR description; maintainers record it as their instructions describe.

## Documentation

- Create new documentation, writeups, implementation notes, plans, or summaries only when requested; explain changes and validation in the PR description. Update existing documentation only when the change makes it inaccurate.
- When a behavior change could invalidate a user guide in `OpenTubeX/opentubex.github.io`, check it. For a material inaccuracy, name the guide and passage, step, or screenshot, explain the mismatch, and get approval before changing the website, unless already authorized. Limit the update to those inaccuracies and link the application and website PRs. New features and cosmetic differences alone need no update or approval request.
- Use American English spelling (center, color, behavior) in code, comments, tests, commit messages, and PR text, even where nearby comments use British spelling. Translations in `static/locales` keep their locale's spelling.

## Testing

- Run the relevant checks: `pnpm run test:unit` (unit tests and AI locale validation), `pnpm run lint` (JavaScript/Vue and styles), `pnpm run typecheck` (files marked `// @ts-check`), `pnpm run lint-json` (static JSON), `pnpm run lint-yml` (YAML), and filtered E2E tests for affected Electron flows.
- Keep fixes for unrelated test failures (tests that fail locally, or fail CI even after its retry) out of the current task's branch and PR. Never skip, quarantine, or defer a failing test (`test.fixme`, `test.skip`, new follow-up issues), and never loosen an assertion to hide a regression. Widen a geometry tolerance only for the fractional UI Scale geometry described under UI, never to make an unexplained failure pass.
- Flaky E2E tests: CI retries each E2E test once. Tests that pass only on retry do not fail the PR. They get an inline warning and an entry in the open "Flaky E2E tests" issue, which the Flaky Tests workflow maintains; leave those entries alone unless asked to fix flaky tests. To investigate one, read the failed attempt in the run's `playwright-report-*` artifact: its failure screenshot, its app trace (DOM snapshots, console, network), and the main process output. Reproduce it with its listed project, `--repeat-each=20 --retries=0`, and enough `--workers` to load the machine like CI does. If it only fails on CI, add `E2E_CPU_THROTTLE` (see `e2e/README.md`).
- On PRs, the `repeat` E2E shards run changed offline tests five times without retries. If one fails, the PR's own test is flaky. Fix it in the PR; do not rerun the job until it passes.
- PRs do not run the full offline E2E suite; it runs after each push to `development`. Run the affected offline tests locally before the PR is merged.
- PRs do not run the Android instrumentation tests either. Pushes to `development` that change the paths in `.github/workflows/android-tests.yml` run them, and the nightly run covers everything. Run the affected instrumentation tests on an emulator before native changes are merged, for example in a loop to reproduce a flaky one, with `./android/gradlew --project-dir android :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=<class>#<method>`. Each shard reruns its failed tests once; tests that pass only on that retry get a warning and an entry in the open "Flaky Android tests" issue.
- PRs do not run the iOS simulator tests (`.github/workflows/ios.yml`) either. Pushes to `development` that change its listed paths run them on an iPhone simulator, and the nightly run covers everything on an iPhone and an iPad. Run the affected tests on an iOS simulator before native iOS changes, or renderer changes those tests cover, are merged. Failed tests rerun once; tests that pass only on that retry get a warning and an entry in the open "Flaky iOS tests" issue.
- For bugfixes, demonstrate the failure first and verify the fix. Add a regression test only when it meets the test bar below; otherwise report the evidence (reproduction, screenshot, recording) in the PR. Verify new features with checks appropriate to the affected code. If automated verification is impractical, explain why and report the evidence used, unless the user waived verification.
- When changing sync-server collections or capabilities, follow `e2e/sync-server/README.md`.

### Test bar

Each test costs CI time and flake risk on every run, so add one only when its failure would mean:

- lost or corrupted user data (databases, migrations, sync protocol and conflicts, backups, history, playlists, subscriptions, profiles, persisted settings)
- a security or privacy problem (URL and protocol allowlists, IPC guards, paths, CSP, credentials, permissions, requests to unexpected hosts)
- a broken core flow (playback, quality, audio and caption selection, search, feeds, channel and playlist pages, navigation and tabs, mini player, downloads, casting, sync, app launch), including one that becomes unusable on phones or at narrow widths
- wrong parsing of external formats (YouTube, Innertube, Invidious, RSS and SABR responses, subtitles, imports, takeout files)
- a race, cancellation, or recovery bug that leaves the app stuck, duplicated, or showing stale data
- lost keyboard or focus access to a core control, or content in a core flow that becomes clipped, hidden, or unreachable
- a broken release, installer, portable mode, or update metadata

Do not add tests that assert exact cosmetic styling (colors, spacing, alignment, radii, icon glyphs, font weights, hover styles, label wording), restate constants, defaults, configuration, or source text, mirror mocks, or assert wall-clock durations. Show cosmetic fixes with a screenshot in the PR instead. Prefer a unit test over an E2E test when the logic can be tested on its own, extending an existing test over adding a new one, and one representative case over looping across icon packs, themes, locales, widths, or near-identical inputs unless another case takes a different code path.

### E2E

- Before running E2E tests, `dist-e2e` must reflect the current sources, assets, and build configuration. Run `pnpm run test:e2e:pack` if it is missing, any of those changed, or its freshness is uncertain, including when running unchanged tests against application changes.
- For filtered runs, invoke Playwright directly, for example `pnpm exec playwright test -c e2e/playwright.config.mjs e2e/tests/network/channel.spec.mjs --project=network --grep "test name"`. Never use `pnpm run test:e2e -- ...`; the extra `--` breaks argument parsing and can launch the full suite.
- Never run a whole E2E project locally; it takes one to two hours and loads the machine the whole time. This includes changes to shared components, theme tokens, or fixtures, dependency and Playwright upgrades, and audits. Pick specs by grepping for the changed component, class, token, or helper and for assertions on the changed behavior; for changes that affect every test, start with one spec per area. If a change still needs the full suite, push the branch and run `gh workflow run e2e.yml --ref <branch> -f project=offline`, or ask the user.
- On a user's graphical desktop, keep test windows out of their session. On Linux with Xvfb installed, each worker starts a private display automatically; do not set `E2E_XVFB=0`. Otherwise install Xvfb or use another private X server. Not needed in CI or headless environments.
- Tag an offline test with `@scale` only when fractional UI Scale can break what it measures (scroll-range clamping, virtualized lists, drag and position math, measured overflow), instead of looping over scales; the `offline-95` and `offline-125` projects rerun them, so each tag triples the test's cost, and the `uiScale` fixture holds the current value.
- Put performance checks in `*-performance.spec.mjs` files or tag them `@performance`. Prefer deterministic work counts over wall-clock budgets. The performance project runs nightly, not on PRs; compare timings between builds with `pnpm run test:performance` when a change targets performance.

### Android

- Debug builds install as `org.opentubex.app.dev` (OpenTubeX Dev). Launch `org.opentubex.app.dev/org.opentubex.app.MainActivity`; instrumentation uses `org.opentubex.app.dev.test`. Use `assembleNightly` only to build the published nightly identity. See `android/SIGNING.md`.
- Verify Android-targeted work (native code, Capacitor behavior, mobile-only components affecting Android, bugs seen on Android) on an emulator with a current debug APK, and report the API level, WebView version, and result. Electron tests and mobile-sized viewports do not replace this.
- iOS-only changes do not need an emulator, nor do shared renderer or CSS changes merely because the component also appears on phones; cover responsive effects with Electron tests. Use the emulator if an Android-specific failure emerges.

### iOS

- The tests live in `ios/App/AppTests`, one `AppTests` extension per area (DLNA, downloads, files, network, and the app itself in `AppTests.swift`). Register a new file in `ios/App/App.xcodeproj/project.pbxproj`. Run page scripts through `callPageScript` and `evaluatePageScript`, which fail a hung script instead of hanging the runner. Select tests with `-only-testing:AppTests/AppTests/<method>`, and count the tests that ran; a misspelled selector runs none.
- `_scripts/setupIosYtDlp.sh` downloads the Python runtime with `gh`. On a Mac or VM without `gh`, run it on another machine and copy the Git-ignored `ios/App/Python.xcframework` and `ios/App/python-packages` into that checkout before the iOS sync.

## UI

- After any visual change or implementation, show the user a screenshot (static appearance) or short recording (interaction, animation, transitions) of the finished result in the final response. Link a copy outside `e2e/results`, which the next test run clears. Follow the settling rules in `.github/PULL_REQUEST_AGENT_INSTRUCTIONS.md` for these too: capture Electron with `captureAppFramebuffer`, which waits for running animations and transitions, never after a fixed delay, and inspect each image for half-applied themes, fades, or other transition artifacts before showing it.
- UI Scale changes Electron's zoom factor, so fractional CSS-pixel geometry is legitimate. Changes involving scrolling, measurements, positioning, reflow, or animation boundaries must work at non-100% scales; do not treat subpixel differences from integer layout properties as stale or invalid state.
- Before adding or changing Shaka player controls or how they are enabled, shown, or hidden, read `src/renderer/components/FtShakaVideoPlayer/README.md`.
- Labeled action buttons, such as Enable, Load more, Refresh, and Reset, need a relevant icon from the registry beside their visible label; hide decorative icons from assistive technology.

### Icons

- Register new icons in the icon registry and map them for every supported pack: Material and Remix. If neither pack has a suitable glyph, use a raw custom icon without a registry entry.
- Visually inspect Material and Remix glyphs when adding or changing mappings. Ask for human confirmation only when their meaning or fit is ambiguous.

### Scrolling

- Every nested scrollable element must use `v-overlay-scrollbars` (or `addOverlayScrollbars` outside Vue) to match the theme and scrollbar settings. Native nested scrollbars are a bug unless documented as an exception. Verify the integration whenever adding or changing scrollable CSS.
- Overlay scrollbars are positioned against their scroll container, so never make one `position: static`; use `position: relative` to keep it in normal flow. The app logs an error for static containers and E2E tests fail on it.
- Keep headers outside the scroll viewport so content and scrollbars cannot pass behind them; prefer a fixed header with a separate inner scroller.
- When switching menu views, restore the viewport position of elements with overlay scrollbars with `restoreOverlayScrollTop`. After DOM updates that reduce the scroll range, call `clampOverlayScrollTop` with the rendered content end, observing a stable content wrapper when practical. Do not rely on focus, DOM replacement, or a possibly stale `scrollHeight`.
- Cover the range-reducing triggers a surface supports (resize, responsive layout changes, searching, filtering, collapsing, removing, replacing content) with regression tests, extending the surface's existing scroll-range test when there is one: scroll to the bottom first, then verify valid offsets, no empty space, and scrollbar thumb/overflow state matching the new range.

## Dependencies and data formats

- The npm `allow` list in `.github/dependabot.yml` must contain exactly the direct dependencies in `package.json` that are absent from the latest `package.json` on FreeTube's `development` branch; FreeTube manages shared ones. Fetch FreeTube's `development` and resync the list whenever dependencies or the Dependabot configuration change.
- Do not add migrations, compatibility aliases, or legacy handling for behavior or data formats introduced only by unshipped changes in the current PR. Change them directly; if that breaks local development data, tell the user instead of shipping a migration path.
- When `shaka-player` changes version, including through an upstream merge, follow the upgrade checklist in `src/renderer/components/FtShakaVideoPlayer/README.md`.

## Translations

When adding or changing translatable strings:

1. Update `en-US`, and the human translations of other languages you know; Weblate handles the rest.
2. Add or update AI completions for every other active locale in `static/locales/ai`, preserving placeholders and plural forms.
3. Run `node _scripts/aiTranslations.mjs cleanup --all --write` to drop AI entries that now have human translations.

The Local API browser extension keeps its strings in `browser-extension/_locales/<locale>/messages.json`, a separate Weblate component. Update its `en` file, and the human translations of other languages you know, but add no AI translations for it.

## Naming

- Never use the FreeTube name or branding to promote OpenTubeX: not in repository descriptions or tags, store or package-repository listings (AUR, APT, RPM, Flatpak), the website, or other marketing material. See discussion #391.
