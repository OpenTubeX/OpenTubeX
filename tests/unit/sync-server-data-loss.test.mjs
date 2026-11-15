import { toRaw } from 'vue'
import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
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
import { isPlaylistSortOrder } from '../../src/renderer/helpers/playlists.js'
import { createHistoryChangeTracker } from '../../src/renderer/helpers/sync-history-changes.js'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/sync-server.js', import.meta.url), 'utf8')
const baselineMethod = storeSource.slice(storeSource.indexOf('    async persistPlaylistSyncBaseline('), storeSource.indexOf('    async persistHistorySyncBaseline('))
function playlistBaseline(previous = {}) {
  const settings = { syncServerSnapshot: JSON.stringify({ playlists: previous }) }
  const persistPlaylistSyncBaseline = vm.runInNewContext(`({${baselineMethod}}).persistPlaylistSyncBaseline`, {
    rootState: { settings },
    encrypted: false,
    isSameAccount: () => true,
    parseSnapshot: JSON.parse,
    dispatch: async (action, value) => { assert.equal(action, 'updateSyncServerSnapshot'); settings.syncServerSnapshot = value },
  })
  return { persistPlaylistSyncBaseline, readBaseline: () => JSON.parse(settings.syncServerSnapshot).playlists }
}

const historyChanges = createHistoryChangeTracker()
const context = vm.createContext({ historyChanges, DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote, runBackgroundJob, toRaw, MAIN_PROFILE_ID, deepCopy: structuredClone, generateRandomUniqueId: randomUUID, isPlaylistSortOrder, ...errors, ...bookmarks, ...profileSync })
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

const video = { videoId: 'video-1', title: 'A video', authorId: 'channel-1' }
const channel = { id: 'channel-1', name: 'A channel' }
const bookmark = bookmarks.createPlaylistBookmark({ id: 'playlist-1', title: 'A saved playlist', uploaderId: 'channel-1', uploaderName: 'A channel' })
const profile = { _id: 'profile-1', name: 'A profile', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [channel] }
const playlist = { _id: 'playlist-1', playlistName: 'A playlist', videos: [video] }
const largePlaylist = {
  _id: 'playlist-large',
  playlistName: 'A large playlist',
  videos: Array.from({ length: 10 }, (_, index) => ({ videoId: `video-${index}`, title: `Video ${index}`, authorId: 'channel-1' })),
}
const largeProfile = {
  _id: 'profile-large',
  name: 'A large profile',
  bgColor: '#000000',
  textColor: '#FFFFFF',
  subscriptions: Array.from({ length: 10 }, (_, index) => ({ id: `channel-${index}`, name: `Channel ${index}` })),
}
const cases = [
  {
    collection: 'subscriptions',
    method: 'syncSubscriptions',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }] } },
    client: { getSubscriptions: async () => [] },
    previous: [channel.id],
    item: { id: channel.id, name: channel.name },
  },
  {
    collection: 'playlistBookmarks',
    method: 'syncPlaylistBookmarks',
    state: { settings: { playlistBookmarks: [bookmark] } },
    client: { getPlaylistBookmarks: async () => [] },
    previous: [bookmark.playlist.id],
    item: { id: bookmark.playlist.id, name: bookmark.playlist.title },
  },
  {
    collection: 'playlists',
    method: 'syncPlaylists',
    state: { playlists: { playlists: [playlist] } },
    client: { getPlaylists: async () => [] },
    previous: { [playlist._id]: { metadata: { title: 'Old title' } } },
    item: { id: playlist._id, name: playlist.playlistName },
  },
  {
    collection: 'history',
    method: 'syncHistory',
    state: { history: { historyCacheSorted: [video] } },
    client: { getWatchHistory: async () => [] },
    previous: [video.videoId],
    item: { id: video.videoId, name: video.title },
  },
  {
    collection: 'playlistVideos',
    scope: largePlaylist._id,
    scopeName: largePlaylist.playlistName,
    method: 'syncPlaylists',
    state: { playlists: { playlists: [largePlaylist] } },
    client: {
      getPlaylists: async () => [{ id: largePlaylist._id }],
      getPlaylist: async () => ({ playlist: { id: largePlaylist._id, title: largePlaylist.playlistName }, videos: [] }),
    },
    previous: { [largePlaylist._id]: { metadata: { title: largePlaylist.playlistName, description: '' }, videos: largePlaylist.videos.map(item => item.videoId) } },
    items: largePlaylist.videos.map(item => ({ id: item.videoId, name: item.title })),
  },
  {
    collection: 'profileChannels',
    scope: largeProfile._id,
    scopeName: largeProfile.name,
    method: 'syncProfiles',
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: largeProfile.subscriptions }, largeProfile] } },
    client: {
      getSubscriptionGroups: async () => [{ group: { id: largeProfile._id, title: largeProfile.name }, channels: [] }],
    },
    previous: { [largeProfile._id]: { metadata: { title: largeProfile.name, bgColor: '#000000', textColor: '#FFFFFF' }, channels: largeProfile.subscriptions.map(item => item.id) } },
    items: largeProfile.subscriptions.map(item => ({ id: item.id, name: item.name })),
  },
]

for (const scenario of cases) {
  test(`identifies deletions in ${scenario.collection} before applying them`, async () => {
    const store = { ...playlistBaseline(), state: scenario.state, dispatch: () => assert.fail('Unexpected local change') }
    await assert.rejects(context[scenario.method](scenario.client, store, scenario.previous), error => {
      assert.ok(error instanceof errors.SyncServerDataLossError, error.stack)
      assert.equal(error.collection, scenario.collection)
      assert.equal(error.scope, scenario.scope ?? null)
      assert.equal(error.scopeName, scenario.scopeName ?? null)
      assert.deepEqual(structuredClone(error.items), scenario.items ?? [scenario.item])
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
    id,
    title: id,
    uploader: { id: 'UCchannel', name: 'UCchannel', avatar: 'keep-avatar', verified: true },
    upload_date: 0,
    duration: 0,
    thumbnail_url: 'keep-thumbnail',
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
    ...playlistBaseline(),
    state: { playlists: { playlists: [] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'addPlaylist')
      fresh.state.playlists.playlists.push(value)
      return true
    },
  }
  await context.syncPlaylists(adapter, fresh)
  assert.equal(fresh.state.playlists.playlists[0].videos[0].title, 'Repaired title')
  assert.equal(fresh.state.playlists.playlists[0].videos[0].lengthSeconds, 120)
})

for (const addVideosToTop of [false, true]) {
  test(`playlist sync places remote-only videos using local insertion preference ${addVideosToTop}`, async () => {
    const local = {
      _id: 'insertion-order',
      playlistName: 'Ordered',
      addVideosToTop,
      videos: [
        { videoId: 'existing', title: 'Existing', authorId: 'UCchannel', playlistItemId: 'first' },
        { videoId: 'existing', title: 'Existing', authorId: 'UCchannel', playlistItemId: 'duplicate' },
      ],
    }
    const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
    await adapter.createPlaylist({ id: local._id, title: local.playlistName, description: '' })
    await adapter.addPlaylistVideos(local._id, ['existing', 'remote-a', 'remote-b'].map(id => ({
      id, title: id, uploader: { id: 'UCchannel', name: 'Channel' }, duration: 60,
    })))
    const store = {
      ...playlistBaseline(),
      state: { playlists: { playlists: [local] } },
      dispatch: async (action, payload) => {
        assert.equal(action, 'updatePlaylistFromSync')
        store.state.playlists.playlists = [payload.playlist]
        return true
      },
    }
    const previous = await context.syncPlaylists(adapter, store)
    const expected = addVideosToTop ? ['remote-a', 'remote-b', 'existing', 'existing'] : ['existing', 'existing', 'remote-a', 'remote-b']
    assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, video => video.videoId), expected)
    const next = await context.syncPlaylists(adapter, store, previous)
    assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, video => video.videoId), expected)
    assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos.filter(video => video.videoId === 'existing'), video => video.playlistItemId), ['first', 'duplicate'])
    await adapter.removePlaylistVideo(local._id, 'remote-a')
    await context.syncPlaylists(adapter, store, next, { allowDataLoss: true })
    assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, video => video.videoId), expected.filter(id => id !== 'remote-a'))
  })
}

test('playlist metadata enrichment preserves populated conflicting values on each side', async () => {
  const local = { ...playlist, videos: [{ ...video, title: 'Local title', author: 'Local channel', published: 100, lengthSeconds: 120, playlistItemId: 'keep' }] }
  const remote = syncVideoToRemote({ ...local.videos[0], title: 'Remote title', author: 'Remote channel', published: 200, lengthSeconds: 240 })
  const client = {
    getPlaylists: async () => [{ id: local._id }],
    getPlaylist: async () => ({ playlist: { id: local._id, title: local.playlistName }, videos: [remote] }),
    addPlaylistVideos: () => assert.fail('Populated metadata should not be overwritten'),
  }
  await context.syncPlaylists(client, { ...playlistBaseline(), state: { playlists: { playlists: [local] } }, dispatch: () => assert.fail('Local metadata should not be overwritten') })
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
      ...playlistBaseline(),
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
        else if (stage === 'save') { store.state.playlists.playlists = []; return false } else assert.fail(`Unexpected action: ${action}`)
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

test('retry after a rejected metadata save preserves another device’s playlist rename and description', async () => {
  const local = { ...playlist, description: 'Original description', videos: [{ ...video, title: 'Recovered title' }] }
  const metadata = { id: local._id, title: local.playlistName, description: local.description, thumbnail_url: null }
  const previous = { [local._id]: { remoteId: local._id, metadata, videos: [video.videoId] } }
  const remote = { playlist: { ...metadata, title: 'Renamed elsewhere', description: 'Changed elsewhere' }, videos: [syncVideoToRemote({ ...video, title: video.videoId })] }
  let interrupt = true
  const store = {
    ...playlistBaseline(previous),
    state: { playlists: { playlists: [local] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'updatePlaylistFromSync')
      store.state.playlists.playlists[0] = value.playlist
      return true
    },
  }
  const client = {
    getPlaylists: async () => [remote.playlist],
    getPlaylist: async () => remote,
    updatePlaylist: async (_, value) => { remote.playlist = value },
    addPlaylistVideos: async (_, videos) => {
      remote.videos = videos
      if (interrupt) {
        local.videos.push({ ...video, videoId: 'concurrent-add', title: 'Added locally' })
        interrupt = false
      }
    },
  }
  await assert.rejects(context.syncPlaylists(client, store, previous), /Playlist changed during sync/)
  await context.syncPlaylists(client, store, store.readBaseline())
  assert.equal(remote.playlist.title, 'Renamed elsewhere')
  assert.equal(remote.playlist.description, 'Changed elsewhere')
  assert.equal(store.state.playlists.playlists[0].playlistName, 'Renamed elsewhere')
  assert.equal(store.state.playlists.playlists[0].description, 'Changed elsewhere')
})

test('playlist removal acknowledgments are batched and retain completed removals on failure', async () => {
  const local = { ...playlist, videos: [video] }
  const metadata = { id: local._id, title: local.playlistName, description: '', thumbnail_url: null }
  const remoteVideos = [video, ...['removed-first', 'removed-second', 'fails-third', 'unattempted'].map(videoId => ({ ...video, videoId }))].map(syncVideoToRemote)
  const previous = { [local._id]: { remoteId: local._id, metadata, videos: remoteVideos.map(entry => entry.id) } }
  const baseline = playlistBaseline(previous)
  const acknowledgments = []
  const store = {
    ...baseline,
    state: { playlists: { playlists: [local] } },
    persistPlaylistSyncBaseline: async (id, changes) => {
      acknowledgments.push(changes)
      await baseline.persistPlaylistSyncBaseline(id, changes)
    },
    dispatch: () => assert.fail('The failed remote stage must not save local metadata'),
  }
  await assert.rejects(context.syncPlaylists({
    getPlaylists: async () => [metadata],
    getPlaylist: async () => ({ playlist: metadata, videos: remoteVideos }),
    removePlaylistVideo: async (_, id) => { if (id === 'fails-third') throw new Error('Removal failed') },
  }, store, previous, { allowDataLoss: true }), /Removal failed/)
  assert.equal(acknowledgments.length, 1)
  assert.deepEqual(Array.from(acknowledgments[0].removed), ['removed-first', 'removed-second'])
  assert.deepEqual(store.readBaseline()[local._id].videos, [video.videoId, 'fails-third', 'unattempted'])
})

test('a completed playlist baseline forgets obsolete membership so a later remote addition survives retry', async () => {
  const local = { ...playlist, videos: [] }
  const metadata = { id: local._id, title: local.playlistName, description: '', thumbnail_url: null }
  const baseline = playlistBaseline({ [local._id]: { remoteId: local._id, metadata, videos: [video.videoId] } })
  // A later stage fails after this playlist succeeds, leaving the partial
  // baseline in place. Another device then re-adds the formerly deleted video.
  await baseline.persistPlaylistSyncBaseline(local._id, { remoteId: local._id, metadata, applied: true, videos: [] })
  const store = {
    ...baseline,
    state: { playlists: { playlists: [local] } },
    dispatch: async (_, value) => { store.state.playlists.playlists[0] = value.playlist; return true },
  }
  await context.syncPlaylists({
    getPlaylists: async () => [metadata],
    getPlaylist: async () => ({ playlist: metadata, videos: [syncVideoToRemote(video)] }),
    removePlaylistVideo: () => assert.fail('A newly re-added remote video must survive retry'),
  }, store, store.readBaseline(), { allowDataLoss: true })
  assert.equal(store.state.playlists.playlists[0].videos[0].videoId, video.videoId)
})

test('an unchanged playlist baseline does not rewrite the saved sync snapshot', async () => {
  const metadata = { id: playlist._id, title: playlist.playlistName, description: '', thumbnail_url: null }
  const saved = { [playlist._id]: { remoteId: playlist._id, metadata, videos: [video.videoId] } }
  let writes = 0
  const persist = vm.runInNewContext(`({${baselineMethod}}).persistPlaylistSyncBaseline`, {
    rootState: { settings: { syncServerSnapshot: JSON.stringify({ playlists: saved }) } },
    encrypted: false,
    isSameAccount: () => true,
    parseSnapshot: JSON.parse,
    dispatch: async () => { writes++ },
  })
  // Every completed playlist reports its baseline. Rewriting an identical
  // snapshot stores the whole sync state again for each playlist.
  await persist(playlist._id, { remoteId: playlist._id, metadata, applied: true, videos: [video.videoId] })
  assert.equal(writes, 0)
  await persist(playlist._id, { remoteId: playlist._id, metadata: { ...metadata, title: 'Renamed' }, applied: true, videos: [video.videoId] })
  assert.equal(writes, 1)
})

for (const lostOn of ['server', 'device']) {
  test(`keeping a playlist the ${lostOn} lost restores it with its videos`, async () => {
    const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
    const previous = { [playlist._id]: { remoteId: playlist._id, metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } }
    if (lostOn === 'device') {
      await adapter.createPlaylist({ id: playlist._id, title: playlist.playlistName, description: '' })
      await adapter.addPlaylistVideos(playlist._id, [syncVideoToRemote(video)])
    }
    const store = {
      ...playlistBaseline(previous),
      state: { playlists: { playlists: lostOn === 'server' ? [structuredClone(playlist)] : [] } },
      dispatch: async (action, value) => {
        if (action === 'addPlaylist') store.state.playlists.playlists.push(value)
        else if (action === 'updatePlaylistFromSync') store.state.playlists.playlists = [value.playlist]
        else assert.fail(`Unexpected ${action}`)
        return true
      },
    }
    await context.syncPlaylists(adapter, store, previous, { deletions: { playlists: { kept: [playlist._id] } } })
    const [remote] = await adapter.getPlaylists()
    assert.deepEqual(Array.from((await adapter.getPlaylist(remote.id)).videos, item => item.id), [video.videoId])
    assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, item => item.videoId), [video.videoId])
  })
}

test('keeping a profile the server lost restores its channels', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const previous = { [profile._id]: { metadata: { title: profile.name, bgColor: '#000000', textColor: '#FFFFFF' }, channels: [channel.id] } }
  const store = {
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }, structuredClone(profile)] } },
    dispatch: async (action, value) => {
      assert.notEqual(action, 'removeProfile')
      if (action === 'updateProfileSubscriptionsFromSync') {
        store.state.profiles.profileList.find(item => item._id === value.profileId).subscriptions = value.subscriptions
      }
      return true
    },
  }
  await context.syncProfiles(adapter, store, previous, { deletions: { profiles: { kept: [profile._id] } } })
  const [group] = await adapter.getSubscriptionGroups()
  assert.deepEqual(Array.from(group.channels, item => item.id), [channel.id])
  assert.deepEqual(Array.from(store.state.profiles.profileList[1].subscriptions, item => item.id), [channel.id])
})

test('retrying an interrupted playlist restoration keeps its videos', async () => {
  // The first attempt recreated the playlist on the server, then failed before uploading its video.
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: playlist._id, title: playlist.playlistName, description: '' })
  const previous = { [playlist._id]: { remoteId: playlist._id, metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } }
  const store = {
    ...playlistBaseline(previous),
    state: { playlists: { playlists: [structuredClone(playlist)] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'updatePlaylistFromSync')
      store.state.playlists.playlists = [value.playlist]
      return true
    },
  }
  await context.syncPlaylists(adapter, store, previous, { deletions: { playlists: { kept: [playlist._id] } } })
  assert.deepEqual(Array.from((await adapter.getPlaylist(playlist._id)).videos, item => item.id), [video.videoId])
  assert.deepEqual(Array.from(store.state.playlists.playlists[0].videos, item => item.videoId), [video.videoId])
})

test('a video removed while a playlist restoration is pending stays removed', async () => {
  // The playlist was restored on the server, then the user removed its video before the sync succeeded.
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createPlaylist({ id: playlist._id, title: playlist.playlistName, description: '' })
  await adapter.addPlaylistVideos(playlist._id, [syncVideoToRemote(video)])
  const previous = { [playlist._id]: { remoteId: playlist._id, metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } }
  const store = {
    ...playlistBaseline(previous),
    state: { playlists: { playlists: [{ ...structuredClone(playlist), videos: [] }] } },
    dispatch: async () => assert.fail('Unexpected local change'),
  }
  await context.syncPlaylists(adapter, store, previous, {
    deletions: { playlists: { kept: [playlist._id] }, [`playlistVideos:${playlist._id}`]: { confirmed: [video.videoId] } },
  })
  assert.deepEqual(Array.from((await adapter.getPlaylist(playlist._id)).videos), [])
})

test('a remote playlist that could not be saved locally is not deleted from the server by the retry', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const created = await adapter.createPlaylist({ id: playlist._id, title: playlist.playlistName, description: '' })
  const remoteId = created?.id ?? playlist._id
  await adapter.addPlaylistVideos(remoteId, [syncVideoToRemote(video)])
  let saveFails = true
  const store = {
    ...playlistBaseline(),
    state: { playlists: { playlists: [] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'addPlaylist')
      if (saveFails) return false
      store.state.playlists.playlists.push(value)
      return true
    },
  }
  await assert.rejects(context.syncPlaylists(adapter, store), /Could not save synced playlist/)
  const previous = store.readBaseline() ?? {}
  assert.equal(previous[playlist._id], undefined)

  saveFails = false
  await context.syncPlaylists(adapter, store, previous)
  assert.deepEqual(Array.from(await adapter.getPlaylists(), item => item.id), [remoteId])
  assert.deepEqual(store.state.playlists.playlists.map(item => item._id), [playlist._id])
})

test('a remote profile that could not be saved locally is not deleted from the server by the retry', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  await adapter.createSubscriptionGroup({ id: profile._id, local_id: profile._id, title: profile.name, bg_color: '#000000', text_color: '#FFFFFF' })
  const store = {
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }] } },
    dispatch: async action => {
      assert.equal(action, 'saveSyncedProfile')
      return false
    },
  }
  await assert.rejects(context.syncProfiles(adapter, store), /Profiles changed during sync/)
})

test('a profile deletion that could not be saved locally fails the sync', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const previous = { [profile._id]: { metadata: { title: profile.name, bgColor: '#000000', textColor: '#FFFFFF' }, channels: [channel.id] } }
  const store = {
    state: { profiles: { profileList: [{ _id: MAIN_PROFILE_ID, subscriptions: [channel] }, structuredClone(profile)] } },
    dispatch: async action => {
      assert.equal(action, 'removeProfile')
      return false
    },
  }
  await assert.rejects(context.syncProfiles(adapter, store, previous, { allowDataLoss: true }), /Could not remove synced profile/)
})

test('a playlist deletion that could not be saved locally fails the sync', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const previous = { [playlist._id]: { remoteId: playlist._id, metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } }
  const store = {
    ...playlistBaseline(previous),
    state: { playlists: { playlists: [structuredClone(playlist)] } },
    // `removePlaylist` logs failures instead of reporting them, leaving the playlist in place.
    dispatch: async action => assert.equal(action, 'removePlaylist'),
  }
  await assert.rejects(context.syncPlaylists(adapter, store, previous, { allowDataLoss: true }), /Could not remove synced playlist/)
})

test('a protected playlist deleted on another device is restored instead of failing every sync', async () => {
  const adapter = new EncryptedSyncAdapter(createEmptySyncDocument())
  const previous = { [playlist._id]: { remoteId: playlist._id, metadata: { title: playlist.playlistName, description: '' }, videos: [video.videoId] } }
  const store = {
    ...playlistBaseline(previous),
    state: { playlists: { playlists: [{ ...structuredClone(playlist), protected: true }] } },
    // `removePlaylist` keeps protected playlists.
    dispatch: async action => action !== 'removePlaylist',
  }
  await context.syncPlaylists(adapter, store, previous, { allowDataLoss: true })
  assert.deepEqual(Array.from(await adapter.getPlaylists(), item => item.title), [playlist.playlistName])
})

// Another device removes the downloaded items before this device's upload.
// The retry merges against the conflict baseline the first merge reports.
async function syncAgainAfterConflict(method, store, remote, removeDownloaded) {
  let getRetryBaseline
  const onRetryBaseline = getBaseline => { getRetryBaseline = getBaseline }
  const options = method === 'syncHistory' ? [{}, { onRetryBaseline }] : [{ onRetryBaseline }]
  await context[method](new EncryptedSyncAdapter(remote), store, {}, ...options)
  removeDownloaded(remote)
  const retried = new EncryptedSyncAdapter(remote)
  await context[method](retried, store, getRetryBaseline())
  return retried.document
}

test('after an upload conflict, playlists and videos removed on the server stay removed', async () => {
  const localVideo = { videoId: 'local-video', title: 'Local video', authorId: 'channel-1' }
  const remoteVideo = { id: 'remote-video', title: 'Remote video', uploader: { id: 'channel-1', name: 'A channel' }, upload_date: 0, duration: 0 }
  const store = {
    persistPlaylistSyncBaseline: async () => {},
    state: { playlists: { playlists: [{ _id: 'shared', playlistName: 'Shared', videos: [localVideo] }, { _id: 'local-list', playlistName: 'Local', videos: [] }] } },
    dispatch: async (action, value) => {
      const { playlists } = store.state.playlists
      if (action === 'addPlaylist') playlists.push(value)
      else if (action === 'updatePlaylistFromSync') playlists.splice(playlists.findIndex(item => item._id === value.playlist._id), 1, value.playlist)
      else if (action === 'removePlaylist') playlists.splice(playlists.findIndex(item => item._id === value), 1)
      else assert.fail(action)
      return true
    },
  }
  const remote = createEmptySyncDocument()
  remote.playlists = [
    { playlist: { id: 'shared', title: 'Shared', description: '' }, videos: [remoteVideo] },
    { playlist: { id: 'remote-list', title: 'Remote', description: '' }, videos: [] },
  ]
  const uploaded = await syncAgainAfterConflict('syncPlaylists', store, remote, document => {
    document.playlists = [{ playlist: { id: 'shared', title: 'Shared', description: '' }, videos: [] }]
  })
  const contents = playlists => Object.fromEntries(Array.from(playlists, ({ id, videos }) => [id, Array.from(videos, video => video.id)]))
  assert.deepEqual(contents(uploaded.playlists.map(entry => ({ id: entry.playlist.id, videos: entry.videos }))), { shared: ['local-video'], 'local-list': [] })
  assert.deepEqual(contents(store.state.playlists.playlists.map(item => ({ id: item._id, videos: item.videos.map(video => ({ id: video.videoId })) }))),
    { shared: ['local-video'], 'local-list': [] })
})

test('after an upload conflict, profiles and channels removed on the server stay removed, and unsubscribed ones stay', async () => {
  const subscriptions = [{ id: 'local-channel', name: 'Local' }, { id: 'remote-channel', name: 'Remote' }]
  const store = {
    state: {
      profiles: {
        profileList: [
          { _id: MAIN_PROFILE_ID, subscriptions },
          { _id: 'shared', name: 'Shared', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [subscriptions[0]] },
          { _id: 'local-profile', name: 'Local', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] },
        ],
      },
    },
    dispatch: async (action, value) => {
      const { profileList } = store.state.profiles
      const index = profileList.findIndex(item => item._id === (value.profile?._id ?? value))
      if (action === 'saveSyncedProfile') profileList.splice(index === -1 ? profileList.length : index, index === -1 ? 0 : 1, value.profile)
      else if (action === 'removeProfile') profileList.splice(index, 1)
      else assert.fail(action)
      return true
    },
  }
  const group = (id, title) => ({ id, local_id: id, title, bg_color: '#000000', text_color: '#FFFFFF' })
  const remote = createEmptySyncDocument()
  remote.profiles = [
    // This device is not subscribed to the other device's channel.
    { group: group('shared', 'Shared'), channels: [{ id: 'remote-channel' }, { id: 'unsubscribed-channel' }] },
    { group: group('remote-profile', 'Remote'), channels: [] },
  ]
  const uploaded = await syncAgainAfterConflict('syncProfiles', store, remote, document => {
    document.profiles = [{ group: group('shared', 'Shared'), channels: [{ id: 'unsubscribed-channel' }] }]
  })
  assert.deepEqual(Object.fromEntries(uploaded.profiles.map(entry => [entry.group.id, entry.channels.map(item => item.id).sort()])),
    { shared: ['local-channel', 'unsubscribed-channel'], 'local-profile': [] })
  assert.deepEqual(Object.fromEntries(structuredClone(store.state.profiles.profileList.slice(1)).map(item => [item._id, item.subscriptions.map(item => item.id)])),
    { shared: ['local-channel'], 'local-profile': [] })
})

test('after an upload conflict, history removed on the server stays removed', async () => {
  const store = {
    state: { history: { historyCacheSorted: [{ videoId: 'local-video', title: 'Local', authorId: 'channel-1', timeWatched: 1, watchProgress: 0 }] } },
    dispatch: async (action, { insertions, updates, deletions }) => {
      assert.equal(action, 'applyHistorySyncChanges')
      const ids = new Set([...deletions, ...updates.map(item => item.videoId)])
      store.state.history.historyCacheSorted = [...store.state.history.historyCacheSorted.filter(item => !ids.has(item.videoId)), ...updates, ...insertions]
    },
  }
  const entry = id => ({
    video: { id, title: id, uploader: { id: 'channel-1', name: 'A channel' }, upload_date: 0, duration: 0 },
    metadata: { added_date: 2, watched_state: 'watching', position_millis: 1000 },
  })
  const remote = createEmptySyncDocument()
  remote.history = [entry('kept-video'), entry('remote-video')]
  const uploaded = await syncAgainAfterConflict('syncHistory', store, remote, document => { document.history = [entry('kept-video')] })
  assert.deepEqual(uploaded.history.map(entry => entry.video.id).sort(), ['kept-video', 'local-video'])
  assert.deepEqual(store.state.history.historyCacheSorted.map(item => item.videoId).sort(), ['kept-video', 'local-video'])
})
