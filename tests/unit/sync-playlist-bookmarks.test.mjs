import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive } from 'vue'
import { babelParse } from 'vue/compiler-sfc'

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
      assert.equal(action, 'updatePlaylistBookmarks')
      state.settings.playlistBookmarks = value(state.settings.playlistBookmarks)
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

const settingsSource = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const settingsProgram = babelParse(settingsSource, { sourceType: 'module' }).program.body
const bookmarkActions = settingsProgram
  .find(node => node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'customActions')
  .declarations[0].init.properties
  .filter(node => /PlaylistBookmark/.test(node.key?.name))
const bookmarkHelpers = settingsProgram
  .filter(node => /PlaylistBookmark/.test(node.type === 'VariableDeclaration' ? node.declarations[0].id.name : node.id?.name))

// The real settings actions, against a datastore whose first write waits for `releaseWrite`.
function createSettingsStore(playlistBookmarks, savedBookmarks = playlistBookmarks) {
  let saved = structuredClone(savedBookmarks)
  let releaseWrite
  const heldWrite = new Promise(resolve => { releaseWrite = resolve })
  let writes = 0
  const state = { settings: { playlistBookmarks } }
  const settingsContext = vm.createContext({
    navigator,
    console,
    DBSettingHandlers: {
      async findValue(_id) {
        assert.equal(_id, 'playlistBookmarks')
        return structuredClone(saved)
      },
      async upsert(_id, value) {
        if (writes++ === 0) await heldWrite
        saved = structuredClone(value)
      },
    },
  })
  const actions = vm.runInContext(`${bookmarkHelpers.map(node => settingsSource.slice(node.start, node.end)).join('\n')}
    ({ ${bookmarkActions.map(node => settingsSource.slice(node.start, node.end)).join(',\n')} })`, settingsContext)
  const store = {
    state,
    getters: { get getPlaylistBookmarks() { return state.settings.playlistBookmarks } },
    commit: (mutation, value) => {
      assert.equal(mutation, 'setPlaylistBookmarks')
      state.settings.playlistBookmarks = value
    },
    dispatch: (action, value) => actions[action](store, value),
  }
  return { store, releaseWrite, saved: () => saved }
}

test('a bookmark saved while sync applies its merge survives', async () => {
  const synced = bookmarks.createPlaylistBookmark({ id: 'synced-playlist', title: 'Synced', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 1 })
  const added = bookmarks.createPlaylistBookmark({ id: 'added-playlist', title: 'Added meanwhile', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 2 })
  const remote = bookmarks.createPlaylistBookmark({ id: 'remote-playlist', title: 'Remote', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 3 })
  const { store, releaseWrite, saved } = createSettingsStore([synced])
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylistBookmark(bookmarks.playlistBookmarkForSync(synced))
  await adapter.createPlaylistBookmark(bookmarks.playlistBookmarkForSync(remote))

  // The save's datastore write is still in flight when sync applies its merge.
  const saving = store.dispatch('savePlaylistBookmark', added)
  const dispatch = store.dispatch
  store.dispatch = (action, value) => {
    setImmediate(releaseWrite)
    return dispatch(action, value)
  }
  await context.syncPlaylistBookmarks(adapter, store, ['synced-playlist'])
  await saving

  const ids = ['synced-playlist', 'added-playlist', 'remote-playlist']
  assert.deepEqual(Array.from(store.state.settings.playlistBookmarks, bookmark => bookmark.playlist.id), ids)
  assert.deepEqual(Array.from(saved(), bookmark => bookmark.playlist.id), ids)
})

test('a bookmark saved in another window survives a save here before its broadcast arrives', async () => {
  const otherWindow = bookmarks.createPlaylistBookmark({ id: 'other-window', title: 'Other window', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 1 })
  const added = bookmarks.createPlaylistBookmark({ id: 'added-playlist', title: 'Added here', uploaderId: 'channel', uploaderName: 'Channel', savedAt: 2 })
  const { store, releaseWrite, saved } = createSettingsStore([], [otherWindow])
  releaseWrite()

  assert.equal(await store.dispatch('savePlaylistBookmark', added), true)
  const ids = ['other-window', 'added-playlist']
  assert.deepEqual(Array.from(store.state.settings.playlistBookmarks, bookmark => bookmark.playlist.id), ids)
  assert.deepEqual(Array.from(saved(), bookmark => bookmark.playlist.id), ids)
})
