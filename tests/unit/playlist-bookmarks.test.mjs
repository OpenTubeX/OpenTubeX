import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPlaylistBookmark,
  mergePlaylistBookmarkConflict,
  playlistBookmarkForSync,
  playlistBookmarkToListData,
} from '../../src/renderer/helpers/playlist-bookmarks.js'

function bookmark (id, savedAt = 123) {
  return createPlaylistBookmark({
    id,
    title: `Playlist ${id}`,
    description: 'A saved YouTube playlist',
    thumbnailUrl: `https://invidious.test/vi/${id}/hqdefault.jpg`,
    videoCount: 4,
    uploaderId: `channel-${id}`,
    uploaderName: `Channel ${id}`,
    uploaderAvatar: `https://invidious.test/ggpht/avatar-${id}`,
    savedAt,
  })
}

test('creates portable bookmark metadata and read-only playlist list data', () => {
  const saved = bookmark('local')

  assert.equal(saved.playlist.thumbnail_url, 'https://i.ytimg.com/vi/local/hqdefault.jpg')
  assert.equal(saved.uploader.avatar, 'https://yt3.googleusercontent.com/avatar-local')
  assert.deepEqual(playlistBookmarkToListData(saved), {
    type: 'playlist',
    isPlaylistBookmark: true,
    title: 'Playlist local',
    playlistName: 'Playlist local',
    description: 'A saved YouTube playlist',
    playlistId: 'local',
    playlistThumbnail: 'https://i.ytimg.com/vi/local/hqdefault.jpg',
    author: 'Channel local',
    authorId: 'channel-local',
    authorVerified: false,
    authorThumbnails: [{ url: 'https://yt3.googleusercontent.com/avatar-local' }],
    videoCount: 4,
    createdAt: 123,
    lastUpdatedAt: 123,
    videos: [],
  })
})

test('preserves playlist bookmark deletions during an encrypted sync conflict retry', () => {
  const deleted = playlistBookmarkForSync(bookmark('deleted'))
  const unchanged = playlistBookmarkForSync(bookmark('unchanged'))
  const remoteChanged = {
    ...unchanged,
    playlist: { ...unchanged.playlist, title: 'Changed remotely' },
  }
  const remoteAdded = playlistBookmarkForSync(bookmark('remote-added'))

  assert.deepEqual(mergePlaylistBookmarkConflict({
    original: [deleted, unchanged],
    local: [unchanged],
    remote: [deleted, remoteChanged, remoteAdded],
  }), [remoteChanged, remoteAdded])
})
