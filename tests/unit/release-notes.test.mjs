import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeReleaseImage,
  parseReleaseNote,
  parseReleaseNoteCategory,
  probeImageSize,
  renderReleaseNotes,
  selectPullRequests,
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

// Pull request bodies have to keep every marker pair of the template, so the
// fixtures compose them the same way the template does.
function pullRequestBody(category, { note = '', images = '' } = {}) {
  return `${categoryMarkers(category)}
<!-- release-note:start -->
${note}
<!-- release-note:end -->
<!-- release-note-image:start -->
${images}
<!-- release-note-image:end -->
`
}

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
      body: pullRequestBody('Not noteworthy'),
    },
  }), {
    category: 'Not noteworthy',
  })

  assert.throws(() => validatePullRequestEvent({
    pull_request: {
      body: pullRequestBody('None of them'),
    },
  }), /Select exactly one release note category/)

  assert.throws(() => parseReleaseNoteCategory(''), /Select one release note category/)

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
      body: pullRequestBody('Highlights'),
    },
  }), /Fill in the release note section/)
})

test('pull request bodies have to keep every release note marker', () => {
  const body = pullRequestBody('Not noteworthy')
  const markers = ['release-note-category', 'release-note', 'release-note-image']

  for (const marker of markers) {
    for (const side of ['start', 'end']) {
      const withoutMarker = body.replace(`<!-- ${marker}:${side} -->`, '')

      assert.throws(
        () => validatePullRequestEvent({ pull_request: { body: withoutMarker } }),
        new RegExp(`Keep the ${marker} markers`),
        `removing the ${marker}:${side} marker has to be rejected`,
      )
    }
  }

  assert.throws(
    () => validatePullRequestEvent({ pull_request: { body: '' } }),
    /Keep the release-note-category markers/,
  )
})

test('only pull requests that merged a release commit into the target are selected', () => {
  const pullRequest = (number, mergeCommit, mergedAt, {
    baseRefName = 'development',
    nameWithOwner = 'OpenTubeX/OpenTubeX',
  } = {}) => ({
    baseRefName,
    baseRepository: { nameWithOwner },
    body: `PR ${number}`,
    mergeCommit: mergeCommit && { oid: mergeCommit },
    mergedAt,
    number,
  })
  const second = pullRequest(2, 'second', '2026-02-01T00:00:00Z')
  const first = pullRequest(1, 'first', '2026-01-01T00:00:00Z')

  assert.deepEqual(selectPullRequests([
    {
      data: {
        repository: {
          commit0: { associatedPullRequests: { nodes: [second, pullRequest(3, null, null)] } },
          commit1: { associatedPullRequests: { nodes: [] } },
          commit2: null,
        },
      },
    },
    {
      data: {
        repository: {
          commit0: { associatedPullRequests: { nodes: [first, second] } },
          commit1: {
            associatedPullRequests: {
              nodes: [
                pullRequest(4, 'other-branch', '2026-01-02T00:00:00Z', { baseRefName: 'deps-batch' }),
                pullRequest(5, 'upstream', '2026-01-03T00:00:00Z', { nameWithOwner: 'FreeTubeApp/FreeTube' }),
                pullRequest(6, 'outside-range', '2026-01-04T00:00:00Z'),
              ],
            },
          },
        },
      },
    },
  ], {
    commits: ['first', 'second', 'other-branch', 'upstream'],
    repository: 'opentubex/opentubex',
    target: 'development',
  }), [first, second])
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

test('dark and light release note images are parsed from a picture element', () => {
  const result = parseReleaseNote(`
${NOTE_MARKERS}
<!-- release-note-image:start -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img alt="The settings panel" src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
</picture>
<!-- release-note-image:end -->
`)

  assert.deepEqual(result.images, [{
    alt: 'The settings panel',
    darkUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
    lightUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/light.webp',
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
  }])
})

test('themed release note images require a dark fallback and both theme sources', () => {
  const releaseNoteWithPicture = (sources, fallback = 'dark.webp') => `
${NOTE_MARKERS}
<!-- release-note-image:start -->
<picture>
  ${sources}
  <img alt="Settings" src="https://github.com/OpenTubeX/media/releases/download/attachments/${fallback}">
</picture>
<!-- release-note-image:end -->
`

  assert.throws(() => parseReleaseNote(releaseNoteWithPicture(`
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  `)), /one dark source, one light source/)

  assert.throws(() => parseReleaseNote(releaseNoteWithPicture(`
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  `, 'light.webp')), /dark source as its fallback/)
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
`), /must be Markdown images/)
  }
})

test('GitHub image storage redirects are accepted narrowly', () => {
  for (const hostname of [
    'github-production-user-asset-6210df.s3.amazonaws.com',
    'release-assets.githubusercontent.com',
  ]) {
    assert.equal(
      validateDownloadedImageUrl(`https://${hostname}/image.png`).hostname,
      hostname,
    )
  }

  assert.throws(
    () => validateDownloadedImageUrl('https://untrusted-bucket.s3.amazonaws.com/image.png'),
    /must be hosted by GitHub/,
  )
  assert.throws(
    () => validateDownloadedImageUrl('https://release-assets.githubusercontent.com.example.com/image.png'),
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

test('images taller than 300 pixels receive only a width that keeps their aspect ratio', async () => {
  const result = await normalizeReleaseImage({
    alt: 'Subscription groups',
    url: 'https://github.com/user-attachments/assets/example',
  }, 'Fallback', async () => png(1376, 402))

  assert.equal(
    result,
    '<img src="https://github.com/user-attachments/assets/example" alt="Subscription groups" width="1026">',
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

test('themed images keep the dark fallback and limit either tall variant', async () => {
  const result = await normalizeReleaseImage({
    alt: 'Settings',
    darkUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
    lightUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/light.webp',
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
  }, 'Fallback', async (url) => png(800, url.href.endsWith('light.webp') ? 400 : 300))

  assert.equal(result, `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp" alt="Settings" width="600">
</picture>`)
})

test('themed images stay inside their release note list item', async () => {
  const result = await renderReleaseNotes([{
    body: pullRequestBody('Highlights', {
      images: `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img alt="Settings" src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
</picture>`,
      note: 'Adds theme-aware settings.',
    }),
    number: 42,
    title: 'Theme-aware settings',
  }], {
    loadImage: async () => png(800, 300),
  })

  assert.equal(result, `## Highlights

- Adds theme-aware settings. (#42)
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
    <img src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp" alt="Settings">
  </picture>
`)
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
      body: pullRequestBody('More improvements', { note: 'Adds keyboard shortcuts.' }),
      number: 43,
      title: 'Keyboard shortcuts',
    },
    {
      body: pullRequestBody('Fixed bugs', { note: 'Fixed videos failing to load.' }),
      number: 44,
      title: 'Fix video loading',
    },
    {
      body: pullRequestBody('Not noteworthy'),
      number: 45,
      title: 'Refactor tests',
    },
    {
      body: 'Legacy pull request body',
      number: 46,
      title: 'Legacy change',
    },
  ], {
    loadImage: async () => png(800, 600),
  })

  assert.equal(result, `## Highlights

- Adds a compact player. (#40, #41, #42)
  <img src="https://github.com/user-attachments/assets/example" alt="Screenshot" width="400">
  <img src="https://github.com/user-attachments/assets/second" alt="Settings" width="400">

## More improvements

- Adds keyboard shortcuts. (#43)

## Fixed bugs

- Fixed videos failing to load. (#44)
`)
})

test('empty release note categories are omitted', async () => {
  const result = await renderReleaseNotes([
    {
      body: pullRequestBody('Fixed bugs', { note: 'Adds a compact player.' }),
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
      body: pullRequestBody('Not noteworthy'),
      number: 42,
      title: 'Refactor tests',
    }]),
    /No noteworthy pull requests/,
  )
})

test('nightly releases can render a fallback when there are no noteworthy changes', async () => {
  const result = await renderReleaseNotes([{
    body: pullRequestBody('Not noteworthy'),
    number: 42,
    title: 'Refactor tests',
  }], {
    emptyMessage: 'No noteworthy changes since the latest stable release.',
  })

  assert.equal(result, 'No noteworthy changes since the latest stable release.\n')
})

test('nightly releases omit images that cannot be processed', async () => {
  const imageErrors = []
  const result = await renderReleaseNotes([{
    body: `
${categoryMarkers('More improvements')}
${NOTE_MARKERS}
<!-- release-note-image:start -->
![Screenshot](https://github.com/user-attachments/assets/example)
<!-- release-note-image:end -->
`,
    number: 42,
    title: 'Compact player',
  }], {
    loadImage: async () => { throw new Error('Image unavailable.') },
    onImageError: (error) => imageErrors.push(error),
  })

  assert.equal(result, `## More improvements

- Adds a compact player. (#42)
`)
  assert.equal(imageErrors.length, 1)
  assert.match(imageErrors[0].message, /PR #42: Image unavailable/)
})
