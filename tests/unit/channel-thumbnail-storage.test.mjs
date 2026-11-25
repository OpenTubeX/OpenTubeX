import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadLegacyChannelThumbnailCache,
  loadLegacyVideoAvatarCache
} from '../../src/renderer/helpers/channelThumbnailStorage.js'

function useLocalStorage(entries = {}) {
  const values = new Map(Object.entries(entries))
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  }
  return values
}

test('loads valid legacy avatar caches and ignores malformed data', () => {
  useLocalStorage({
    channelThumbnailCache: JSON.stringify({ UC123: 'https://example.com/channel.jpg' }),
    videoAvatarCache: '{broken'
  })

  assert.deepEqual(loadLegacyChannelThumbnailCache(), {
    UC123: 'https://example.com/channel.jpg'
  })
  assert.deepEqual(loadLegacyVideoAvatarCache(), {})
})
