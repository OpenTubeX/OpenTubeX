# Project instructions

## Pull requests

Requests such as "implement issue #X" authorize local changes, not a PR. Open a PR only when the user explicitly requests or approves one for that repository. Approval for an application PR does not authorize a website PR, or vice versa.

- For every PR opened in this repository, copy the linked issue's milestone if it has one. Otherwise, automatically assign the currently open milestone with the lowest version in its title. Query open milestones with `gh api --paginate` at PR creation time and compare titles by numeric version order, not alphabetical order or milestone number. Use the exact title with `gh pr create --milestone` or `gh pr edit --milestone`. If the issue has no milestone and no version milestone is open, report that instead of creating one.
- When creating a PR, adding a closing issue link, or assigning/changing its milestone, check every issue the PR closes. If the PR has a milestone and an issue has none, assign that issue the PR's milestone immediately, even while the PR is still open. Preserve existing issue milestones and verify the assignments on GitHub before considering the PR work complete.

## Documentation

- Create new documentation, feature writeups, implementation notes, plans, or task summaries only when requested; put change explanations and validation details in the PR description. Update existing documentation only when the change makes it inaccurate. Check user guides in `OpenTubeX/opentubex.github.io` when behavior changes could invalidate them. For a material inaccuracy, name the affected guide and passage, step, or screenshot, explain the mismatch, and obtain approval before changing the website or opening its separate PR unless already authorized. Limit approved updates to those inaccuracies and link the application and website PRs when both exist. New features and cosmetic differences alone do not require documentation updates or an approval request.

## Testing

- When encountering test failures unrelated to the current task, reproduce and fix them on `development`, verify the fixes, then rebase the current working branch onto the updated `development` and rerun the affected checks.
- Local Android debug builds install as `org.opentubex.app.dev` (OpenTubeX Dev). Launch `org.opentubex.app.dev/org.opentubex.app.MainActivity`; instrumentation uses `org.opentubex.app.dev.test`. Reserve `assembleNightly` for intentionally building the published nightly identity. See `android/SIGNING.md`.
- When a task targets Android behavior (such as native Android code, Capacitor behavior or a mobile-only component affecting Android, or a bug reported or reproduced on Android), verify it on an Android emulator using a current debug APK before considering the work done. Report the emulator API level, WebView version, and observed result; Electron tests and mobile-sized desktop viewports do not replace this check. iOS-only changes do not require Android verification. Shared renderer or CSS changes do not require an emulator merely because the component also appears on phones; cover their responsive effects with relevant Electron tests. If an Android-specific failure emerges during that work, verify it on an emulator.
- For bugfixes, demonstrate the failure before applying the fix, add a regression test where practical, and verify the fix afterward. Verify new features with checks appropriate to the affected code. If automated reproduction or verification is impractical, explain why and report the evidence used, unless the user explicitly waived verification.
- Run the relevant checks: `pnpm run test:unit` for unit tests, `pnpm run lint` for JavaScript/Vue and styles, `pnpm run lint-json` for static JSON, and `pnpm run lint-yml` for YAML. Use the filtered E2E command below for affected Electron flows.
- When changing sync-server collections or capabilities, search tests for exact collection lists, upload counts, and capability assertions. Update every affected expectation, including capability-dependent cases in `e2e/tests/network/sync-server.spec.mjs`, and run the affected filtered E2E test against a local server with the new capability before considering the change done.
- When running Electron/Playwright E2E tests on a user's graphical desktop, use a private X server so test windows do not appear in their session. For example: `xvfb-run -a -s "-screen 0 1920x1080x24"`. The exact command may vary, and this is not required in CI or other isolated/headless environments.
- For filtered Electron/Playwright E2E runs, invoke Playwright directly, for example `pnpm exec playwright test -c e2e/playwright.config.mjs e2e/tests/network/channel.spec.mjs --project=network --grep "test name"`. Never use `pnpm run test:e2e -- ...`; the extra `--` stops Playwright from parsing the following path and options and can launch the full suite.
- Before running Electron/Playwright E2E tests, ensure `dist-e2e` reflects the current application sources, assets, and build configuration. Run `pnpm run test:e2e:pack` if the package is missing, any of those inputs have changed, or its freshness is uncertain. This also applies when running unchanged tests against application changes.

## UI

- After completing any visual change or implementation, always show the user a screenshot or short recording of the finished result in the final response. Use screenshots for static appearance and recordings when interaction, animation, or transitions are needed to demonstrate the change.
- Follow `.github/PULL_REQUEST_TEMPLATE.md` for release-note screenshot and recording instructions.
- The in-app UI Scale setting changes Electron's zoom factor and can produce legitimate fractional CSS-pixel geometry. Changes involving scrolling, measurements, positioning, reflow, or animation boundaries must also work at non-100% UI scales; do not treat a subpixel difference from integer layout properties as stale or invalid state.
- Custom Shaka overflow-menu controls must hide while any submenu is open; follow the existing `submenuopen` / `submenuclose` visibility pattern using `isSubMenuOpened` and `shaka-hidden`.
- Keep headers outside the content's scroll viewport so content and scrollbars cannot pass behind them. Prefer a fixed header and separate inner scroller.
- Restore the actual viewport position when switching menu views using `restoreOverlayScrollTop` for OverlayScrollbars-managed elements. After DOM updates that shorten content or reduce its scroll range, use `clampOverlayScrollTop` with the rendered content end; observe a stable content wrapper when practical. Do not rely on focus, DOM replacement, or a possibly stale `scrollHeight`.
- For scrolling changes, cover every relevant content-shortening or scroll-range-reducing trigger with regression tests, including resize, responsive layout changes, searching, filtering, collapsing, removing, and replacing content. Scroll to the bottom before each trigger and verify valid offsets, no empty space, and scrollbar thumb/overflow state matching the new range.
- Every nested scrollable element must use `v-overlay-scrollbars`, or `addOverlayScrollbars` for elements outside Vue, to match the active theme and scrollbar settings. Treat native nested scrollbars as a bug unless explicitly documented as an exception; verify the integration whenever adding or changing scrollable CSS.
- New icons must be registered in the icon registry and mapped for every currently supported icon pack: Material and Remix. If neither pack has a suitable glyph, a raw custom icon may be used directly without a registry entry or pack mappings.
- Labeled action buttons, such as Enable, Load more, Refresh, and Reset, must include a relevant icon alongside their text. Reuse the icon registry and keep the visible label; decorative icons must be hidden from assistive technology.
- When adding or changing icon-pack mappings, visually inspect the glyphs in Material and Remix. Ask for human confirmation only when their meaning or visual suitability is ambiguous.

## Dependencies and data formats

- Keep the npm `allow` list in `.github/dependabot.yml` limited to direct dependencies in this repository's `package.json` that are absent from the latest `upstream/development:package.json`. Upstream manages shared npm dependencies. Whenever changing dependencies or the Dependabot configuration, fetch `upstream/development` and update the allowlist to match that exact difference.
- Do not add migrations, compatibility aliases, or legacy handling for behavior or data formats introduced only by unshipped changes in the current PR. Change unreleased data directly; if that breaks local development data, tell the user in the task instead of shipping a migration path.

## Translations

- When adding or changing translatable strings, update the English (`en-US`) and German (`de-DE`) human translations. Weblate handles every other human locale. Also add or update the corresponding AI-generated completions for every other active locale in `static/locales/ai`, preserving placeholders and locale plural forms. After syncing human translations, run `node _scripts/aiTranslations.mjs cleanup --all --write` to remove AI entries that now have human translations. The AI locale validator runs with the unit tests.

## Related repositories and naming

- Related repositories such as Website, APT, RPM, Flatpak, and AUR live alongside the main OpenTubeX checkout. Use `git worktree list --porcelain` to locate the main checkout, listed first, then look in its parent directory. Do not assume a linked worktree's parent contains these repositories. When changing a related repository, fetch its origin and create a worktree from the latest commit on origin's default branch instead of working in its main checkout.
- Never use the "FreeTube" name for promotion of the project. See discussion #391 for details when in doubt.
