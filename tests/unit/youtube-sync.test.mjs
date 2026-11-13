import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completeYouTubePlaylistVideos,
  diffYouTubeSubscriptions,
  mergeYouTubePlaylistDescription,
  mergeYouTubePlaylistVideos,
  planYouTubePlaylistMoves,
  resolveYouTubeSetVideoIds
} from '../../src/renderer/helpers/youtube-sync-merge.js'

const channel = id => ({ id, name: `Channel ${id}`, thumbnail: null })
const remoteVideo = (videoId, setVideoId) => ({
  videoId,
  setVideoId,
  title: `Video ${videoId}`,
  author: 'Example Channel',
  authorId: 'UCcccccccccccccccccccccc',
  lengthSeconds: 60,
  published: null,
  viewCount: null
})
const savedVideo = (videoId, setVideoId, playlistItemId = `item-${videoId}`) => ({
  type: 'video',
  videoId,
  title: `Video ${videoId}`,
  playlistItemId,
  timeAdded: 1000,
  youTubeSetVideoId: setVideoId
})

test('subscription sync applies only the changes made on YouTube since the last sync', () => {
  // The first sync adds what is missing and removes nothing.
  assert.deepEqual(
    diffYouTubeSubscriptions(null, [channel('A'), channel('B')], new Set(['B', 'local'])),
    { added: [channel('A')], removedIds: [], nextIds: ['A', 'B'] }
  )

  // Later, channels new on YouTube are added, and channels gone from YouTube
  // are removed. A channel unsubscribed from here (C) stays unsubscribed, and
  // one subscribed to only here (local) stays.
  assert.deepEqual(
    diffYouTubeSubscriptions(['A', 'B', 'C'], [channel('A'), channel('C'), channel('D')], new Set(['A', 'B', 'local'])),
    { added: [channel('D')], removedIds: ['B'], nextIds: ['A', 'C', 'D'] }
  )

  // An empty list removes nothing, as a misread page would otherwise empty
  // every profile, and the next sync still finds what changed since the last
  // list it could read.
  const misread = diffYouTubeSubscriptions(['A', 'B'], [], new Set(['A', 'B']))
  assert.deepEqual(misread, { added: [], removedIds: [], nextIds: ['A', 'B'] })
  assert.deepEqual(
    diffYouTubeSubscriptions(misread.nextIds, [channel('A')], new Set(['A', 'B'])),
    { added: [], removedIds: ['B'], nextIds: ['A'] }
  )
})

test('playlist sync keeps saved entries and confirms the ones added here', () => {
  const saved = [
    savedVideo('kept', 'SET1'),
    savedVideo('addedHere', null),
    savedVideo('removedOnYouTube', 'SET2')
  ]
  let nextId = 0
  const merged = mergeYouTubePlaylistVideos(saved, [
    remoteVideo('new', 'SET4'),
    remoteVideo('addedHere', 'SET3'),
    remoteVideo('kept', 'SET1')
  ], { now: 5000, newestFirst: true, createId: () => `new-${nextId++}` })

  assert.deepEqual(merged.map(video => [video.videoId, video.playlistItemId, video.youTubeSetVideoId, video.timeAdded]), [
    ['new', 'new-0', 'SET4', 5000],
    ['addedHere', 'item-addedHere', 'SET3', 1000],
    ['kept', 'item-kept', 'SET1', 1000]
  ])
})

test('playlist sync takes descriptions changed on YouTube and keeps the ones changed here', () => {
  // Read for the first time
  assert.equal(mergeYouTubePlaylistDescription('', undefined, 'From YouTube', false), 'From YouTube')
  // Changed on YouTube since the last sync
  assert.equal(mergeYouTubePlaylistDescription('Old', 'Old', 'New on YouTube', false), 'New on YouTube')
  // Changed here and not yet on YouTube
  assert.equal(mergeYouTubePlaylistDescription('Edited here', 'Old', 'Old', false), 'Edited here')
  // A page that does not show the description changes nothing.
  assert.equal(mergeYouTubePlaylistDescription('Edited here', 'Old', null, true), 'Edited here')
  // YouTube refused the edit made here.
  assert.equal(mergeYouTubePlaylistDescription('Edited here', 'Old', 'Old', true), 'Old')
})

test('a playlist read stops early only where the saved entries continue unchanged', () => {
  const saved = [savedVideo('a', 'SET1'), savedVideo('b', 'SET2'), savedVideo('c', 'SET3')]
  // A like added to the start of Liked videos
  const read = [remoteVideo('new', 'SET9'), remoteVideo('a', 'SET1')]
  assert.deepEqual(completeYouTubePlaylistVideos(read, saved, 4)?.map(video => video.setVideoId), ['SET9', 'SET1', 'SET2', 'SET3'])

  // A video removed further down changes the count.
  assert.equal(completeYouTubePlaylistVideos(read, saved, 3), null)
  // A video moved up from further down only looks like the saved order at its own entry.
  assert.equal(completeYouTubePlaylistVideos([remoteVideo('new', 'SET9'), remoteVideo('c', 'SET3')], saved, 2), null)
  // An entry added here and not confirmed yet is not known to be there.
  assert.equal(completeYouTubePlaylistVideos(read, [...saved, savedVideo('d', null)], 5), null)
})

test('reordering on YouTube moves the fewest entries into the new order', () => {
  /**
   * @param {string[]} order
   * @param {{ setVideoId: string, movedSetVideoIdPredecessor?: string }[]} moves
   */
  const applyMoves = (order, moves) => {
    const result = [...order]
    for (const move of moves) {
      result.splice(result.indexOf(move.setVideoId), 1)
      const index = move.movedSetVideoIdPredecessor === undefined ? 0 : result.indexOf(move.movedSetVideoIdPredecessor) + 1
      result.splice(index, 0, move.setVideoId)
    }
    return result
  }

  const current = ['a', 'b', 'c', 'd', 'e', 'f']
  // Dragging the first entry to the end is one move.
  assert.deepEqual(planYouTubePlaylistMoves(current, ['b', 'c', 'd', 'e', 'f', 'a']), [
    { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'a', movedSetVideoIdPredecessor: 'f' }
  ])

  let seed = 1
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let run = 0; run < 200; run++) {
    const desired = [...current].sort(() => random() - 0.5)
    assert.deepEqual(applyMoves(current, planYouTubePlaylistMoves(current, desired)), desired)
  }

  // Entries only YouTube has keep their places.
  assert.deepEqual(applyMoves(['a', 'x', 'b'], planYouTubePlaylistMoves(['a', 'x', 'b'], ['b', 'a'])), ['b', 'a', 'x'])
})

test('entries added here get the YouTube entries of their videos before moving', () => {
  const resolved = resolveYouTubeSetVideoIds(
    [savedVideo('a', 'SET1'), savedVideo('b', null), savedVideo('a', null)],
    [remoteVideo('a', 'SET1'), remoteVideo('b', 'SET2'), remoteVideo('a', 'SET3')]
  )
  assert.deepEqual(resolved.map(video => video.youTubeSetVideoId), ['SET1', 'SET2', 'SET3'])
})
