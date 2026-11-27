import assert from 'node:assert/strict'
import test from 'node:test'

import { convertInvidiousPlaylists, convertInvidiousWatchHistory, isInvidiousPlaylistsExport, isInvidiousWatchHistoryExport } from '../../src/renderer/helpers/invidious-import.js'

const exportData = {
  subscriptions: ['UCaaaaaaaaaaaaaaaaaaaaaa'],
  watch_history: ['aaaaaaaaaaa', 'not a video', 'bbbbbbbbbbb', 'aaaaaaaaaaa'],
  preferences: {},
  playlists: [
    { title: 'Music', description: 'Songs', privacy: 'Private', videos: ['ccccccccccc', 'bad', 'ddddddddddd'] },
    { title: 'Empty', description: '', privacy: 'Public', videos: [] },
    { title: ' ', description: '', privacy: 'Public', videos: ['eeeeeeeeeee'] },
  ],
}

test('Invidious exports are recognized by their watch history', () => {
  assert.equal(isInvidiousWatchHistoryExport(exportData), true)
  assert.equal(isInvidiousPlaylistsExport(exportData), true)
  assert.equal(isInvidiousPlaylistsExport({ ...exportData, watch_history: [] }), true)
  // LibreTube backups also have playlists
  assert.equal(isInvidiousPlaylistsExport({ watchHistory: [], playlists: [] }), false)
  assert.equal(isInvidiousWatchHistoryExport([]), false)
})

test('Invidious watch history keeps its newest last entry on top', () => {
  const { records, skipped } = convertInvidiousWatchHistory(exportData, 1000)
  assert.equal(skipped, 1)
  assert.deepEqual(records.map(({ videoId, timeWatched }) => [videoId, timeWatched]), [
    ['bbbbbbbbbbb', 999],
    ['aaaaaaaaaaa', 1000],
  ])
  // The ID placeholder and the missing details let the history repair load them
  assert.deepEqual(records[0], {
    videoId: 'bbbbbbbbbbb',
    title: 'bbbbbbbbbbb',
    author: '',
    authorId: '',
    published: 0,
    timeWatched: 999,
    description: '',
    lengthSeconds: null,
    watchProgress: 0,
    isWatched: true,
    isLive: false,
    type: 'video',
  })
})

test('Invidious playlists keep their order and skip invalid entries', () => {
  assert.deepEqual(convertInvidiousPlaylists(exportData, 1000), [
    {
      playlistName: 'Music',
      description: 'Songs',
      videos: [
        { videoId: 'ccccccccccc', title: 'ccccccccccc', lengthSeconds: 0, timeAdded: 999 },
        { videoId: 'ddddddddddd', title: 'ddddddddddd', lengthSeconds: 0, timeAdded: 1000 },
      ],
    },
    { playlistName: 'Empty', videos: [] },
  ])
})
