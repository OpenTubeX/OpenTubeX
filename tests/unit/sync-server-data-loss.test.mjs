import { toRaw } from 'vue'
import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { executeBackgroundJob as runBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'

import { MAIN_PROFILE_ID } from '../../src/constants.js'
import * as errors from '../../src/renderer/helpers/sync-server-errors.js'
import * as bookmarks from '../../src/renderer/helpers/playlist-bookmarks.js'
import * as profileSync from '../../src/renderer/helpers/profile-sync.js'
import { EncryptedSyncAdapter, createEmptySyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
const baselineMethod = storeSource.slice(storeSource.indexOf('    async persistPlaylistSyncBaseline('), storeSource.indexOf('    async persistHistorySyncBaseline('))
function playlistBaseline(previous = {}) {
  const settings = { syncServerSnapshot: JSON.stringify({ playlists: previous }) }
  const persistPlaylistSyncBaseline = vm.runInNewContext(`({${baselineMethod}}).persistPlaylistSyncBaseline`, {
    rootState: { settings }, encrypted: false, historyAccount: Array(5).fill(undefined), parseSnapshot: JSON.parse,
    dispatch: async (action, value) => { assert.equal(action, 'updateSyncServerSnapshot'); settings.syncServerSnapshot = value },
  })
  return { persistPlaylistSyncBaseline, readBaseline: () => JSON.parse(settings.syncServerSnapshot).playlists }
}

const context = vm.createContext({ DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, mergeSyncIds, syncVideoToRemote, runBackgroundJob, toRaw, MAIN_PROFILE_ID, deepCopy: structuredClone, generateRandomUniqueId: randomUUID, ...errors, ...bookmarks, ...profileSync })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

const video = { videoId: 'video-1', title: 'A video', authorId: 'channel-1' }
const channel = { id: 'channel-1', name: 'A channel' }
const bookmark = bookmarks.createPlaylistBookmark({ id: 'playlist-1', title: 'A saved playlist', uploaderId: 'channel-1', uploaderName: 'A channel' })
const profile = { _id: 'profile-1', name: 'A profile', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [channel] }
const playlist = { _id: 'playlist-1', playlistName: 'A playlist', videos: [video] }
const cases = [
  {
    collection: 'subscriptions', method: 'syncSubscriptions',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }] } },
    client: { getSubscriptions: async () => [] },
    previous: [channel.id], item: { id: channel.id, name: channel.name },
  },
  {
    collection: 'saved playlists', method: 'syncPlaylistBookmarks',
    state: { settings: { playlistBookmarks: [bookmark] } },
    client: { getPlaylistBookmarks: async () => [] },
    previous: [bookmark.playlist.id], item: { id: bookmark.playlist.id, name: bookmark.playlist.title },
  },
  {
    collection: 'playlists', method: 'syncPlaylists',
    state: { playlists: { playlists: [playlist] } },
    client: { getPlaylists: async () => [] },
    previous: { [playlist._id]: { metadata: { title: 'Old title' } } },
    item: { id: playlist._id, name: playlist.playlistName },
  },
  {
    collection: 'history', method: 'syncHistory',
    state: { history: { historyCacheSorted: [video] } },
    client: { getWatchHistory: async () => [] },
    previous: [video.videoId], item: { id: video.videoId, name: video.title },
  },
  {
    collection: 'videos in playlist A playlist', method: 'syncPlaylists',
    state: { playlists: { playlists: [playlist] } },
    client: {
      getPlaylists: async () => [{ id: playlist._id }],
      getPlaylist: async () => ({ playlist: { id: playlist._id, title: playlist.playlistName }, videos: [] }),
    },
    previous: { [playlist._id]: { metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } },
    item: { id: video.videoId, name: video.title },
  },
  {
    collection: 'channels in profile A profile', method: 'syncProfiles',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }, profile] } },
    client: {
      getSubscriptionGroups: async () => [{ group: { id: profile._id, title: profile.name }, channels: [] }],
    },
    previous: { [profile._id]: { metadata: { title: profile.name, bgColor: '#000000', textColor: '#FFFFFF' }, channels: [channel.id] } },
    item: { id: channel.id, name: channel.name },
  },
]

for (const scenario of cases) {
  test(`identifies deletions in ${scenario.collection} before applying them`, async () => {
    const store = { ...playlistBaseline(), state: scenario.state, dispatch: () => assert.fail('Unexpected local change') }
    await assert.rejects(context[scenario.method](scenario.client, store, scenario.previous), error => {
      assert.ok(error instanceof errors.SyncServerDataLossError, error.stack)
      assert.equal(error.collection, scenario.collection)
      assert.deepEqual(structuredClone(error.items), [scenario.item])
      return true
    })
  })
}

test('deletion details fall back to IDs and exclude surviving and new items', () => {
  const previous = Array.from({ length: 20 }, (_, index) => `item-${index}`)
  assert.throws(() => context.mergeIds(previous, [...previous.slice(10), 'new-item'], previous), error => {
    assert.equal(error.deleted, 10)
    assert.deepEqual(structuredClone(error.items), previous.slice(0, 10).map(id => ({ id, name: id })))
    return true
  })
  assert.deepEqual(Array.from(context.mergeIds(previous, [], previous, { allowDataLoss: true })), [])
})

test('playlist sync enriches existing remote metadata without losing duplicates or populated values', async () => {
  const id = 'abcdefghijk'
  const localVideos = [
    { videoId: id, title: 'Repaired title', authorId: 'UCchannel', author: 'Repaired channel', published: 100, lengthSeconds: 120, playlistItemId: 'first' },
    { videoId: id, title: id, authorId: 'UCchannel', author: '', published: 0, lengthSeconds: 0, playlistItemId: 'duplicate' },
  ]
  const local = { _id: 'selected', playlistName: 'Takeout', videos: localVideos }
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: local._id, title: local.playlistName, description: '' })
  await adapter.addPlaylistVideos(local._id, [{
    id, title: id, uploader: { id: 'UCchannel', name: 'UCchannel', avatar: 'keep-avatar', verified: true },
    upload_date: 0, duration: 0, thumbnail_url: 'keep-thumbnail',
  }])
  let uploads = 0
  const upload = adapter.addPlaylistVideos.bind(adapter)
  adapter.addPlaylistVideos = async (...args) => { uploads++; return upload(...args) }
  const store = {
    ...playlistBaseline(),
    state: { playlists: { playlists: [local] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'updatePlaylistFromSync')
      store.state.playlists.playlists = [value.playlist]
      return true
    },
  }
  const previous = await context.syncPlaylists(adapter, store)
  const remote = (await adapter.getPlaylist(local._id)).videos
  assert.equal(remote.length, 1)
  assert.equal(remote[0].title, 'Repaired title')
  assert.equal(remote[0].uploader.name, 'Repaired channel')
  assert.equal(remote[0].upload_date, 100)
  assert.equal(remote[0].duration, 120)
  assert.equal(remote[0].uploader.avatar, 'keep-avatar')
  assert.equal(remote[0].uploader.verified, true)
  assert.equal(remote[0].thumbnail_url, 'keep-thumbnail')
  await context.syncPlaylists(adapter, store, previous)
  assert.equal(uploads, 1, 'unchanged repeat sync does not upload metadata again')
  assert.equal((await adapter.getPlaylist(local._id)).videos.length, 1, 'repeat sync does not append duplicates')
  assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, item => item.playlistItemId), ['first', 'duplicate'])
  assert.ok(store.state.playlists.playlists[0].videos.every(item => item.title === 'Repaired title' && item.lengthSeconds === 120))
  const fresh = {
    state: { playlists: { playlists: [] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'addPlaylist')
      fresh.state.playlists.playlists.push(value)
    },
  }
  await context.syncPlaylists(adapter, fresh)
  assert.equal(fresh.state.playlists.playlists[0].videos[0].title, 'Repaired title')
  assert.equal(fresh.state.playlists.playlists[0].videos[0].lengthSeconds, 120)
})

test('playlist metadata enrichment preserves populated conflicting values on each side', async () => {
  const local = { ...playlist, videos: [{ ...video, title: 'Local title', author: 'Local channel', published: 100, lengthSeconds: 120, playlistItemId: 'keep' }] }
  const remote = syncVideoToRemote({ ...local.videos[0], title: 'Remote title', author: 'Remote channel', published: 200, lengthSeconds: 240 })
  const client = {
    getPlaylists: async () => [{ id: local._id }],
    getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [remote] }),
    addPlaylistVideos: () => assert.fail('Populated metadata should not be overwritten'),
  }
  await context.syncPlaylists(client, { state: { playlists: { playlists: [local] } }, dispatch: () => assert.fail('Local metadata should not be overwritten') })
})

for (const lengthSeconds of [120.5, 0.4]) {
  test(`playlist sync fills a missing uploader without duplicating or rounding duration ${lengthSeconds}`, async () => {
    const local = { ...playlist, videos: [{ ...video, authorId: '', author: '', title: video.videoId, published: 0, lengthSeconds, playlistItemId: 'keep' }] }
    const remote = syncVideoToRemote({ ...video, author: 'Remote channel', title: 'Remote title', published: 100, lengthSeconds: 150 })
    let saved
    const client = {
      getPlaylists: async () => [{ id: local._id }],
      getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [remote] }),
      addPlaylistVideos: () => assert.fail('Populated remote metadata should not be overwritten'),
      removePlaylistVideo: () => assert.fail('An incomplete local entry is still a member'),
    }
    await context.syncPlaylists(client, {
      state: { playlists: { playlists: [local] } },
      dispatch: async (action, value) => { assert.equal(action, 'updatePlaylistFromSync'); saved = value.playlist; return true },
    }, { [local._id]: { videos: [video.videoId] } })
    assert.equal(saved.videos.length, 1)
    assert.equal(saved.videos[0].playlistItemId, 'keep')
    assert.equal(saved.videos[0].authorId, video.authorId)
    assert.equal(saved.videos[0].title, 'Remote title')
    assert.equal(saved.videos[0].author, 'Remote channel')
    assert.equal(saved.videos[0].lengthSeconds, lengthSeconds, 'a title/uploader repair must not round a populated duration')
  })
}

for (const edit of ['delete playlist', 'remove entry', 'add entry', 'rename']) {
  test(`playlist sync rejects a stale snapshot after another window's ${edit}`, async () => {
    const local = { ...playlist, videos: [{ ...video, title: 'Repaired title', author: 'Channel', published: 0, lengthSeconds: 120, playlistItemId: 'keep' }] }
    const store = { ...playlistBaseline(), state: { playlists: { playlists: [structuredClone(local)] } }, dispatch: () => assert.fail('A stale playlist must not be written') }
    const client = {
      getPlaylists: async () => [{ id: local._id }],
      getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [syncVideoToRemote({ ...video, title: video.videoId, published: 100, lengthSeconds: 120 })] }),
      addPlaylistVideos: async () => {
        const current = store.state.playlists.playlists[0]
        if (edit === 'delete playlist') store.state.playlists.playlists = []
        else if (edit === 'remove entry') current.videos = []
        else if (edit === 'add entry') current.videos.push({ videoId: 'new-video', playlistItemId: 'new' })
        else current.playlistName = 'Renamed later'
      },
    }
    await assert.rejects(context.syncPlaylists(client, store), /Playlist changed during sync/)
    if (edit === 'delete playlist') assert.equal(store.state.playlists.playlists.length, 0)
    else if (edit === 'remove entry') assert.equal(store.state.playlists.playlists[0].videos.length, 0)
    else if (edit === 'add entry') assert.equal(store.state.playlists.playlists[0].videos[1].playlistItemId, 'new')
    else assert.equal(store.state.playlists.playlists[0].playlistName, 'Renamed later')
  })
}

test('accepting a recorded playlist duration clears stale live and upcoming flags', async () => {
  const local = { ...playlist, videos: [{ ...video, lengthSeconds: 0, isLive: true, liveNow: true, isUpcoming: true, playlistItemId: 'keep' }] }
  let saved
  await context.syncPlaylists({
    getPlaylists: async () => [{ id: local._id }],
    getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [syncVideoToRemote({ ...video, lengthSeconds: 120 })] }),
  }, { ...playlistBaseline(), state: { playlists: { playlists: [local] } }, dispatch: async (_, value) => { saved = value.playlist; return true } })
  assert.equal(saved.videos[0].lengthSeconds, 120)
  assert.equal(saved.videos[0].isLive, false)
  assert.equal(saved.videos[0].liveNow, false)
  assert.equal(saved.videos[0].isUpcoming, false)
})

test('legacy sync preserves an unsyncable occurrence when a syncable duplicate is deleted remotely', async () => {
  const local = { ...playlist, videos: [{ ...video, playlistItemId: 'synced' }, { videoId: video.videoId, playlistItemId: 'unsyncable' }] }
  let saved
  await context.syncPlaylists({
    getPlaylists: async () => [{ id: local._id }],
    getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [] }),
  }, { ...playlistBaseline(), state: { playlists: { playlists: [local] } }, dispatch: async (_, value) => { saved = value.playlist; return true } }, { [local._id]: { videos: [video.videoId] } }, { allowDataLoss: true })
  assert.deepEqual(Array.from(saved.videos, entry => entry.playlistItemId), ['unsyncable'])
})

for (const stage of ['headers', 'creation', 'upload', 'save']) {
  test(`a deletion during first playlist sync at ${stage} cannot return through an orphaned remote copy`, async () => {
    const local = { ...playlist, videos: [{ ...video, title: 'Known title', playlistItemId: 'keep' }] }
    const remote = new Map()
    let created = 0
    const store = {
    ...playlistBaseline(),
      state: { playlists: { playlists: [local] } },
      dispatch: async (action, payload) => {
        if (action === 'addPlaylist') store.state.playlists.playlists.push(payload)
        else if (stage === 'save') { store.state.playlists.playlists = []; return false }
        else assert.fail(`Unexpected action: ${action}`)
      },
    }
    const client = {
      getPlaylists: async () => {
        if (stage === 'headers') store.state.playlists.playlists = []
        return [...remote.values()].map(entry => entry.playlist)
      },
      getPlaylist: async id => remote.get(id),
      createPlaylist: async metadata => {
        created++
        const header = { ...metadata, id: 'server-generated' }
        remote.set(header.id, { playlist: header, videos: [] })
        if (stage === 'creation') store.state.playlists.playlists = []
        return header
      },
      addPlaylistVideos: async (id, videos) => {
        remote.get(id).videos.push(...videos)
        if (stage === 'upload') store.state.playlists.playlists = []
      },
      deletePlaylist: async id => remote.delete(id),
    }
    // Make the sync save a local metadata improvement so the final CAS can fail.
    if (stage === 'save') {
      local.videos.push({ ...video, title: video.videoId, playlistItemId: 'duplicate' })
    }
    await assert.rejects(context.syncPlaylists(client, store), /Playlist changed during sync/)
    assert.equal(remote.size, stage === 'headers' ? 0 : 1)
    if (stage === 'headers') assert.equal(created, 0, 'no remote mutation after a stale header download')
    await context.syncPlaylists(client, store, store.readBaseline(), { allowDataLoss: true })
    assert.equal(remote.size, 0)
    assert.equal(store.state.playlists.playlists.length, 0, 'the next sync cannot re-import the deleted playlist')
  })
}

test('a rejected multi-playlist sync remembers new IDs and preserves remote edits from another device', async () => {
  const first = { ...playlist, _id: 'first' }
  const second = { ...playlist, _id: 'second' }
  const remote = new Map([['existing', { playlist: { id: 'existing', title: 'Keep me', description: '' }, videos: [] }]])
  const removed = []
  let interrupt = true
  const store = {
    ...playlistBaseline(),
    state: { playlists: { playlists: [first, second] } },
    dispatch: async (action, value) => {
      if (action === 'addPlaylist') store.state.playlists.playlists.push(value)
      else {
        assert.equal(action, 'updatePlaylistFromSync')
        store.state.playlists.playlists[0] = value.playlist
      }
      return true
    },
  }
  const client = {
    getPlaylists: async () => [...remote.values()].map(entry => entry.playlist),
    getPlaylist: async id => remote.get(id),
    createPlaylist: async metadata => {
      const header = { ...metadata, id: `remote-${metadata.id}` }
      remote.set(header.id, { playlist: header, videos: [] })
      if (metadata.id === 'second' && interrupt) {
        store.state.playlists.playlists = [first]
        remote.get('remote-first').playlist.title = 'Edited elsewhere'
        remote.get('remote-first').videos.push(syncVideoToRemote({ ...video, videoId: 'remote-added', title: 'Added elsewhere' }))
        interrupt = false
      }
      return header
    },
    addPlaylistVideos: async (id, videos) => remote.get(id).videos.push(...videos),
    deletePlaylist: async id => { removed.push(id); remote.delete(id) },
  }
  await assert.rejects(context.syncPlaylists(client, store), /Playlist changed during sync/)
  assert.deepEqual(removed, [])
  assert.deepEqual([...remote.keys()], ['existing', 'remote-first', 'remote-second'])
  await context.syncPlaylists(client, store, store.readBaseline(), { allowDataLoss: true })
  assert.deepEqual(removed, ['remote-second'])
  assert.equal(store.state.playlists.playlists[0].playlistName, 'Edited elsewhere')
  assert.equal(store.state.playlists.playlists[0].videos[1].videoId, 'remote-added')
  assert.deepEqual(store.state.playlists.playlists.map(entry => entry._id), ['first', 'existing'])
  assert.deepEqual([...remote.keys()], ['existing', 'remote-first'])
})
