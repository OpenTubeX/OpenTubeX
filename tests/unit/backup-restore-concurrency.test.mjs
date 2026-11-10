import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { PlaylistVideoAddResult } from '../../src/constants.js'
import { SqliteDatastore } from '../../src/datastores/sqlite.js'
import { createNodeSqliteDriver } from '../../src/datastores/sqliteNode.js'
import { processToBeAddedPlaylistVideo } from '../../src/renderer/helpers/playlists.js'
import { mergeBackupPlaylist, mergeBackupProfile } from '../../src/renderer/helpers/unifiedBackup.js'
import { decrementPlaylistVideoCounts, incrementPlaylistVideoCounts } from '../../src/renderer/helpers/playlist-video-counts.js'
import { toRaw } from 'vue'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const handlerSource = source.slice(source.indexOf('async function saveRestoredRecord('), source.indexOf('\nclass SearchHistory {'))
const storeSource = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const mutations = vm.runInNewContext(storeSource.slice(storeSource.indexOf('const mutations ='), storeSource.indexOf('\nexport default')) + '\nmutations', { decrementPlaylistVideoCounts, incrementPlaylistVideoCounts, toRaw })
const mergeActionSource = storeSource.slice(storeSource.indexOf('  async mergePlaylistBackup('), storeSource.indexOf('  async updatePlaylistFromSync('))

async function fixture(t) {
  const store = options => {
    const driver = createNodeSqliteDriver(':memory:')
    t.after(() => driver.close())
    return new SqliteDatastore({ ...options, driver })
  }
  const db = { profiles: store(), playlists: store({ childField: 'videos' }) }
  await Promise.all([db.profiles.loadDatabaseAsync(), db.playlists.loadDatabaseAsync()])
  const handlers = vm.runInNewContext(handlerSource + '\n({ Profiles, Playlists })', {
    db,
    mergeBackupPlaylist,
    mergeBackupProfile,
    processToBeAddedPlaylistVideo,
    PlaylistVideoAddResult,
    crypto,
    console,
  })
  return { db, ...handlers }
}

/** Runs `edit`, as another window would, right after the restore first reads `datastore`. */
function editAfterFirstRead(datastore, edit) {
  let pending = edit
  for (const name of ['findAsync', 'findOneAsync']) {
    const read = datastore[name].bind(datastore)
    datastore[name] = async (...args) => {
      const result = await read(...args)
      if (pending) {
        const run = pending
        pending = null
        await run()
      }
      return result
    }
  }
}

test('restoring profiles keeps subscriptions another window adds meanwhile', async (t) => {
  const { db, Profiles } = await fixture(t)
  await db.profiles.insertAsync({ _id: 'allChannels', name: null, subscriptions: [{ id: 'saved' }] })
  editAfterFirstRead(db.profiles, () => Profiles.addChannelToProfiles({ id: 'added-meanwhile' }, ['allChannels']))

  await Profiles.mergeBackup({ _id: 'allChannels', name: null, subscriptions: [{ id: 'restored' }] })

  const stored = await db.profiles.findOneAsync({ _id: 'allChannels' })
  assert.deepEqual(stored.subscriptions.map(channel => channel.id), ['saved', 'added-meanwhile', 'restored'])
})

test('restoring playlists keeps videos another window adds meanwhile', async (t) => {
  const { db, Playlists } = await fixture(t)
  await db.playlists.insertAsync({ _id: 'list', playlistName: 'List', lastUpdatedAt: 1, videos: [{ videoId: 'saved', playlistItemId: 'saved-item', timeAdded: 1 }] })
  editAfterFirstRead(db.playlists, () => Playlists.upsertVideoByPlaylistId('list', 5, { videoId: 'added-meanwhile', playlistItemId: 'added-item', timeAdded: 2 }))

  const restored = { _id: 'list', playlistName: 'List', lastUpdatedAt: 3, videos: [{ videoId: 'restored', timeAdded: 3 }] }
  const saved = await Playlists.mergeBackup(restored)

  const stored = await db.playlists.findOneAsync({ _id: 'list' })
  assert.deepEqual(stored.videos.map(video => video.videoId), ['saved', 'added-meanwhile', 'restored'])
  assert.equal(stored.lastUpdatedAt, 5, 'the restore started before the other edit')
  assert.deepEqual(JSON.parse(JSON.stringify(saved.videos)), stored.videos)
  // Restored entries need a playlistItemId for reordering, without changing the backup itself
  assert.equal(typeof stored.videos[2].playlistItemId, 'string')
  assert.equal(restored.videos[0].playlistItemId, undefined)
})

test('restoring playlists creates missing ones and fills empty ones', async (t) => {
  const { db, Playlists } = await fixture(t)
  await db.playlists.insertAsync({ _id: 'empty', playlistName: 'Empty', createdAt: 1, lastUpdatedAt: 1, videos: [] })

  await Playlists.mergeBackup({ _id: 'empty', playlistName: 'Empty', lastUpdatedAt: 2, videos: [{ videoId: 'a', timeAdded: 2 }] })
  await Playlists.mergeBackup({ _id: 'new', playlistName: 'New', lastUpdatedAt: 3, videos: [{ videoId: 'b', timeAdded: 3 }] })

  const stored = new Map((await db.playlists.findAsync({})).map(playlist => [playlist._id, playlist]))
  assert.deepEqual(stored.get('empty').videos.map(video => video.videoId), ['a'])
  assert.equal(stored.get('empty').createdAt, 1)
  assert.deepEqual(stored.get('new').videos.map(video => video.videoId), ['b'])
  assert.equal(stored.get('new').createdAt, 3)
})

test('restoring several playlists shows each one saved before another window syncs a later edit', async (t) => {
  const { db, Playlists } = await fixture(t)
  const playlist = (_id, videoId) => ({ _id, playlistName: _id, lastUpdatedAt: 1, videos: [{ videoId, playlistItemId: `${videoId}-item`, timeAdded: 1 }] })
  await db.playlists.insertAsync([playlist('a', 'saved-a'), playlist('b', 'saved-b')])
  const state = { playlists: await db.playlists.findAsync({}), playlistVideoCounts: new Map() }
  const commit = (name, payload) => mutations[name](state, payload)
  // Once playlist A is restored, another window adds a video to it and this window applies the sync
  const read = db.playlists.findOneAsync.bind(db.playlists)
  let pending = true
  db.playlists.findOneAsync = async (query, ...args) => {
    if (pending && query._id === 'b') {
      pending = false
      const videoData = { videoId: 'added-meanwhile', playlistItemId: 'added-item', timeAdded: 2 }
      commit('addVideo', { _id: 'a', ...await Playlists.upsertVideoByPlaylistId('a', 2, videoData), videoData })
    }
    return read(query, ...args)
  }
  const { mergePlaylistBackup } = vm.runInNewContext(`({ ${mergeActionSource} })`, { DBPlaylistHandlers: Playlists, console })

  assert.equal(await mergePlaylistBackup({ commit }, [playlist('a', 'restored-a'), playlist('b', 'restored-b')]), true)

  const shown = state.playlists.find(item => item._id === 'a')
  assert.deepEqual(Array.from(shown.videos, video => video.videoId), ['saved-a', 'restored-a', 'added-meanwhile'])
  assert.deepEqual(JSON.parse(JSON.stringify(shown.videos)), (await db.playlists.findOneAsync({ _id: 'a' })).videos)
})
