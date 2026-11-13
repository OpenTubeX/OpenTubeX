import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decrementPlaylistVideoCounts,
  incrementPlaylistVideoCounts,
  resetPlaylistVideoCounts,
} from '../../src/renderer/helpers/playlist-video-counts.js'

function video (videoId, playlistItemId = `${videoId}-item`) {
  return { videoId, playlistItemId, title: `Video ${videoId}` }
}

test('a video stays known while another playlist still holds it', () => {
  const counts = new Map()

  incrementPlaylistVideoCounts(counts, [video('a'), video('b')])
  incrementPlaylistVideoCounts(counts, [video('a')])

  decrementPlaylistVideoCounts(counts, [video('a')])
  assert.ok(counts.has('a'), 'still in the second playlist')

  decrementPlaylistVideoCounts(counts, [video('a')])
  assert.ok(!counts.has('a'))
  assert.ok(counts.has('b'))
})

test('resetting rebuilds from the given playlists without replacing the map', () => {
  const counts = new Map()
  const original = counts

  resetPlaylistVideoCounts(counts, [
    { videos: [video('a'), video('b')] },
    { videos: [video('b')] },
    { },
  ])

  assert.equal(counts, original, 'consumers keep tracking the same map')
  assert.deepEqual([...counts].sort(), [['a', 1], ['b', 2]])

  resetPlaylistVideoCounts(counts, [])
  assert.equal(counts.size, 0)
})

test('duplicate entries of one video in a single playlist are counted separately', () => {
  const counts = new Map()

  // Bulk adds intentionally allow duplicates, so one removal must not make the
  // video look unsaved while a second copy is still there.
  incrementPlaylistVideoCounts(counts, [video('a', 'first'), video('a', 'second')])

  decrementPlaylistVideoCounts(counts, [video('a', 'first')])
  assert.ok(counts.has('a'))

  decrementPlaylistVideoCounts(counts, [video('a', 'second')])
  assert.ok(!counts.has('a'))
})
