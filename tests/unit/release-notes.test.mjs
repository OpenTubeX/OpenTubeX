import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  formatReferences,
  isReleaseNoteFile,
  normalizeReleaseImage,
  parseReleaseNoteFile,
  probeImageSize,
  readReleaseNotes,
  renderReleaseNotes,
  selectPullRequests,
  validateDownloadedImageUrl,
  validatePullRequest,
} from '../../_scripts/releaseNotes.mjs'

function noteFile({ frontMatter = 'category: improvement', note = 'Adds a compact player.', images = '' } = {}) {
  return `---\n${frontMatter}\n---\n\n${note}\n${images ? `\n${images}\n` : ''}`
}

function note(overrides = {}) {
  return {
    category: 'improvement',
    file: 'release-notes/compact-player.md',
    images: [],
    note: 'Adds a compact player.',
    platforms: [],
    references: [],
    ...overrides,
  }
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


test('a release note file is parsed with its category, platforms, and images', () => {
  assert.deepEqual(parseReleaseNoteFile(noteFile({
    frontMatter: 'category: highlight\nplatforms: [android, desktop]',
    images: '![Compact player](https://github.com/user-attachments/assets/example)\n![Queue and player](https://github.com/user-attachments/assets/second)',
  })), {
    category: 'highlight',
    images: [{
      alt: 'Compact player',
      url: 'https://github.com/user-attachments/assets/example',
    }, {
      alt: 'Queue and player',
      url: 'https://github.com/user-attachments/assets/second',
    }],
    note: 'Adds a compact player.',
    platforms: ['android', 'linux', 'macos', 'windows'],
  })
})

test('release notes can list their own references', () => {
  assert.deepEqual(parseReleaseNoteFile(noteFile({ frontMatter: 'category: fix\nreferences: [2509, 41]' })).references, [2509, 41])

  for (const references of ['[]', '2509', '[#2509]', '[0]', '[25a]']) {
    assert.throws(
      () => parseReleaseNoteFile(noteFile({ frontMatter: `category: fix\nreferences: ${references}` })),
      /Write references as a list of issue and pull request numbers/,
      references,
    )
  }
})

test('wrapped release note lines are joined', () => {
  assert.equal(parseReleaseNoteFile(noteFile({ note: 'Adds a compact\n  player.' })).note, 'Adds a compact player.')
})

test('release note front matter accepts only known keys and values', () => {
  const invalid = [
    ['category: feature', /Set category to highlight, improvement, fix/],
    ['platforms: [android]', /Set category/],
    ['category: fix\ntitle: Something', /Unknown front matter key: title/],
    ['category: fix\ncategory: fix', /Duplicate front matter key: category/],
    ['category: fix\nplatforms: android', /Write platforms as a list/],
    ['category: fix\nplatforms: [android, tv]', /Unknown platform: tv/],
    ['category: fix\nplatforms: [android, ios, desktop]', /Leave out platforms/],
    ['- category: fix', /Invalid front matter line/],
  ]

  for (const [frontMatter, error] of invalid) {
    assert.throws(() => parseReleaseNoteFile(noteFile({ frontMatter })), error, frontMatter)
  }

  assert.throws(() => parseReleaseNoteFile('Adds a compact player.\n'), /Start the file with front matter/)
})

test('release note text follows the style rules', () => {
  const invalid = [
    ['', /Write the release note below the front matter/],
    ['- Adds a compact player.', /without a leading bullet/],
    ['## Compact player.', /without a leading bullet or heading/],
    ['Adds a compact player. (#42)', /Leave out pull request and issue references/],
    ['Fixes #42.', /Leave out pull request and issue references/],
    ['On Android, shared links open in the app.', /Set platforms in the front matter/],
    ['Android: shared links open in the app.', /Set platforms in the front matter/],
    ['Adds a compact player', /End the release note with a period/],
    [`${'Very '.repeat(60)}long.`, /Shorten the release note to 300 characters/],
    ['Adds a compact player.\n![Screenshot](https://github.com/user-attachments/assets/example)', /Separate images from the release note text/],
  ]

  for (const [text, error] of invalid) {
    assert.throws(() => parseReleaseNoteFile(noteFile({ note: text })), error, text)
  }

  for (const text of ['Adds `Ctrl+K`.', 'Adds the compact player (beta).', 'Android TV remotes can now seek.']) {
    assert.equal(parseReleaseNoteFile(noteFile({ note: text })).note, text)
  }
})

test('dark and light release note images are parsed from a picture element', () => {
  const result = parseReleaseNoteFile(noteFile({
    images: `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img alt="The settings panel" src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
</picture>`,
  }))

  assert.deepEqual(result.images, [{
    alt: 'The settings panel',
    darkUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
    lightUrl: 'https://github.com/OpenTubeX/media/releases/download/attachments/light.webp',
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
  }])
})

test('themed release note images require a dark fallback and both theme sources', () => {
  const withPicture = (sources, fallback = 'dark.webp') => noteFile({
    images: `<picture>
  ${sources}
  <img alt="Settings" src="https://github.com/OpenTubeX/media/releases/download/attachments/${fallback}">
</picture>`,
  })

  assert.throws(() => parseReleaseNoteFile(withPicture(`
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  `)), /one dark source, one light source/)

  assert.throws(() => parseReleaseNoteFile(withPicture(`
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  `, 'light.webp')), /dark source as its fallback/)
})

test('HTML entities in image attributes are decoded only once', () => {
  const result = parseReleaseNoteFile(noteFile({
    images: '<img src="https://github.com/user-attachments/assets/example?name=a&amp;amp;b" alt="A &amp; B">',
  }))

  assert.deepEqual(result.images, [{
    alt: 'A & B',
    url: 'https://github.com/user-attachments/assets/example?name=a&amp;b',
  }])
})

test('HTML image parsing ignores data attributes', () => {
  const result = parseReleaseNoteFile(noteFile({
    images: '<img data-src="https://github.com/user-attachments/assets/wrong" src="https://github.com/user-attachments/assets/right" data-alt="Wrong" alt="Right">',
  }))

  assert.deepEqual(result.images, [{
    alt: 'Right',
    url: 'https://github.com/user-attachments/assets/right',
  }])
})

test('initial image URLs must use HTTPS and a GitHub host', () => {
  for (const url of ['http://github.com/user-attachments/assets/example', 'https://example.com/image.png']) {
    assert.throws(
      () => parseReleaseNoteFile(noteFile({ images: `<img src="${url}" alt="Screenshot">` })),
      /must be hosted by GitHub/,
    )
  }
})

test('malformed image entries are rejected after valid images', () => {
  for (const malformedImage of ['![Broken image](', '<img src="https://github.com/user-attachments/assets/broken"', 'More text.']) {
    assert.throws(() => parseReleaseNoteFile(noteFile({
      images: `![Screenshot](https://github.com/user-attachments/assets/example)\n${malformedImage}`,
    })), /must be Markdown images/)
  }
})

test('the release note directory is read in name order and reports every invalid file', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-notes-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  writeFileSync(path.join(directory, 'README.md'), '# Release notes\n')
  writeFileSync(path.join(directory, 'b-player.md'), noteFile({ frontMatter: 'category: fix' }))
  writeFileSync(path.join(directory, 'a-queue.md'), noteFile())

  assert.deepEqual(readReleaseNotes(directory).map(({ category, file }) => [category, path.basename(file)]), [
    ['improvement', 'a-queue.md'],
    ['fix', 'b-player.md'],
  ])

  writeFileSync(path.join(directory, 'Bad_Name.md'), noteFile())
  writeFileSync(path.join(directory, 'missing-period.md'), noteFile({ note: 'Adds a queue' }))

  assert.throws(() => readReleaseNotes(directory), (error) => {
    assert.match(error.message, /Bad_Name\.md: Name release note files in kebab-case/)
    assert.match(error.message, /missing-period\.md: End the release note with a period/)
    return true
  })
})

test('pull requests need a release note change or the opt-out checkbox', () => {
  assert.equal(isReleaseNoteFile('release-notes/compact-player.md'), true)
  assert.equal(isReleaseNoteFile('release-notes/README.md'), false)
  assert.equal(isReleaseNoteFile('release-notes/nested/note.md'), false)
  assert.equal(isReleaseNoteFile('docs/release-notes/note.md'), false)

  assert.doesNotThrow(() => validatePullRequest('', ['src/a.js', 'release-notes/compact-player.md']))
  assert.doesNotThrow(() => validatePullRequest('- [x] No release note needed', ['src/a.js']))
  assert.doesNotThrow(() => validatePullRequest('- [X] No release note needed\r\n', []))
  assert.throws(() => validatePullRequest('- [ ] No release note needed', ['src/a.js', 'release-notes/README.md']), /Add or update a release note/)
})

test('only pull requests merged into the target branch are selected per commit', () => {
  const pullRequest = (number, mergedAt, {
    baseRefName = 'development',
    nameWithOwner = 'OpenTubeX/OpenTubeX',
  } = {}) => ({
    baseRefName,
    baseRepository: { nameWithOwner },
    mergedAt,
    number,
  })
  const first = pullRequest(1, '2026-01-01T00:00:00Z')
  const second = pullRequest(2, '2026-02-01T00:00:00Z')

  const selected = selectPullRequests([{
    data: {
      repository: {
        commit0: { associatedPullRequests: { nodes: [first, second, pullRequest(3, null)] } },
        commit1: {
          associatedPullRequests: {
            nodes: [
              pullRequest(4, '2026-01-02T00:00:00Z', { baseRefName: 'deps-batch' }),
              pullRequest(5, '2026-01-03T00:00:00Z', { nameWithOwner: 'FreeTubeApp/FreeTube' }),
            ],
          },
        },
        commit2: null,
      },
    },
  }], { repository: 'opentubex/opentubex', target: 'development' })

  assert.deepEqual([...selected.keys()], ['commit0'])
  assert.deepEqual([...selected.get('commit0').values()], [first, second])
})

test('references list closed issues before pull requests in merge order without duplicates', () => {
  const later = { closingIssuesReferences: { nodes: [{ number: 41 }] }, mergedAt: '2026-02-01T00:00:00Z', number: 43 }
  const earlier = { closingIssuesReferences: { nodes: [{ number: 40 }, { number: 41 }] }, mergedAt: '2026-01-01T00:00:00Z', number: 42 }

  assert.deepEqual(formatReferences([later, earlier, later]), [40, 41, 42, 43])
  assert.deepEqual(formatReferences([]), [])
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
  const result = await renderReleaseNotes([note({
    category: 'highlight',
    images: parseReleaseNoteFile(noteFile({
      images: `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img alt="Settings" src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
</picture>`,
    })).images,
    note: 'Adds theme-aware settings.',
    references: [42],
  })], {
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

test('release notes render under their categories in creation order with platform labels', async () => {
  const result = await renderReleaseNotes([
    note({ category: 'fix', createdAt: 3, note: 'Fixed videos failing to load.', references: [44] }),
    note({
      category: 'highlight',
      createdAt: 2,
      images: [
        { alt: 'Screenshot', url: 'https://github.com/user-attachments/assets/example' },
        { alt: '', url: 'https://github.com/user-attachments/assets/second' },
      ],
      references: [40, 41, 42],
    }),
    note({ createdAt: 5, note: 'Adds keyboard shortcuts.', platforms: ['linux', 'macos', 'windows'], references: [43] }),
    note({ createdAt: 4, note: 'Shared links open in the app.', platforms: ['android', 'ios'] }),
  ], {
    loadImage: async () => png(800, 600),
  })

  assert.equal(result, `## Highlights

- Adds a compact player. (#40, #41, #42)
  <img src="https://github.com/user-attachments/assets/example" alt="Screenshot" width="400">
  <img src="https://github.com/user-attachments/assets/second" alt="Adds a compact player." width="400">

## More improvements

- **Android, iOS:** Shared links open in the app.
- **Desktop:** Adds keyboard shortcuts. (#43)

## Fixed bugs

- Fixed videos failing to load. (#44)
`)
})

test('improvements are only called more improvements below highlights', async () => {
  assert.equal(await renderReleaseNotes([note(), note({ category: 'fix', note: 'Fixed a crash.' })]), `## Improvements

- Adds a compact player.

## Fixed bugs

- Fixed a crash.
`)
})

test('a release without release notes is rejected', async () => {
  await assert.rejects(renderReleaseNotes([]), /No release notes were found in release-notes/)
})

test('nightly releases can render a fallback when there are no release notes', async () => {
  const result = await renderReleaseNotes([], {
    emptyMessage: 'No noteworthy changes since the latest release.',
  })

  assert.equal(result, 'No noteworthy changes since the latest release.\n')
})

test('nightly releases omit images that cannot be processed', async () => {
  const imageErrors = []
  const result = await renderReleaseNotes([note({
    images: [{ alt: 'Screenshot', url: 'https://github.com/user-attachments/assets/example' }],
    references: [42],
  })], {
    loadImage: async () => { throw new Error('Image unavailable.') },
    onImageError: (error) => imageErrors.push(error),
  })

  assert.equal(result, `## Improvements

- Adds a compact player. (#42)
`)
  assert.equal(imageErrors.length, 1)
  assert.match(imageErrors[0].message, /compact-player\.md: Image unavailable/)
})
