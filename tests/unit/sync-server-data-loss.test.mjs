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
    const store = { state: scenario.state, dispatch: () => assert.fail('Unexpected local change') }
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
  const store = {
    state: { playlists: { playlists: [local] } },
    dispatch: async (action, value) => {
      assert.equal(action, 'updatePlaylist')
      store.state.playlists.playlists = [value]
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
      dispatch: async (action, value) => { assert.equal(action, 'updatePlaylist'); saved = value },
    }, { [local._id]: { videos: [video.videoId] } })
    assert.equal(saved.videos.length, 1)
    assert.equal(saved.videos[0].playlistItemId, 'keep')
    assert.equal(saved.videos[0].authorId, video.authorId)
    assert.equal(saved.videos[0].title, 'Remote title')
    assert.equal(saved.videos[0].author, 'Remote channel')
    assert.equal(saved.videos[0].lengthSeconds, lengthSeconds, 'a title/uploader repair must not round a populated duration')
  })
}
