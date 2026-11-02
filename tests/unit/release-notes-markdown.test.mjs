import assert from 'node:assert/strict'
import test from 'node:test'

import { createReleaseNotesMarkdown, resolvePictureColorScheme } from '../../src/renderer/helpers/releaseNotesMarkdown.js'

const markdown = createReleaseNotesMarkdown()
const COMMIT_HASH = '3904e64f503cde6be8793606a04ad69c5d57cef0'

test('renders GitHub alerts without showing their marker', () => {
  const html = markdown.parse('> [!WARNING] This nightly build may be unstable.')

  assert.match(html, /<blockquote data-alert="warning">/)
  assert.match(html, /This nightly build may be unstable\./)
  assert.doesNotMatch(html, /\[!WARNING\]/)
})

test('preserves details and summary elements and expands them', () => {
  const html = markdown.parse('<details>\n<summary>Show changes</summary>\n\n- A change\n</details>')

  assert.match(html, /<details open>/)
  assert.match(html, /<summary>Show changes<\/summary>/)
})

test('links commit hashes to their commit page', () => {
  const html = markdown.parse(`Automated development build from commit ${COMMIT_HASH}.`)

  assert.match(html, new RegExp(`<a href="https://github\\.com/OpenTubeX/OpenTubeX/commit/${COMMIT_HASH}"><code>3904e64</code></a>`))
})

test('leaves commit hashes that are already part of a link or code span alone', () => {
  const commitUrl = `https://github.com/OpenTubeX/OpenTubeX/commit/${COMMIT_HASH}`

  assert.doesNotMatch(markdown.parse(`See ${commitUrl}`), /<a[^>]*><a/)
  assert.match(markdown.parse(`\`${COMMIT_HASH}\``), new RegExp(`<code>${COMMIT_HASH}</code>`))
})

test('shortens issue links and references', () => {
  assert.match(
    markdown.parse('Fixed in #499'),
    /<a href="https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/issues\/499">#499<\/a>/
  )
  assert.match(
    markdown.parse('Fixed in [x](https://github.com/freetubeapp/freetube/issues/499)'),
    /<a href="https:\/\/github\.com\/freetubeapp\/freetube\/issues\/499">freetubeapp#499<\/a>/
  )
})

test('replaces pictures with an img showing the source for the app color scheme', () => {
  const html = markdown.parse([
    '- A change. (#1)',
    '  <picture>',
    '    <source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark">',
    '    <source media="(prefers-color-scheme: light)" srcset="https://example.com/light">',
    '    <img src="https://example.com/dark" alt="Settings > Screenshot" width="844">',
    '  </picture>'
  ].join('\n'))

  for (const colorScheme of /** @type {const} */ (['dark', 'light'])) {
    const resolved = resolvePictureColorScheme(html, colorScheme)
    assert.doesNotMatch(resolved, /<picture|<source/)
    assert.match(resolved, new RegExp(`<img src="https://example\\.com/${colorScheme}" alt="Settings > Screenshot" width="844">`))
  }
})

test('keeps the img fallback of pictures without a source for the app color scheme', () => {
  const html = '<picture><source media="(min-width: 800px)" srcset="https://example.com/wide"><img src="https://example.com/fallback" alt=""></picture>'

  assert.equal(resolvePictureColorScheme(html, 'light'), '<img src="https://example.com/fallback" alt="">')
})
