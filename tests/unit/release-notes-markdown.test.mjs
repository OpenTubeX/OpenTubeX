import assert from 'node:assert/strict'
import test from 'node:test'

import { createReleaseNotesMarkdown } from '../../src/renderer/helpers/releaseNotesMarkdown.js'

const markdown = createReleaseNotesMarkdown({ renderLink: () => false })

test('renders GitHub alerts without showing their marker', () => {
  const html = markdown.parse('> [!WARNING] This nightly build may be unstable.')

  assert.match(html, /<blockquote data-alert="warning">/)
  assert.match(html, /This nightly build may be unstable\./)
  assert.doesNotMatch(html, /\[!WARNING\]/)
})

test('preserves details and summary elements', () => {
  const html = markdown.parse('<details>\n<summary>Show changes</summary>\n\n- A change\n</details>')

  assert.match(html, /<details>/)
  assert.match(html, /<summary>Show changes<\/summary>/)
})
