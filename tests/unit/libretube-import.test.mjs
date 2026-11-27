import assert from 'node:assert/strict'
import test from 'node:test'

import {
  convertLibreTubePlaylists,
  convertLibreTubeSearchHistory,
  convertLibreTubeWatchHistoryToOpenTubeX,
  isLibreTubePlaylistsExport,
} from '../../src/renderer/helpers/libretube.js'

test('LibreTube watch positions are read as milliseconds', () => {
  const { historyItems } = convertLibreTubeWatchHistoryToOpenTubeX({
    watchHistory: [
      { videoId: 'aaaaaaaaaaa', title: 'Early', duration: 3600 },
      { videoId: 'bbbbbbbbbbb', title: 'Finished', duration: 600 },
    ],
    watchPositions: [
      { videoId: 'aaaaaaaaaaa', position: 3600 },
      { videoId: 'bbbbbbbbbbb', position: 590_000 },
    ],
  })
  const [early, finished] = [...historyItems.values()]
  assert.equal(early.watchProgress, 3.6)
  assert.equal(early.isWatched, false)
  assert.equal(finished.watchProgress, 590)
  assert.equal(finished.isWatched, true)
  // LibreTube backs up its history oldest first
  assert.ok(finished.timeWatched > early.timeWatched)
})

const localPlaylist = {
  playlist: { id: 1, name: 'Music', thumbnailUrl: '', description: 'Songs' },
  videos: [
    { id: 1, playlistId: 1, videoId: 'aaaaaaaaaaa', title: 'First', uploader: 'Channel', uploaderUrl: '/channel/UCaaaaaaaaaaaaaaaaaaaaaa', duration: 60 },
    { id: 2, playlistId: 1, videoId: 'not a video' },
    { id: 3, playlistId: 1, videoId: 'bbbbbbbbbbb' },
  ],
}

test('LibreTube backups import their local playlists with video details', () => {
  // Backups also save the same playlists in Piped's format
  const backup = {
    format: 'Piped',
    version: 1,
    localPlaylists: [localPlaylist],
    playlists: [{ name: 'Music', type: 'playlist', visibility: 'private', videos: ['https://www.youtube.com/watch?v=aaaaaaaaaaa'] }],
  }
  assert.equal(isLibreTubePlaylistsExport(backup), true)
  assert.deepEqual(convertLibreTubePlaylists(backup, 1000), [{
    playlistName: 'Music',
    description: 'Songs',
    videos: [
      { videoId: 'aaaaaaaaaaa', title: 'First', author: 'Channel', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa', lengthSeconds: 60, timeAdded: 999 },
      { videoId: 'bbbbbbbbbbb', title: 'bbbbbbbbbbb', author: '', authorId: '', lengthSeconds: 0, timeAdded: 1000 },
    ],
  }])
})

test('Piped playlist exports import their video URLs in order', () => {
  const pipedExport = {
    format: 'Piped',
    version: 1,
    playlists: [
      { name: 'Later', type: 'playlist', visibility: 'private', videos: ['https://youtube.com/watch?v=ccccccccccc', 'https://example.com/watch?v=ddddddddddd', 'https://youtu.be/eeeeeeeeeee'] },
      { name: '', videos: ['https://youtube.com/watch?v=fffffffffff'] },
    ],
  }
  assert.equal(isLibreTubePlaylistsExport(pipedExport), true)
  // Invidious exports have playlists too, but no format
  assert.equal(isLibreTubePlaylistsExport({ watch_history: [], playlists: [] }), false)
  assert.deepEqual(convertLibreTubePlaylists(pipedExport, 1000), [{
    playlistName: 'Later',
    videos: [
      { videoId: 'ccccccccccc', title: 'ccccccccccc', lengthSeconds: 0, timeAdded: 999 },
      { videoId: 'eeeeeeeeeee', title: 'eeeeeeeeeee', lengthSeconds: 0, timeAdded: 1000 },
    ],
  }])
})

test('LibreTube search history keeps its newest last search on top', () => {
  const entries = convertLibreTubeSearchHistory({ searchHistory: [{ query: 'first' }, { query: ' ' }, { query: 'second' }, { query: 'first ' }] }, 1000)
  assert.deepEqual(entries.map(({ query, lastUpdatedAt }) => [query, lastUpdatedAt]), [['second', 999], ['first', 1000]])
})
