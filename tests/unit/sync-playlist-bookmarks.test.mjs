import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive } from 'vue'

import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import { createEmptySyncDocument, EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import { SyncServerDataLossError } from '../../src/renderer/helpers/sync-server-errors.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ ...bookmarks, SyncServerDataLossError })
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
