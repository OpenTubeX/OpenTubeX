import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeReleaseImage,
  parseReleaseNote,
  probeImageSize,
  renderReleaseNotes,
  validateDownloadedImageUrl,
  validatePullRequestEvent,
} from '../../_scripts/releaseNotes.mjs'

const NOTE_MARKERS = `
<!-- release-note:start -->
Adds a compact player.
<!-- release-note:end -->
`

function png(width, height) {
  const buffer = Buffer.alloc(24)

  Buffer.from('\x89PNG\r\n\x1a\n', 'binary').copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)

  return buffer
}

test('release notes are required only for noteworthy pull requests', () => {
  assert.equal(validatePullRequestEvent({
    pull_request: {
      body: '',
      labels: [],
    },
  }), null)

  assert.throws(() => validatePullRequestEvent({
    pull_request: {
      body: '',
      labels: [{ name: 'noteworthy-for-release' }],
    },
  }), /Fill in the release note section/)
})

test('a release note and optional Markdown image are parsed', () => {
  const result = parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
![Compact player](https://github.com/user-attachments/assets/example)
<!-- release-note-image:end -->
`)

  assert.deepEqual(result, {
    image: {
      alt: 'Compact player',
      url: 'https://github.com/user-attachments/assets/example',
    },
    note: 'Adds a compact player.',
  })
})

test('HTML entities in image attributes are decoded only once', () => {
  const result = parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
<img src="https://github.com/user-attachments/assets/example?name=a&amp;amp;b" alt="A &amp; B">
<!-- release-note-image:end -->
`)

  assert.deepEqual(result.image, {
    alt: 'A & B',
    url: 'https://github.com/user-attachments/assets/example?name=a&amp;b',
  })
})

test('GitHub user attachment storage redirects are accepted narrowly', () => {
  assert.equal(
    validateDownloadedImageUrl('https://github-production-user-asset-6210df.s3.amazonaws.com/image.png').hostname,
    'github-production-user-asset-6210df.s3.amazonaws.com',
  )
  assert.throws(
    () => validateDownloadedImageUrl('https://untrusted-bucket.s3.amazonaws.com/image.png'),
    /must be hosted by GitHub/,
  )
})

test('image dimensions are read from PNG data', () => {
  assert.deepEqual(probeImageSize(png(640, 480)), {
    height: 480,
    width: 640,
  })
})

test('images taller than 300 pixels receive only a height attribute', async () => {
  const result = await normalizeReleaseImage({
    alt: 'Compact player',
    url: 'https://github.com/user-attachments/assets/example',
  }, 'Fallback', async () => png(800, 301))

  assert.equal(
    result,
    '<img src="https://github.com/user-attachments/assets/example" alt="Compact player" height="300">',
  )
})

test('images up to 300 pixels have no dimensions', async () => {
  const result = await normalizeReleaseImage({
    alt: '',
    url: 'https://github.com/user-attachments/assets/example',
  }, 'Compact player', async () => png(800, 300))

  assert.equal(
    result,
    '<img src="https://github.com/user-attachments/assets/example" alt="Compact player">',
  )
})

test('release notes render as highlights with normalized image tags', async () => {
  const result = await renderReleaseNotes([
    {
      body: `
${NOTE_MARKERS}
<!-- release-note-image:start -->
<img src="https://github.com/user-attachments/assets/example" alt="Screenshot" width="800" height="600">
<!-- release-note-image:end -->
`,
      number: 42,
      title: 'Compact player',
    },
    {
      body: `
<!-- release-note:start -->
Adds keyboard shortcuts.
<!-- release-note:end -->
`,
      number: 43,
      title: 'Keyboard shortcuts',
    },
  ], async () => png(800, 600))

  assert.equal(result, `# Highlights

- Adds a compact player.
  <img src="https://github.com/user-attachments/assets/example" alt="Screenshot" height="300">

- Adds keyboard shortcuts.
`)
})
