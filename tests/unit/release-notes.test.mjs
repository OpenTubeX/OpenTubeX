import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseReleaseNoteFile,
  renderReleaseNotes,
  validateDownloadedImageUrl,
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

test('initial image URLs must use HTTPS and a GitHub host', () => {
  for (const url of ['http://github.com/user-attachments/assets/example', 'https://example.com/image.png']) {
    assert.throws(
      () => parseReleaseNoteFile(noteFile({ images: `<img src="${url}" alt="Screenshot">` })),
      /must be hosted by GitHub/,
    )
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
    note({ category: 'feature', createdAt: 6, note: 'Adds a sleep timer.', references: [45] }),
  ], {
    loadImage: async () => png(800, 600),
  })

  assert.equal(result, `## Highlights

- Adds a compact player. (#40, #41, #42)
  <img src="https://github.com/user-attachments/assets/example" alt="Screenshot" width="400">
  <img src="https://github.com/user-attachments/assets/second" alt="Adds a compact player." width="400">

## New features

- Adds a sleep timer. (#45)

## Improvements

- **Android, iOS:** Shared links open in the app.
- **Desktop:** Adds keyboard shortcuts. (#43)

## Fixed bugs

- Fixed videos failing to load. (#44)
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
