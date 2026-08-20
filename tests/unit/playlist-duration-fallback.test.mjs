import assert from 'node:assert/strict'
import test from 'node:test'

import { fillMissingPlaylistVideoDurations } from '../../src/renderer/helpers/playlists.js'

test('fills a missing playlist duration from the matching history entry', () => {
  const playlistItems = [
    { videoId: 'missing-duration', title: 'Missing duration' },
    { videoId: 'known-duration', title: 'Known duration', lengthSeconds: 90 },
  ]
  const historyCacheById = {
    'missing-duration': { videoId: 'missing-duration', lengthSeconds: 125 },
    'known-duration': { videoId: 'known-duration', lengthSeconds: 200 },
  }

  const anyVideoMissingDuration = fillMissingPlaylistVideoDurations(
    playlistItems,
    historyCacheById
  )

  assert.equal(anyVideoMissingDuration, false)
  assert.equal(playlistItems[0].lengthSeconds, 125)
  assert.equal(playlistItems[1].lengthSeconds, 90)
})

test('uses zero and reports a missing duration when history has no fallback', () => {
  const playlistItems = [{ videoId: 'unknown', title: 'Unknown duration' }]

  const anyVideoMissingDuration = fillMissingPlaylistVideoDurations(playlistItems, {})

  assert.equal(anyVideoMissingDuration, true)
  assert.equal(playlistItems[0].lengthSeconds, 0)
})
