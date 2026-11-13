# Contributing to OpenTubeX

Thanks for helping out. A small team maintains OpenTubeX in its spare time, so we can review and merge clear, tested pull requests fastest.

## Ways to help

* Send bug fixes and features as pull requests, as described below.
* Translate OpenTubeX on [Weblate](https://weblate.opentubex.org/engage/opentubex/).
* Report bugs and request features with the [issue templates](https://github.com/OpenTubeX/OpenTubeX/issues/new/choose).
* Report security issues privately as described in [SECURITY.md](SECURITY.md).

For now, we use the [GitLab mirror](https://gitlab.com/opentubex/OpenTubeX) only for issues, which sync to GitHub. Merge requests and everything else are disabled there, so send code changes as pull requests on GitHub.

Ask questions on [Discussions](https://github.com/OpenTubeX/OpenTubeX/discussions), our [Fluxer](https://fluxer.opentubex.org) server, or the [Matrix space](https://matrix.opentubex.org) `#opentubex:matrix.org`.

## Before you start

* **Features.** Open an issue first, or comment on the existing one, so we can agree on the approach before you write code. Small bug fixes can go straight to a pull request.
* **Bugs that also exist in FreeTube.** OpenTubeX regularly merges the `development` branch of [FreeTube](https://github.com/FreeTubeApp/FreeTube). You can fix a shared bug here, but we prefer a fix upstream, because the next merge brings it to both projects. FreeTube does not accept AI-assisted contributions, so send upstream only work you wrote yourself, and follow [its guidelines](https://github.com/FreeTubeApp/FreeTube/blob/development/CONTRIBUTING.md).
* **AI-assisted work.** We develop OpenTubeX extensively with AI tools and welcome AI-assisted pull requests. You are responsible for the result, so understand the change, test it, and fill in the pull request template. Give your coding agent the project rules in [AGENTS.md](AGENTS.md). Many agents read that file automatically. End the pull request description with the model and tool that made the changes, for example "Made with Claude Opus 5.5 in Claude Code."
* **Larger features.** Plan to stay around and fix bugs in your code after it is merged.

## Setting up

1. Install [Node.js](https://nodejs.org/) 24 and Git.
2. Enable pnpm with `corepack enable`. Corepack installs the version pinned in `package.json`.
3. Fork and clone the repository, then run `pnpm install`. This also installs the Git hooks, which lint and typecheck staged files before each commit.
4. Start the app:
   * `pnpm run dev` runs the desktop app with hot reload.
   * `pnpm run dev:web` runs the web build in your browser.
   * `pnpm run dev:worktree` uses a separate profile and a free port, so you can run several checkouts at once.

For Android, run `pnpm run capacitor:sync:android`, then `./gradlew assembleDebug` in `android/`. Debug builds install as OpenTubeX Dev (`org.opentubex.app.dev`) next to the published apps; see [android/SIGNING.md](android/SIGNING.md). For iOS, run `pnpm run capacitor:sync:ios` on macOS and open `ios/App/App.xcodeproj` in Xcode.

## Making changes

* **Style.** Match the surrounding code. ESLint and Stylelint enforce most rules. Use JSDoc for functions whose purpose or types are not obvious. Write code, comments, and commit messages in American English.
* **Commits.** Use [semantic commit messages](https://www.conventionalcommits.org/), for example `fix(player): keep the seek bar stable while dragging`.
* **Dependencies.** Add one only when you need it. It must be free software. It must not add trackers or telemetry, or contact third-party services the feature doesn't need, such as Google Fonts. Use its latest stable release and commit the updated `pnpm-lock.yaml`.
* **Translations.** Add new strings to `static/locales/en-US.yaml`. Add human translations for any other languages you know to their files in `static/locales`. Every other active locale needs an AI completion in `static/locales/ai/<locale>.yaml`, and `pnpm run test:unit` fails if one is missing. Keep the placeholders and plural forms, then run `node _scripts/aiTranslations.mjs cleanup --all --write`. To fix an existing translation, use Weblate.
* **UI.**
  * Register new icons in `src/renderer/icons` with mappings for both the Material and Remix icon packs.
  * Nested scrollable elements use `v-overlay-scrollbars`, not native scrollbars.
  * Layouts must work at UI Scale settings other than 100%.
  * Labeled action buttons such as Refresh or Reset get an icon next to the label.
* **Player controls.** Read [the player README](src/renderer/components/FtShakaVideoPlayer/README.md) before adding or changing them.

## Testing

Run the checks for the areas you changed:

| Command | Checks |
| --- | --- |
| `pnpm run lint` | JavaScript, Vue, styles, and release notes |
| `pnpm run typecheck` | Files that start with `// @ts-check` |
| `pnpm run test:unit` | Unit tests and AI translations |
| `pnpm run lint-json` / `pnpm run lint-yml` | Static JSON and YAML files |

`pnpm run lint-fix` fixes many lint errors for you.

If you change an Electron flow, run its end-to-end tests. Build the test app with `pnpm run test:e2e:pack`, then run only the affected tests, for example `pnpm exec playwright test -c e2e/playwright.config.mjs e2e/tests/offline/<file>.spec.mjs --project=offline`. On Linux, install Xvfb to keep test windows off your desktop. See [e2e/README.md](e2e/README.md) for details. Pull requests don't run the full offline suite, so also run the tests for features near your change.

Also try the change by hand. Check that core features such as playing videos and loading subscriptions still work. Changes to data loading need to work with the local API as well as Invidious instances and Yattee servers. Check the platforms your change affects: desktop, Android, iOS, or the web build.

## Opening a pull request

* Target the `development` branch and keep your branch up to date with it.
* Fill in every section of the pull request template, and link the issue, for example with `closes #123`.
* Add screenshots or a short recording for visible changes.
* Add a release note if most users will notice the change. Most pull requests need none. See [release-notes/README.md](release-notes/README.md).
* Your contribution is published under the [GNU Affero General Public License v3](LICENSE) or later.
