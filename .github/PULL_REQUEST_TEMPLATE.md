<!-- Thanks for sending a pull request! Make sure to follow the contributing guidelines. -->
<!-- Important note, we may remove your pull request if you do not use this provided PR template correctly. -->
<!-- Agent instructions: Preserve every heading, comment, and marker in this template. Never remove or rewrite the release-note-category:start/end, release-note:start/end, or release-note-image:start/end marker pairs. -->

## Pull Request Type
<!-- Please select what type of pull request this is: [x] -->
- [ ] Bugfix
- [ ] Feature Implementation
- [ ] Documentation
- [ ] Other

## Related issue
<!-- Please link the issue your pull request is referring to. -->
<!-- If this pull request fully resolves the relevant issue, put "closes" before the issue number. -->
<!-- Example: "closes #123456". -->

## Description
<!-- Please write a clear and concise description of what the pull request does. -->

## Release note category
<!-- Select exactly one category. Every pull request must select one. -->
<!-- Select "Not noteworthy" when the pull request fixes a bug in or improves functionality that has not yet appeared in a stable release. -->
<!-- release-note-category:start -->
- [ ] Not noteworthy
- [ ] Highlights
- [ ] More improvements
- [ ] Fixed bugs
<!-- release-note-category:end -->

## Release note
<!-- Required unless "Not noteworthy" is selected. -->
<!-- Write one concise, user-facing entry without a leading bullet. -->
<!-- release-note:start -->

<!-- release-note:end -->

## Release note images
<!-- Optional. Paste one or more Markdown images, HTML image tags, or dark/light <picture> elements here. -->
<!-- The release notes normalize the markup and limit images taller than 300 pixels. -->
<!-- Agent instructions:
For a noteworthy visible change, add media when it makes the change easier to understand. Prefer a still image unless motion is the point; recordings must use animated WebP.
After implementing a visible change, proactively capture the result and show the local media to the user for approval before uploading it or updating the pull request.
Capture the default dark theme. When both app themes can be captured and differ, run `node _scripts/releaseNoteMedia.mjs --dark DARK_FILE --light LIGHT_FILE --alt "DESCRIPTION"`. GitHub will display the matching theme and use dark as the fallback.
Capture or crop to the smallest region that still makes the change clear. Do not include the full window when the affected component can be understood on its own.
Use English unless localization is the subject. Keep components at their normal dimensions and placement instead of resizing them to fill the frame.
Use deterministic local fixtures for visible remote images. Reusable avatar and thumbnail fixtures are available through `e2e/helpers/visual-fixtures.mjs`. Before capturing, verify that every visible image has loaded successfully (`complete === true` and `naturalWidth > 0`).
Inspect the final dark and light files for failed images, missing content, unrelated UI, awkward animation, and misleading layout. Omit media when it does not explain the change clearly.
For one dark capture, run `node _scripts/releaseNoteMedia.mjs FILE --alt "DESCRIPTION"`.
Check for personal information, tokens, private repository names, and unrelated desktop content before uploading. Uploaded media is public.
Keep capture-only scripts, test hooks, screenshots, and recordings out of commits. Remove them before committing unless the capture code is also a reusable regression test. Never commit generated release-note media.
Paste only the generated markup between the marker comments. Leave this section empty when media would not help.
-->
<!-- release-note-image:start -->

<!-- release-note-image:end -->

## Testing
<!-- How can reviewers verify that the PR produces correct results? -->
<!-- Please provide instructions so that others can ensure that your pull request would produce correct results. For examples see, https://github.com/FreeTubeApp/FreeTube/pull/5743, https://github.com/FreeTubeApp/FreeTube/pull/7349, https://github.com/FreeTubeApp/FreeTube/pull/5125, https://github.com/FreeTubeApp/FreeTube/pull/7338 -->
<!-- Agent instructions: Only write human-facing steps that explain how to verify the change while running this branch in dev mode. Include expected results and, when applicable, helpful console snippets for interactive verification. Do not include automated checks, commands, results, pass counts, or CI status. -->

## Additional context
<!-- Add any other context about the pull request here. -->
