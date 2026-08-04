import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadLegacyChannelThumbnailCache,
  loadLegacyVideoAvatarCache,
  removeLegacyTabAvatar
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

test('removes only the migrated channel avatar', () => {
  const values = useLocalStorage({
    channelThumbnailCache: JSON.stringify({
      UC123: 'https://example.com/first.jpg',
      UC456: 'https://example.com/second.jpg'
    })
  })

  removeLegacyTabAvatar({ path: '/channel/UC123' })

  assert.deepEqual(JSON.parse(values.get('channelThumbnailCache')), {
    UC456: 'https://example.com/second.jpg'
  })
})

test('removes the legacy storage key after its last video avatar migrates', () => {
  const values = useLocalStorage({
    videoAvatarCache: JSON.stringify({ abc123: 'https://example.com/video.jpg' })
  })

  removeLegacyTabAvatar({ path: '/watch/abc123' })

  assert.equal(values.has('videoAvatarCache'), false)
})
