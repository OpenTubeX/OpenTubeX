import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive } from 'vue'

import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import { createEmptySyncDocument, EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote, ...bookmarks, SyncServerDataLossError })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

function createStore(playlistBookmarks = []) {
  const state = reactive({ settings: { playlistBookmarks } })
  return {
    state,
    dispatch: async (action, value) => {
      assert.equal(action, 'replacePlaylistBookmarks')
      state.settings.playlistBookmarks = value
      return true
    },
  }
}

test('syncs saved playlists from reactive state to another device with enhanced privacy', async () => {
  const saved = bookmarks.createPlaylistBookmark({
    id: 'saved-playlist',
    title: 'Saved playlist',
    description: 'Playlist description',
    thumbnailUrl: 'https://i.ytimg.com/vi/video/hqdefault.jpg',
    videoCount: 7,
    uploaderId: 'saved-channel',
    uploaderName: 'Saved channel',
    uploaderAvatar: 'https://yt3.googleusercontent.com/avatar',
    uploaderVerified: true,
    savedAt: 123,
  })
  const firstDevice = createStore([saved])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())

  const firstSnapshot = await context.syncPlaylistBookmarks(adapter, firstDevice)
  assert.deepEqual(Array.from(firstSnapshot), [saved.playlist.id])
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [{ playlist: saved.playlist, uploader: saved.uploader }])

  const secondDevice = createStore()
  const secondSnapshot = await context.syncPlaylistBookmarks(adapter, secondDevice)
  const imported = secondDevice.state.settings.playlistBookmarks[0]
  assert.deepEqual(imported.playlist, saved.playlist)
  assert.deepEqual(imported.uploader, saved.uploader)
  assert.ok(imported.savedAt > 0)

  // Local metadata changes must not mutate the downloaded sync document.
  firstDevice.state.settings.playlistBookmarks[0].playlist.title = 'Refreshed locally'
  assert.equal((await adapter.getPlaylistBookmarks())[0].playlist.title, 'Saved playlist')
  await context.syncPlaylistBookmarks(adapter, secondDevice, secondSnapshot)

  firstDevice.state.settings.playlistBookmarks = []
  await context.syncPlaylistBookmarks(adapter, firstDevice, firstSnapshot, { allowDataLoss: true })
  await context.syncPlaylistBookmarks(adapter, secondDevice, secondSnapshot, { allowDataLoss: true })
  assert.deepEqual(await adapter.getPlaylistBookmarks(), [])
  assert.equal(secondDevice.state.settings.playlistBookmarks.length, 0)
})

test('keeps playlist bookmarks saved while the sync waits for the server', async () => {
  const synced = bookmarks.createPlaylistBookmark({ id: 'synced-playlist', title: 'Synced', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 1 })
  const added = bookmarks.createPlaylistBookmark({ id: 'added-playlist', title: 'Added meanwhile', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 2 })
  const remote = bookmarks.createPlaylistBookmark({ id: 'remote-playlist', title: 'Remote', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 3 })
  const store = createStore([synced])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylistBookmark(bookmarks.playlistBookmarkForSync(remote))
  const createPlaylistBookmark = adapter.createPlaylistBookmark.bind(adapter)
  adapter.createPlaylistBookmark = async bookmark => {
    // Saving a bookmark replaces the whole list, as `savePlaylistBookmark` does.
    store.state.settings.playlistBookmarks = [...store.state.settings.playlistBookmarks, added]
    return createPlaylistBookmark(bookmark)
  }

  await context.syncPlaylistBookmarks(adapter, store, [])
  assert.deepEqual(
    Array.from(store.state.settings.playlistBookmarks, bookmark => bookmark.playlist.id),
    ['synced-playlist', 'added-playlist', 'remote-playlist']
  )
})

test('a bookmark removed while the sync uploads it stays removed', async () => {
  const removed = bookmarks.createPlaylistBookmark({ id: 'removed-playlist', title: 'Removed meanwhile', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 1 })
  const remote = bookmarks.createPlaylistBookmark({ id: 'remote-playlist', title: 'Remote', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 2 })
  const store = createStore([removed])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylistBookmark(bookmarks.playlistBookmarkForSync(remote))
  const createPlaylistBookmark = adapter.createPlaylistBookmark.bind(adapter)
  adapter.createPlaylistBookmark = async bookmark => {
    store.state.settings.playlistBookmarks = []
    return createPlaylistBookmark(bookmark)
  }

  let previousIds = []
  try {
    previousIds = await context.syncPlaylistBookmarks(adapter, store, previousIds)
  } catch {}
  adapter.createPlaylistBookmark = createPlaylistBookmark
  await context.syncPlaylistBookmarks(adapter, store, previousIds)
  assert.deepEqual(Array.from(store.state.settings.playlistBookmarks, bookmark => bookmark.playlist.id), ['remote-playlist'])
  assert.deepEqual((await adapter.getPlaylistBookmarks()).map(bookmark => bookmark.playlist.id), ['remote-playlist'])
})
