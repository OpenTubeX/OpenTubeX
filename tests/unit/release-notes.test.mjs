import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeReleaseImage,
  normalizePullRequestPages,
  parseReleaseNote,
  parseReleaseNoteCategory,
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

const categoryMarkers = (category) => `
<!-- release-note-category:start -->
- [${category === 'Not noteworthy' ? 'x' : ' '}] Not noteworthy
- [${category === 'Highlights' ? 'x' : ' '}] Highlights
- [${category === 'More improvements' ? 'x' : ' '}] More improvements
- [${category === 'Fixed bugs' ? 'x' : ' '}] Fixed bugs
<!-- release-note-category:end -->
`

function png(width, height) {
  const buffer = Buffer.alloc(24)

  Buffer.from('\x89PNG\r\n\x1a\n', 'binary').copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)

  return buffer
}

function jpeg(width, height) {
  const buffer = Buffer.alloc(18)

  buffer.set([0xff, 0xd8, 0xff, 0xe0])
  buffer.writeUInt16BE(4, 4)
  buffer.set([0xff, 0xc0], 8)
  buffer.writeUInt16BE(8, 10)
  buffer[12] = 8
  buffer.writeUInt16BE(height, 13)
  buffer.writeUInt16BE(width, 15)

  return buffer
}

function webp(type, width, height) {
  const buffer = Buffer.alloc(30)

  buffer.write('RIFF', 0)
  buffer.write('WEBP', 8)
  buffer.write(type, 12)

  if (type === 'VP8X') {
    buffer.writeUIntLE(width - 1, 24, 3)
    buffer.writeUIntLE(height - 1, 27, 3)
  } else if (type === 'VP8 ') {
    buffer.writeUInt16LE(width, 26)
    buffer.writeUInt16LE(height, 28)
  } else {
    buffer.writeUInt32LE((width - 1) | ((height - 1) << 14), 21)
  }

  return buffer
}

test('every pull request requires exactly one release note category', () => {
  assert.deepEqual(validatePullRequestEvent({
    pull_request: {
      body: categoryMarkers('Not noteworthy'),
    },
  }), {
    category: 'Not noteworthy',
  })

  assert.throws(() => validatePullRequestEvent({
    pull_request: {
      body: '',
    },
  }), /Select one release note category/)

  assert.throws(() => parseReleaseNoteCategory(`
<!-- release-note-category:start -->
- [x] Highlights
- [x] Fixed bugs
<!-- release-note-category:end -->
`), /Select exactly one release note category/)
})

test('release notes are required for noteworthy categories', () => {
  assert.throws(() => validatePullRequestEvent({
    pull_request: {
      body: categoryMarkers('Highlights'),
    },
  }), /Fill in the release note section/)
})

test('paginated pull request results are flattened', () => {
  assert.deepEqual(normalizePullRequestPages([
    {
      data: {
        repository: {
          pullRequests: {
            nodes: [{
              body: 'First',
              closingIssuesReferences: { nodes: [{ number: 10 }] },
              mergeCommit: { oid: 'first' },
              mergedAt: '2026-01-01T00:00:00Z',
              number: 1,
              title: 'First PR',
              url: 'https://github.com/OpenTubeX/OpenTubeX/pull/1',
            }],
          },
        },
      },
    },
    {
      data: {
        repository: {
          pullRequests: {
            nodes: [{
              body: 'Second',
              mergeCommit: { oid: 'second' },
              mergedAt: '2026-02-01T00:00:00Z',
              number: 2,
              title: 'Second PR',
              url: 'https://github.com/OpenTubeX/OpenTubeX/pull/2',
            }],
          },
        },
      },
    },
  ]), [{
    body: 'First',
    closingIssuesReferences: { nodes: [{ number: 10 }] },
    mergeCommit: { oid: 'first' },
    mergedAt: '2026-01-01T00:00:00Z',
    number: 1,
    title: 'First PR',
    url: 'https://github.com/OpenTubeX/OpenTubeX/pull/1',
  }, {
    body: 'Second',
    mergeCommit: { oid: 'second' },
    mergedAt: '2026-02-01T00:00:00Z',
    number: 2,
    title: 'Second PR',
    url: 'https://github.com/OpenTubeX/OpenTubeX/pull/2',
  }])
})

test('a release note and optional Markdown images are parsed', () => {
  const result = parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
![Compact player](https://github.com/user-attachments/assets/example)
![Queue and player](https://github.com/user-attachments/assets/second)
<!-- release-note-image:end -->
`)

  assert.deepEqual(result, {
    images: [{
      alt: 'Compact player',
      url: 'https://github.com/user-attachments/assets/example',
    }, {
      alt: 'Queue and player',
      url: 'https://github.com/user-attachments/assets/second',
    }],
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

  assert.deepEqual(result.images, [{
    alt: 'A & B',
    url: 'https://github.com/user-attachments/assets/example?name=a&amp;b',
  }])
})

test('HTML image parsing ignores data attributes', () => {
  const result = parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
<img data-src="https://github.com/user-attachments/assets/wrong" src="https://github.com/user-attachments/assets/right" data-alt="Wrong" alt="Right">
<!-- release-note-image:end -->
`)

  assert.deepEqual(result.images, [{
    alt: 'Right',
    url: 'https://github.com/user-attachments/assets/right',
  }])
})

test('initial image URLs must use HTTPS and a GitHub host', () => {
  const releaseNoteWithImage = (url) => `
${NOTE_MARKERS}
<!-- release-note-image:start -->
<img src="${url}" alt="Screenshot">
<!-- release-note-image:end -->
`

  assert.throws(
    () => parseReleaseNote(releaseNoteWithImage('http://github.com/user-attachments/assets/example')),
    /must be hosted by GitHub/,
  )
  assert.throws(
    () => parseReleaseNote(releaseNoteWithImage('https://example.com/image.png')),
    /must be hosted by GitHub/,
  )
})

test('malformed image entries are rejected after valid images', () => {
  for (const malformedImage of ['![Broken image](', '<img src="https://github.com/user-attachments/assets/broken"']) {
    assert.throws(() => parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
![Screenshot](https://github.com/user-attachments/assets/example)
${malformedImage}
<!-- release-note-image:end -->
`), /must be Markdown images or <img> tags/)
  }
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

test('image dimensions are read from JPEG data after metadata', () => {
  assert.deepEqual(probeImageSize(jpeg(1024, 768)), {
    height: 768,
    width: 1024,
  })
})

test('image dimensions are read from WebP variants', () => {
  for (const type of ['VP8X', 'VP8 ', 'VP8L']) {
    assert.deepEqual(probeImageSize(webp(type, 640, 480)), {
      height: 480,
      width: 640,
    })
  }
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

test('release notes render under their selected categories', async () => {
  const result = await renderReleaseNotes([
    {
      body: `
${categoryMarkers('Highlights')}
${NOTE_MARKERS}
<!-- release-note-image:start -->
<img src="https://github.com/user-attachments/assets/example" alt="Screenshot" width="800" height="600">
![Settings](https://github.com/user-attachments/assets/second)
<!-- release-note-image:end -->
`,
      closingIssuesReferences: {
        nodes: [{ number: 40 }, { number: 41 }],
      },
      number: 42,
      title: 'Compact player',
    },
    {
      body: `
${categoryMarkers('More improvements')}
<!-- release-note:start -->
Adds keyboard shortcuts.
<!-- release-note:end -->
`,
      number: 43,
      title: 'Keyboard shortcuts',
    },
    {
      body: `
${categoryMarkers('Fixed bugs')}
<!-- release-note:start -->
Fixed videos failing to load.
<!-- release-note:end -->
`,
      number: 44,
      title: 'Fix video loading',
    },
    {
      body: categoryMarkers('Not noteworthy'),
      number: 45,
      title: 'Refactor tests',
    },
    {
      body: 'Legacy pull request body',
      number: 46,
      title: 'Legacy change',
    },
  ], async () => png(800, 600))

  assert.equal(result, `# Highlights

- Adds a compact player. (#40, #41, #42)
  <img src="https://github.com/user-attachments/assets/example" alt="Screenshot" height="300">
  <img src="https://github.com/user-attachments/assets/second" alt="Settings" height="300">

## More improvements

- Adds keyboard shortcuts. (#43)

## Fixed bugs

- Fixed videos failing to load. (#44)
`)
})

test('empty release note categories are omitted', async () => {
  const result = await renderReleaseNotes([
    {
      body: `
${categoryMarkers('Fixed bugs')}
${NOTE_MARKERS}
`,
      number: 42,
      title: 'Compact player',
    },
  ])

  assert.equal(result, `## Fixed bugs

- Adds a compact player. (#42)
`)
})

test('a release with only non-noteworthy pull requests is rejected', async () => {
  await assert.rejects(
    renderReleaseNotes([{
      body: categoryMarkers('Not noteworthy'),
      number: 42,
      title: 'Refactor tests',
    }]),
    /No noteworthy pull requests/,
  )
})

test('nightly releases can render a fallback when there are no noteworthy changes', async () => {
  const result = await renderReleaseNotes([{
    body: categoryMarkers('Not noteworthy'),
    number: 42,
    title: 'Refactor tests',
  }], undefined, 'No noteworthy changes since the latest stable release.')

  assert.equal(result, 'No noteworthy changes since the latest stable release.\n')
})
