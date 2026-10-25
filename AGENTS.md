# Project instructions

## Pull requests

Requests such as "implement issue #X" authorize local changes, not a PR. Open a PR only when the user explicitly requests or approves one for that repository. Approval for an application PR does not authorize a website PR, or vice versa.

- Give a milestone only to PRs that fix user-facing bugs or add user-facing features. Leave all other PRs without one, including upstream merges and syncs, CI, dependency, test, and documentation changes, and minor changes users won't notice.
- For a PR that needs a milestone, copy the linked issue's milestone. If it has none, assign the open milestone with the lowest version in its title: query open milestones with `gh api --paginate` and compare titles by numeric version order (1.10 after 1.9), not alphabetically or by milestone number. Pass the exact title to `gh pr create --milestone` or `gh pr edit --milestone`. If no version milestone is open, report that instead of creating one.
- When a PR with a milestone is created, gains a closing issue link, or changes milestone, assign its milestone to every issue it closes that has none, immediately, even while the PR is open. Keep existing issue milestones and verify the assignments on GitHub.
- Follow `.github/PULL_REQUEST_TEMPLATE.md` for release-note screenshots and recordings.

## Documentation

- Create new documentation, writeups, implementation notes, plans, or summaries only when requested; explain changes and validation in the PR description. Update existing documentation only when the change makes it inaccurate.
- When a behavior change could invalidate a user guide in `OpenTubeX/opentubex.github.io`, check it. For a material inaccuracy, name the guide and passage, step, or screenshot, explain the mismatch, and get approval before changing the website, unless already authorized. Limit the update to those inaccuracies and link the application and website PRs. New features and cosmetic differences alone need no update or approval request.

## Testing

- Run the relevant checks: `pnpm run test:unit` (unit tests and AI locale validation), `pnpm run lint` (JavaScript/Vue and styles), `pnpm run lint-json` (static JSON), `pnpm run lint-yml` (YAML), and filtered E2E tests for affected Electron flows.
- Fix unrelated test failures, including flaky ones and tests that pass on retry: reproduce on the latest `origin/development`, find the root cause, fix and verify it, and push directly to `origin/development`, however large the fix is (authorized without further approval; keep it out of the current task's branch and PR). Never skip, quarantine, or defer the test (`test.fixme`, `test.skip`, follow-up issues), and never loosen an assertion to hide a regression. Then rebase the working branch onto the updated `origin/development` and rerun the affected checks.
- For bugfixes, demonstrate the failure first, add a regression test where practical, and verify the fix. Verify new features with checks appropriate to the affected code. If automated verification is impractical, explain why and report the evidence used, unless the user waived verification.
- When changing sync-server collections or capabilities, search tests for and update every expectation for collection lists, upload counts, and capabilities, including capability-dependent cases in `e2e/tests/network/sync-server.spec.mjs`, and run the affected E2E test against a local server with the new capability.
- Many unit tests read source files as text and slice them by exact markers and indentation. When moving or reformatting code, grep `tests/` and `e2e/` for the file and the moved names, and point those tests at the new location without changing their assertions.

### E2E

- Before running E2E tests, `dist-e2e` must reflect the current sources, assets, and build configuration. Run `pnpm run test:e2e:pack` if it is missing, any of those changed, or its freshness is uncertain, including when running unchanged tests against application changes.
- For filtered runs, invoke Playwright directly, for example `pnpm exec playwright test -c e2e/playwright.config.mjs e2e/tests/network/channel.spec.mjs --project=network --grep "test name"`. Never use `pnpm run test:e2e -- ...`; the extra `--` breaks argument parsing and can launch the full suite.
- On a user's graphical desktop, keep test windows out of their session. On Linux with Xvfb installed, each worker starts a private display automatically; do not set `E2E_XVFB=0`. Otherwise install Xvfb or use another private X server. Not needed in CI or headless environments.
- Tag offline tests that assert geometry, scrolling, measurements, positioning, reflow, or animation boundaries with `@scale` instead of looping over scales; the `offline-95` and `offline-125` projects rerun them, and the `uiScale` fixture holds the current value.
- Put performance checks in `*-performance.spec.mjs` files or tag them `@performance`. Prefer deterministic work counts over wall-clock budgets; the paired performance comparison covers timing.

### Android

- Debug builds install as `org.opentubex.app.dev` (OpenTubeX Dev). Launch `org.opentubex.app.dev/org.opentubex.app.MainActivity`; instrumentation uses `org.opentubex.app.dev.test`. Use `assembleNightly` only to build the published nightly identity. See `android/SIGNING.md`.
- Verify Android-targeted work (native code, Capacitor behavior, mobile-only components affecting Android, bugs seen on Android) on an emulator with a current debug APK, and report the API level, WebView version, and result. Electron tests and mobile-sized viewports do not replace this.
- iOS-only changes do not need an emulator, nor do shared renderer or CSS changes merely because the component also appears on phones; cover responsive effects with Electron tests. Use the emulator if an Android-specific failure emerges.

## Code organization

- Keep new OpenTubeX code out of files that also exist in `upstream/development`. Put each feature in its own module: an `opentubex/` folder beside the component or view, `src/renderer/app/` for `App.vue`, or a sibling module in `src/main/`. Hook it in with an import plus one call, spread, or composable invocation. Leave upstream code where it is, even where OpenTubeX changed it.
- `ft-shaka-video-player.vue` loads `ft-shaka-video-player.css` first and the `opentubex/*.css` feature files after it, so the `<style>` order is the cascade order. Add rules to the feature file they belong to. If an upstream rule of equal specificity must override a new rule, put the new rule in `ft-shaka-video-player.css` before it.

## UI

- After any visual change or implementation, show the user a screenshot (static appearance) or short recording (interaction, animation, transitions) of the finished result in the final response.
- UI Scale changes Electron's zoom factor, so fractional CSS-pixel geometry is legitimate. Changes involving scrolling, measurements, positioning, reflow, or animation boundaries must work at non-100% scales; do not treat subpixel differences from integer layout properties as stale or invalid state.
- Custom Shaka overflow-menu controls must hide while a submenu is open; follow the `submenuopen` / `submenuclose` pattern using `isSubMenuOpened` and `shaka-hidden`.
- Labeled action buttons, such as Enable, Load more, Refresh, and Reset, need a relevant icon from the registry beside their visible label; hide decorative icons from assistive technology.

### Icons

- Register new icons in the icon registry and map them for every supported pack: Material and Remix. If neither pack has a suitable glyph, use a raw custom icon without a registry entry.
- Visually inspect Material and Remix glyphs when adding or changing mappings. Ask for human confirmation only when their meaning or fit is ambiguous.

### Scrolling

- Every nested scrollable element must use `v-overlay-scrollbars` (or `addOverlayScrollbars` outside Vue) to match the theme and scrollbar settings. Native nested scrollbars are a bug unless documented as an exception. Verify the integration whenever adding or changing scrollable CSS.
- Keep headers outside the scroll viewport so content and scrollbars cannot pass behind them; prefer a fixed header with a separate inner scroller.
- When switching menu views, restore the viewport position of OverlayScrollbars-managed elements with `restoreOverlayScrollTop`. After DOM updates that reduce the scroll range, call `clampOverlayScrollTop` with the rendered content end, observing a stable content wrapper when practical. Do not rely on focus, DOM replacement, or a possibly stale `scrollHeight`.
- Cover every relevant range-reducing trigger (resize, responsive layout changes, searching, filtering, collapsing, removing, replacing content) with regression tests: scroll to the bottom first, then verify valid offsets, no empty space, and scrollbar thumb/overflow state matching the new range.

## Dependencies and data formats

- The npm `allow` list in `.github/dependabot.yml` must contain exactly the direct dependencies in `package.json` that are absent from the latest `upstream/development:package.json`; upstream manages shared ones. Fetch `upstream/development` and resync the list whenever dependencies or the Dependabot configuration change.
- Do not add migrations, compatibility aliases, or legacy handling for behavior or data formats introduced only by unshipped changes in the current PR. Change them directly; if that breaks local development data, tell the user instead of shipping a migration path.

## Translations

When adding or changing translatable strings:

1. Update the human `en-US` and `de-DE` translations; Weblate handles other human locales.
2. Add or update AI completions for every other active locale in `static/locales/ai`, preserving placeholders and plural forms.
3. Run `node _scripts/aiTranslations.mjs cleanup --all --write` to drop AI entries that now have human translations.

## Upstream, naming, and related repositories

- Merge `upstream/development`. Prefer OpenTubeX changes when resolving conflicts, and replace "FreeTube" with "OpenTubeX" in new translations.
- After an upstream merge, check that no upstream method or computed property has the same name as one spread in from an OpenTubeX module, for example in `Watch.js`. The later key replaces the earlier one without a warning.
- Never use the FreeTube name or branding to promote OpenTubeX: not in repository descriptions or tags, store or package-repository listings (AUR, APT, RPM, Flatpak), the website, or other marketing material. See discussion #391.
- Related repositories (Website, APT, RPM, Flatpak, AUR) live next to the main checkout. Find it with `git worktree list --porcelain` (listed first) and look in its parent directory, not a linked worktree's parent. To change one, fetch its origin and create a worktree from origin's default branch instead of working in its main checkout.
