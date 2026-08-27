import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMediaMarkup, selectReleaseTag } from '../../_scripts/releaseNoteMedia.mjs'

test('a single release note asset renders as an image', () => {
  assert.equal(renderMediaMarkup([{
    theme: null,
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/settings.webp',
  }], 'Settings & playback'), '<img src="https://github.com/OpenTubeX/media/releases/download/attachments/settings.webp" alt="Settings &amp; playback">')
})

test('themed release note assets use the dark image as the fallback', () => {
  assert.equal(renderMediaMarkup([{
    theme: 'dark',
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp',
  }, {
    theme: 'light',
    url: 'https://github.com/OpenTubeX/media/releases/download/attachments/light.webp',
  }], 'Settings'), `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/OpenTubeX/media/releases/download/attachments/light.webp">
  <img alt="Settings" src="https://github.com/OpenTubeX/media/releases/download/attachments/dark.webp">
</picture>`)
})

test('release note uploads use the first release with enough asset slots', () => {
  const counts = new Map([
    ['attachments', 1000],
    ['attachments-2', 998],
  ])

  assert.equal(selectReleaseTag(2, {
    countAssets: (releaseTag) => counts.has(releaseTag) ? counts.get(releaseTag) : null,
    createRelease: () => assert.fail('should not create a release'),
  }), 'attachments-2')
})

test('release note uploads reserve every slot needed by themed media', () => {
  const counts = new Map([
    ['attachments', 999],
    ['attachments-2', 4],
  ])

  assert.equal(selectReleaseTag(2, {
    countAssets: (releaseTag) => counts.has(releaseTag) ? counts.get(releaseTag) : null,
    createRelease: () => assert.fail('should not create a release'),
  }), 'attachments-2')
})

test('release note uploads create the next rollover release', () => {
  const counts = new Map([['attachments', 1000]])
  const created = []

  assert.equal(selectReleaseTag(1, {
    countAssets: (releaseTag) => counts.has(releaseTag) ? counts.get(releaseTag) : null,
    createRelease: (releaseTag) => {
      created.push(releaseTag)
      counts.set(releaseTag, 0)
    },
  }), 'attachments-2')
  assert.deepEqual(created, ['attachments-2'])
})

test('release note uploads require the base release', () => {
  assert.throws(() => selectReleaseTag(1, {
    countAssets: () => null,
    createRelease: () => assert.fail('should not create a release'),
  }), /Release not found: attachments/)
})
