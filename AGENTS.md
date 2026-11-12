# Project instructions

## Pull requests

Requests such as "implement issue #X" authorize local changes, not a PR. Open a PR only when the user explicitly requests or approves one for that repository. Approval for an application PR does not authorize a website PR, or vice versa.

- Give a milestone only to PRs that fix user-facing bugs or add user-facing features. Leave all other PRs without one, including upstream merges and syncs, CI, dependency, test, and documentation changes, and minor changes users won't notice.
- For a PR that needs a milestone, copy the linked issue's milestone. If it has none, assign the open milestone with the lowest version in its title: query open milestones with `gh api --paginate` and compare titles by numeric version order (1.10 after 1.9), not alphabetically or by milestone number. Pass the exact title to `gh pr create --milestone` or `gh pr edit --milestone`. If no version milestone is open, report that instead of creating one.
- When a PR with a milestone is created, gains a closing issue link, or changes milestone, assign its milestone to every issue it closes that has none, immediately, even while the PR is open. Keep existing issue milestones and verify the assignments on GitHub.
- Follow `release-notes/README.md` and `.github/PULL_REQUEST_AGENT_INSTRUCTIONS.md` for release notes and their screenshots and recordings.
- The required approving review comes from CodeRabbit, which does not approve on its own. Once its review of the latest commit has finished and you have fixed or answered every finding, comment `@coderabbitai approve` right away; this is not a review trigger, so the rule against triggering CodeRabbit reviews does not apply. A "Review skipped" comment, a skipped `CodeRabbit` check, or a rate-limit reply is not a review: coderabbit-review-queue requests one later, which can take hours, so keep watching and do not comment `@coderabbitai approve` or merge until `coderabbitai[bot]` has submitted a review. Do not dismiss its reviews, and do not wait for it to approve unprompted. If it still has not approved after it answers, tell the user what blocks the merge.
- Never end a turn waiting for something that only you or the user can cause. Before you go quiet, name the event that will wake you (a check, a bot reply, a review you requested); if there is none, act or ask the user.
- End the PR description with a blurb about the model and harness that made the changes. Use the public model name the harness reports for the model that made the changes. If the harness does not expose a model name, use the harness name. Do not guess.

## User examples

Screenshots, recordings, logs, URLs, and data the user shares show their own content: video titles, channel names, thumbnails, video and playlist IDs, comments, and account details. Use that content only to understand the task and in replies to the user. Never put it anywhere public or persistent: committed files (code, tests, fixtures, comments), commit messages, PR and issue text, review replies, release notes, or uploaded screenshots and recordings. Replace it with neutral, made-up placeholders that reproduce the property that matters (length, script, special characters, aspect ratio) instead of the original text, and check captures for leftovers before uploading them.

## Follow-ups

Fix follow-ups in the current task by default, including bugs that predate it: a missing test, an edge case or cleanup, a bug in a component you touched or of the same kind as the one you are fixing, and anything raised in review of your PR. "It predates this PR" or "it affects other places too" is not a reason to defer.

Record a follow-up instead only when it lies in an unrelated area, is larger or riskier work, or needs the user's decision. Post it as a comment on the pinned "Agent follow-ups" issue (#2661), not only in your thread, where it goes unread. This needs no further approval.

- Read the existing comments first and skip follow-ups already listed.
- Post one comment per follow-up, following the `leaving-pr-comments` skill: a bold one-line summary, why it matters, and links to the relevant code and, if one exists, the PR.
- Before working on a follow-up from the issue, check its comment for an 👀 reaction. If one is there, another agent has it in progress; leave it alone unless the user assigned it to you. Otherwise add the reaction (`gh api repos/OpenTubeX/OpenTubeX/issues/comments/<id>/reactions -f content=eyes`). If you stop without finishing, remove it (`gh api -X DELETE repos/OpenTubeX/OpenTubeX/issues/comments/<id>/reactions/<reaction-id>`).
- When your task addresses a follow-up from the issue, delete its comment (`gh api -X DELETE repos/OpenTubeX/OpenTubeX/issues/comments/<id>`) once the fix is merged. If the work is only partly done, leave the comment and post an update instead.
- Never edit the issue body or other comments, and never close the issue.
- Link the posted comments in your final message.

## Documentation

- Create new documentation, writeups, implementation notes, plans, or summaries only when requested; explain changes and validation in the PR description. Update existing documentation only when the change makes it inaccurate.
- When a behavior change could invalidate a user guide in `OpenTubeX/opentubex.github.io`, check it. For a material inaccuracy, name the guide and passage, step, or screenshot, explain the mismatch, and get approval before changing the website, unless already authorized. Limit the update to those inaccuracies and link the application and website PRs. New features and cosmetic differences alone need no update or approval request.
- Use American English spelling (center, color, behavior) in code, comments, tests, commit messages, and PR text, even where nearby comments use British spelling. Translations in `static/locales` keep their locale's spelling.

## Testing

- Run the relevant checks: `pnpm run test:unit` (unit tests and AI locale validation), `pnpm run lint` (JavaScript/Vue and styles), `pnpm run typecheck` (files marked `// @ts-check`), `pnpm run lint-json` (static JSON), `pnpm run lint-yml` (YAML), and filtered E2E tests for affected Electron flows.
- Fix unrelated test failures (tests that fail locally, or fail CI even after its retry). This is authorized; do not ask first. Keep the fix out of the current task's branch and PR.
  1. Fetch `origin/development` and check its recent commits and open PRs, and other agent threads if your harness lists them, for a fix that has landed or is in progress. Do not duplicate one.
  2. Reproduce on the latest `origin/development`, find the root cause, and fix and verify it.
  3. Push fixes that only touch tests, test helpers, fixtures, or test configuration directly to `origin/development`, however large. Open a separate PR for fixes that change application code so CI runs them, and merge it once it passes.
  4. Rebase the working branch onto the updated `origin/development` and rerun the affected checks.

  Never skip, quarantine, or defer the test (`test.fixme`, `test.skip`, new follow-up issues), and never loosen an assertion to hide a regression. Widen a geometry tolerance only for the fractional UI Scale geometry described under UI, never to make an unexplained failure pass.
- Flaky E2E tests: CI retries each E2E test once. Tests that pass only on retry do not fail the PR. They get an inline warning and an entry in the open "Flaky E2E tests" issue, which the Flaky E2E Tests workflow maintains. During unrelated work, leave those entries alone. When asked to fix flaky tests, work through the issue, starting with the highest counts:
  1. Read the failed attempt in the run's `playwright-report-*` artifact: its failure screenshot, its app trace (DOM snapshots, console, network), and the main process output. Reproduce each entry with its listed project, `--repeat-each=20 --retries=0`, and enough `--workers` to load the machine like CI does. If it only fails on CI, add `E2E_CPU_THROTTLE` (see `e2e/README.md`).
  2. Find the root cause, fix it, and verify with the same command.
  3. Land the fix as described above, then delete the entry's line from the issue. It comes back if the test flakes again.
- On PRs, the `repeat` E2E shards run changed offline tests five times without retries. If one fails, the PR's own test is flaky. Fix it in the PR; do not rerun the job until it passes.
- PRs do not run the full offline E2E suite; it runs after each push to `development`. Run the affected offline tests locally before merging. After merging a PR, watch the E2E Tests run that covers its merge commit (`gh run list --workflow e2e.yml --event push`). Newer pushes cancel older runs, so whenever the run you follow is cancelled, switch to the newest run whose head contains your merge (`git merge-base --is-ancestor <merge-sha> <head-sha>`). Stop at the first one that finishes without being cancelled; it covers every merge before its head. When it fails, find the merge that broke it and fix it on `development` as described above.
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
- Never run a whole E2E project locally; it takes one to two hours and loads a machine other sessions share. This includes changes to shared components, theme tokens, or fixtures, dependency and Playwright upgrades, and audits. Pick specs by grepping for the changed component, class, token, or helper and for assertions on the changed behavior; for changes that affect every test, start with one spec per area. If a change still needs the full suite, push the branch and run `gh workflow run e2e.yml --ref <branch> -f project=offline`, or ask the user.
- On a user's graphical desktop, keep test windows out of their session. On Linux with Xvfb installed, each worker starts a private display automatically; do not set `E2E_XVFB=0`. Otherwise install Xvfb or use another private X server. Not needed in CI or headless environments.
- Tag an offline test with `@scale` only when fractional UI Scale can break what it measures (scroll-range clamping, virtualized lists, drag and position math, measured overflow), instead of looping over scales; the `offline-95` and `offline-125` projects rerun them, so each tag triples the test's cost, and the `uiScale` fixture holds the current value.
- Put performance checks in `*-performance.spec.mjs` files or tag them `@performance`. Prefer deterministic work counts over wall-clock budgets. The performance project runs nightly, not on PRs; compare timings between builds with `pnpm run test:performance` when a change targets performance.

### Android

- Debug builds install as `org.opentubex.app.dev` (OpenTubeX Dev). Launch `org.opentubex.app.dev/org.opentubex.app.MainActivity`; instrumentation uses `org.opentubex.app.dev.test`. Use `assembleNightly` only to build the published nightly identity. See `android/SIGNING.md`.
- Verify Android-targeted work (native code, Capacitor behavior, mobile-only components affecting Android, bugs seen on Android) on an emulator with a current debug APK, and report the API level, WebView version, and result. Electron tests and mobile-sized viewports do not replace this.
- iOS-only changes do not need an emulator, nor do shared renderer or CSS changes merely because the component also appears on phones; cover responsive effects with Electron tests. Use the emulator if an Android-specific failure emerges.

## UI

- After any visual change or implementation, show the user a screenshot (static appearance) or short recording (interaction, animation, transitions) of the finished result in the final response. Link a copy outside `e2e/results`, which the next test run clears.
- UI Scale changes Electron's zoom factor, so fractional CSS-pixel geometry is legitimate. Changes involving scrolling, measurements, positioning, reflow, or animation boundaries must work at non-100% scales; do not treat subpixel differences from integer layout properties as stale or invalid state.
- Before adding or changing Shaka player controls, read `src/renderer/components/ft-shaka-video-player/README.md`.
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

- The npm `allow` list in `.github/dependabot.yml` must contain exactly the direct dependencies in `package.json` that are absent from the latest `upstream/development:package.json`; upstream manages shared ones. Fetch `upstream/development` and resync the list whenever dependencies or the Dependabot configuration change.
- Do not add migrations, compatibility aliases, or legacy handling for behavior or data formats introduced only by unshipped changes in the current PR. Change them directly; if that breaks local development data, tell the user instead of shipping a migration path.
- When `shaka-player` changes version, including through an upstream merge, follow the upgrade checklist in `src/renderer/components/ft-shaka-video-player/README.md`.

## Translations

When adding or changing translatable strings:

1. Update the human `en-US` and `de-DE` translations; Weblate handles other human locales.
2. Add or update AI completions for every other active locale in `static/locales/ai`, preserving placeholders and plural forms.
3. Run `node _scripts/aiTranslations.mjs cleanup --all --write` to drop AI entries that now have human translations.
4. In your final response, list every `de-DE` string you added or changed, with its key and the `en-US` source, so the user can review the German wording.

## Upstream, naming, and related repositories

- Merge `upstream/development`. Prefer OpenTubeX changes when resolving conflicts, and replace "FreeTube" with "OpenTubeX" in new translations. Add release notes to `release-notes/` for user-facing upstream changes in the same merge.
- Never use the FreeTube name or branding to promote OpenTubeX: not in repository descriptions or tags, store or package-repository listings (AUR, APT, RPM, Flatpak), the website, or other marketing material. See discussion #391.
- Related repositories (Website, APT, RPM, Flatpak, AUR) live next to the main checkout. Find it with `git worktree list --porcelain` (listed first) and look in its parent directory, not a linked worktree's parent. To change one, fetch its origin and create a worktree from origin's default branch instead of working in its main checkout.
