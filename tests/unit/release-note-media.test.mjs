import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMediaMarkup } from '../../_scripts/releaseNoteMedia.mjs'

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
