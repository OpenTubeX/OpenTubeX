# Pull request agent instructions

Follow these instructions when preparing or updating a pull request using `.github/PULL_REQUEST_TEMPLATE.md`.

## Template structure

Preserve every heading and comment in this template.

## Release notes and media

Release notes are files in `release-notes/`; follow `release-notes/README.md`. Add a note in the same pull request as the change, or check "No release note needed".
Before adding a note, read the pending notes in `release-notes/`. They cover everything since the latest release. When this change fixes or extends a change described there, update that note's wording and images in this pull request instead of adding a new one, and check "No release note needed" if it still fits.
For a noteworthy visible change, add media when it makes the change easier to understand. Prefer a still image unless motion is the point. Recordings must end up as animated WebP because release notes accept images, not video attachments.
After implementing a visible change, proactively capture the result and show the local media to the user for approval before uploading it or updating the pull request.
Request every media or release-note approval through your harness's structured question tool (for example, `AskUserQuestion` in Claude Code), with the local media shown first and options such as uploading, recapturing, or omitting it. Never ask for that approval in a plain chat message; fall back to one only when no such tool exists.
When the user has handed you the task to finish autonomously (for example with "full send"), skip the media and release-note approvals and use your own judgment: capture, inspect, and upload the media yourself under every rule below. Never omit media or leave a pending note outdated because nobody is available to approve it.
Use the default System Default theme pair for screenshots and recordings: `baseTheme: 'system'`, `systemDarkTheme: 'dark'`, and `systemLightTheme: 'light'`, with the default accent colors (`mainColor: 'Red'`, `secColor: 'Blue'`). Do not substitute OpenTubeX Dark/Light (`openTubeXDark` / `openTubeXLight`) or custom themes unless the user requests them or the change specifically concerns that theme.
Capture in a fresh temporary profile. In Playwright, switch the emulated system color scheme with `await page.emulateMedia({ colorScheme: 'dark' })` and then `'light'`, keeping the app theme preferences above. Before each capture, wait for the body to have the matching `dark` or `light` class, as in `e2e/screenshots/capture.spec.mjs`.
When the affected UI differs between dark and light themes, capturing both themes is required. A dark-only image is incomplete. The release note file must combine the hosted URLs into a theme-aware `<picture>` with dark and light `prefers-color-scheme` sources and the dark image as its `<img>` fallback. Never leave the two theme captures as separate images. Use a single default-dark capture only when the light theme cannot be captured or looks identical.
Capture or crop to the smallest region that still makes the change clear. Do not include the full window when the affected component can be understood on its own.
Use English unless localization is the subject. Keep components at their normal dimensions and placement instead of resizing them to fill the frame.
Use deterministic local fixtures for visible remote images. Reusable avatar and thumbnail fixtures are available through `e2e/helpers/visual-fixtures.mjs`. Before capturing, verify that every visible image has loaded successfully (`complete === true` and `naturalWidth > 0`).
Before taking still screenshots, wait for fonts, animations, transitions, and layout to settle after the last interaction. Confirm the capture region is unchanged in two screenshots at least 100 ms apart; a fixed delay alone is insufficient. Retake any image with animation artifacts before showing or uploading it. Exempt captures intentionally demonstrating motion or a failure.
Inspect the final dark and light files for failed images, missing content, unrelated UI, awkward animation, and misleading layout. Omit media when it does not explain the change clearly.
Use GitHub CLI 2.99.0 or newer to upload images no larger than 10 MB. Add an ordinary Markdown image reference to each local file in the pull request's Screenshots section, and pass the same files to `gh pr create` or `gh pr edit` with `--attach <path>` so GitHub CLI replaces the local paths with hosted URLs. Read back the hosted URLs and use them in the release note file. Combine a themed pair into a `<picture>`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="HOSTED_DARK_URL">
  <source media="(prefers-color-scheme: light)" srcset="HOSTED_LIGHT_URL">
  <img alt="DESCRIPTION" src="HOSTED_DARK_URL">
</picture>
```

For every MP4, MOV, or WebM recording, use `node _scripts/releaseNoteMedia.mjs FILE --alt "DESCRIPTION"` regardless of file size so the helper converts it to animated WebP and uploads it. Use the same command when an image exceeds 10 MB. For a themed pair where either file needs the helper, use `node _scripts/releaseNoteMedia.mjs --dark DARK_FILE --light LIGHT_FILE --alt "DESCRIPTION"`. Put its generated markup in the release note file.
Check for personal information, tokens, private repository names, and unrelated desktop content before uploading. Uploaded media is public.
Keep capture-only scripts, test hooks, screenshots, and recordings out of commits. Remove them before committing unless the capture code is also a reusable regression test. Never commit generated release-note media.
Leave out media when it would not help.

## Testing section

Only write human-facing steps that explain how to verify the change while running this branch in dev mode. Include expected results and, when applicable, helpful console snippets for interactive verification. Do not include automated checks, commands, results, pass counts, or CI status.
