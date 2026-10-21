import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { DBActions, IpcChannels, PlaylistVideoAddResult, SyncEvents } from '../../src/constants.js'
import { incrementPlaylistVideoCounts } from '../../src/renderer/helpers/playlist-video-counts.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const mutations = vm.runInNewContext(storeSource.slice(storeSource.indexOf('const mutations ='), storeSource.indexOf('\nexport default')) + '\nmutations', { incrementPlaylistVideoCounts })
const componentSource = await readFile(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
const refreshSource = componentSource.slice(componentSource.indexOf('async function addMissingVideos()'), componentSource.indexOf('async function savePlaylistInfo()'))
const mainSource = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')
const bulkIpcSource = mainSource.slice(mainSource.indexOf('        case DBActions.PLAYLISTS.UPSERT_VIDEOS:'), mainSource.indexOf('        case DBActions.GENERAL.DELETE:', mainSource.indexOf('        case DBActions.PLAYLISTS.UPSERT_VIDEOS:')))
const bulkActionSource = storeSource.slice(storeSource.indexOf('  async addVideos({ commit }'), storeSource.indexOf('  async grabAllPlaylists('))
const singleActionSource = storeSource.slice(storeSource.indexOf('  addVideo({ commit }'), storeSource.indexOf('  async addVideos({ commit }'))
const promptSource = await readFile(new URL('../../src/renderer/components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue', import.meta.url), 'utf8')
const promptSaveSource = promptSource.slice(promptSource.search(/(?:async )?function addSelectedToPlaylists\(/), promptSource.indexOf("/** @type {import('vue').ComputedRef<object>} */\nconst newPlaylistDefaultProperties"))

function storeActions(handlers) {
  return vm.runInNewContext(`({ ${singleActionSource} ${bulkActionSource} })`, {
    DBPlaylistHandlers: handlers, PlaylistVideoAddResult,
    pendingVideoAdds: new Map(),
    generateRandomUniqueId: () => crypto.randomUUID(),
    processToBeAddedPlaylistVideo: () => {},
    removeUndesiredVideoAttributes: () => {},
    console,
  })
}

async function fixture(addVideosToTop) {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  const Playlists = vm.runInNewContext(source.slice(source.indexOf('class Playlists {'), source.indexOf('\nclass SearchHistory {')) + '\nPlaylists', { db, PlaylistVideoAddResult })
  const playlist = { _id: 'custom', videos: [{ videoId: 'first' }, { videoId: 'second' }], ...(addVideosToTop === undefined ? {} : { addVideosToTop }) }
  await db.playlists.insertAsync(playlist)
  return { db, Playlists, state: { playlists: [playlist], playlistVideoCounts: new Map([['first', 1], ['second', 1]]) } }
}

for (const preference of [undefined, false, true]) {
  test(`single and bulk additions respect per-playlist insertion preference ${preference}`, async () => {
    const { db, Playlists, state } = await fixture(preference)
    const videoData = { videoId: 'single' }
    const single = await Playlists.upsertVideoByPlaylistId('custom', 10, videoData)
    assert.equal(single.status, PlaylistVideoAddResult.ADDED)
    mutations.addVideo(state, { _id: 'custom', ...single, videoData })
    const expected = preference ? ['single', 'first', 'second'] : ['first', 'second', 'single']
    assert.deepEqual(Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, v => v.videoId), expected)
    assert.deepEqual(Array.from(state.playlists[0].videos, v => v.videoId), expected)

    const videos = [{ videoId: 'batch-a' }, { videoId: 'batch-b' }]
    const bulk = await Playlists.upsertVideosByPlaylistId('custom', 20, videos)
    mutations.addVideos(state, { _id: 'custom', ...bulk })
    const all = preference ? ['batch-a', 'batch-b', ...expected] : [...expected, 'batch-a', 'batch-b']
    const saved = await db.playlists.findOneAsync({ _id: 'custom' })
    assert.deepEqual(Array.from(saved.videos, v => v.videoId), all)
    assert.deepEqual(Array.from(state.playlists[0].videos, v => v.videoId), all)
    assert.equal(saved.lastUpdatedAt, 20)
    assert.equal(state.playlists[0].lastUpdatedAt, 20)
    assert.equal(state.playlistVideoCounts.get('batch-a'), 1)
    assert.equal(state.playlistVideoCounts.get('single'), 1)
  })
}

test('top insertion still deduplicates simultaneous single-video adds and never recreates a deleted playlist', async () => {
  const { db, Playlists } = await fixture(true)
  const results = await Promise.all(Array.from({ length: 3 }, () => Playlists.upsertVideoByPlaylistId('custom', 10, { videoId: 'new' })))
  assert.equal(results.filter(result => result.status === PlaylistVideoAddResult.ADDED).length, 1)
  assert.equal(results.filter(result => result.status === PlaylistVideoAddResult.ALREADY_PRESENT).length, 2)
  assert.deepEqual(Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, v => v.videoId), ['new', 'first', 'second'])
  await db.playlists.removeAsync({ _id: 'custom' })
  assert.equal((await Playlists.upsertVideoByPlaylistId('custom', 20, { videoId: 'missing' })).status, PlaylistVideoAddResult.PLAYLIST_MISSING)
  assert.equal(await db.playlists.findOneAsync({ _id: 'custom' }), null)
})

test('retries after concurrent removal and preference changes without restoring removed videos', async () => {
  const { db, Playlists } = await fixture(true)
  const update = db.playlists.updateAsync.bind(db.playlists)
  let intercepted = false
  db.playlists.updateAsync = async (query, changes, options) => {
    if (!intercepted && query.$where) {
      intercepted = true
      await update({ _id: 'custom' }, { $pull: { videos: { videoId: 'first' } }, $set: { addVideosToTop: false, playlistName: 'Renamed' } })
    }
    return update(query, changes, options)
  }
  await Playlists.upsertVideosByPlaylistId('custom', 30, [{ videoId: 'batch-a' }, { videoId: 'batch-b' }])
  const saved = await db.playlists.findOneAsync({ _id: 'custom' })
  assert.deepEqual(Array.from(saved.videos, v => v.videoId), ['second', 'batch-a', 'batch-b'])
  assert.equal(saved.playlistName, 'Renamed')
  assert.equal(saved.addVideosToTop, false)
})

test('a concurrent edit that keeps the video count is detected by its timestamp', async () => {
  const { db, Playlists } = await fixture(false)
  const update = db.playlists.updateAsync.bind(db.playlists)
  let intercepted = false
  db.playlists.updateAsync = async (query, changes, options) => {
    if (!intercepted && query.$where) {
      intercepted = true
      await update({ _id: 'custom' }, { $set: { videos: [{ videoId: 'second' }, { videoId: 'first' }], lastUpdatedAt: 15 } })
    }
    return update(query, changes, options)
  }
  await Playlists.upsertVideoByPlaylistId('custom', 20, { videoId: 'new' })
  const saved = await db.playlists.findOneAsync({ _id: 'custom' })
  assert.deepEqual(Array.from(saved.videos, v => v.videoId), ['second', 'first', 'new'])
  assert.equal(saved.lastUpdatedAt, 20)
})

test('simultaneous bulk and single additions preserve every entry', async () => {
  const { db, Playlists } = await fixture(true)
  await Promise.all([
    Playlists.upsertVideosByPlaylistId('custom', 10, [{ videoId: 'batch-a' }, { videoId: 'batch-b' }]),
    Playlists.upsertVideoByPlaylistId('custom', 20, { videoId: 'single' }),
  ])
  const saved = await db.playlists.findOneAsync({ _id: 'custom' })
  const ids = Array.from(saved.videos, v => v.videoId)
  assert.deepEqual(ids.slice(-2), ['first', 'second'])
  assert.deepEqual(ids.slice(0, 3).sort(), ['batch-a', 'batch-b', 'single'])
  assert.equal(ids.indexOf('batch-b'), ids.indexOf('batch-a') + 1)
})

for (const preference of [false, true]) {
  test(`source refresh preserves missing videos in source order with top insertion ${preference}`, async () => {
    const { db, Playlists, state } = await fixture(preference)
    const playlist = state.playlists[0]
    const sourceVideos = [{ videoId: 'first' }, { videoId: 'source-a' }, { videoId: 'source-b' }, { videoId: 'source-a' }]
    const actions = storeActions(Playlists)
    let firstSave = true
    const refresh = vm.runInNewContext(refreshSource + '\naddMissingVideos', {
      props: { id: 'custom' },
      selectedUserPlaylist: { value: { sourcePlaylistId: 'source' } },
      snapshotPending: { value: false },
      snapshotController: new AbortController(),
      loadSnapshot: async () => ({ videos: sourceVideos }),
      store: {
        getters: { getPlaylist: () => playlist },
        dispatch: async (action, payload) => {
          const saved = await actions[action]({ commit: (name, data) => mutations[name](state, data) }, payload)
          if (preference && firstSave) {
            firstSave = false
            await db.playlists.updateAsync({ _id: 'custom' }, { $set: { addVideosToTop: false } })
            playlist.addVideosToTop = false
          }
          return saved
        },
      },
      t: value => value,
      showToast: () => {},
      console,
    })
    await refresh()
    const expected = preference ? ['source-a', 'source-b', 'first', 'second'] : ['first', 'second', 'source-a', 'source-b']
    assert.deepEqual(Array.from(playlist.videos, video => video.videoId), expected)
    assert.deepEqual(Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, video => video.videoId), expected)
    assert.deepEqual(sourceVideos.map(video => video.videoId), ['first', 'source-a', 'source-b', 'source-a'])
  })
}

test('more than five simultaneous additions all persist without losing entries', async () => {
  const { db, Playlists } = await fixture(true)
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
    Playlists.upsertVideoByPlaylistId('custom', 30, { videoId: `concurrent-${index}` })))
  assert.equal(results.filter(result => result.status === 'rejected').length, 0)
  assert.ok(results.every(result => result.value.status === PlaylistVideoAddResult.ADDED))
  assert.equal((await db.playlists.findOneAsync({ _id: 'custom' })).videos.length, 14)
})

test('bulk IPC reports a missing playlist without broadcasting unpersisted additions', async () => {
  const { db, Playlists } = await fixture(true)
  const broadcasts = []
  const handle = vm.runInNewContext(`(async (data) => { switch (${DBActions.PLAYLISTS.UPSERT_VIDEOS}) { ${bulkIpcSource} } })`, {
    DBActions, IpcChannels, SyncEvents, PlaylistVideoAddResult,
    baseHandlers: { playlists: Playlists },
    syncOtherWindows: (...args) => broadcasts.push(args),
    event: {},
  })
  await db.playlists.removeAsync({ _id: 'custom' })
  assert.equal((await handle({ _id: 'custom', lastUpdatedAt: 30, videos: [{ videoId: 'missing' }] })).status, PlaylistVideoAddResult.PLAYLIST_MISSING)
  assert.equal(broadcasts.length, 0)
})

test('bulk IPC broadcasts the committed direction and only the entries actually inserted', async () => {
  const { db, Playlists, state } = await fixture(true)
  const broadcasts = []
  const handle = vm.runInNewContext(`(async (data) => { switch (${DBActions.PLAYLISTS.UPSERT_VIDEOS}) { ${bulkIpcSource} } })`, {
    DBActions, IpcChannels, SyncEvents, PlaylistVideoAddResult,
    baseHandlers: { playlists: Playlists },
    syncOtherWindows: (...args) => broadcasts.push(args),
    event: {},
  })
  await handle({ _id: 'custom', lastUpdatedAt: 30, deduplicate: true, videos: [{ videoId: 'first' }, { videoId: 'new' }, { videoId: 'new' }] })
  assert.equal(broadcasts.length, 1)
  const payload = broadcasts[0][2].data
  assert.equal(payload.addVideosToTop, true)
  assert.deepEqual(Array.from(payload.videos, video => video.videoId), ['new'])
  state.playlists[0].addVideosToTop = false
  mutations.addVideos(state, payload)
  assert.deepEqual(Array.from(state.playlists[0].videos, video => video.videoId), Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, video => video.videoId))
})

test('bulk store action never commits additions rejected by the datastore', async () => {
  const { db, Playlists } = await fixture(true)
  await db.playlists.removeAsync({ _id: 'custom' })
  const commits = []
  const action = vm.runInNewContext(`({ ${bulkActionSource} }).addVideos`, {
    DBPlaylistHandlers: Playlists, PlaylistVideoAddResult,
    generateRandomUniqueId: () => 'new-item',
    removeUndesiredVideoAttributes: () => {},
    console,
  })
  const saved = await action({ commit: (...args) => commits.push(args) }, { _id: 'custom', videos: [{ videoId: 'missing' }] })
  assert.equal(saved, false)
  assert.equal(commits.length, 0)
})

test('the bulk prompt waits for writes and reports failure without a success toast', async () => {
  let finishWrite
  const pendingWrite = new Promise(resolve => { finishWrite = resolve })
  const toasts = []
  const saving = { value: false }
  let writes = 0
  const save = vm.runInNewContext(promptSaveSource + '\naddSelectedToPlaylists', {
    saving,
    selectedPlaylistIdList: { value: ['custom'] },
    allPlaylists: { value: [{ _id: 'custom', playlistName: 'Weekend watching', videos: [] }] },
    toBeAddedToPlaylistVideoList: { value: [{ videoId: 'new' }, { videoId: 'other' }] },
    addingDuplicateVideosEnabled: { value: false },
    store: { dispatch: () => { writes++; return pendingWrite } },
    showToast: toast => toasts.push(toast),
    t: value => value,
    hide: () => {},
  })
  const pending = save()
  assert.equal(toasts.length, 0)
  assert.equal(saving.value, true)
  await save()
  assert.equal(writes, 1, 'repeated Save activation must not duplicate an in-flight batch')
  finishWrite(false)
  await pending
  assert.equal(saving.value, false)
  assert.equal(toasts.length, 1)
  assert.ok(toasts[0].message.includes('There was an issue with updating this playlist.'))
  assert.ok(toasts[0].message.startsWith('Weekend watching: '))
})

test('a playlist missing before save gets a generic error without exposing its ID', async () => {
  const toasts = []
  const errorMessage = 'There was an issue with updating this playlist.'
  const save = vm.runInNewContext(promptSaveSource + '\naddSelectedToPlaylists', {
    saving: { value: false },
    selectedPlaylistIdList: { value: ['missing-playlist-id'] },
    allPlaylists: { value: [] },
    toBeAddedToPlaylistVideoList: { value: [{ videoId: 'new' }, { videoId: 'other' }] },
    addingDuplicateVideosEnabled: { value: false },
    store: { dispatch: () => assert.fail('A missing playlist must not be written') },
    showToast: toast => toasts.push(toast),
    t: () => errorMessage,
    hide: () => {},
  })
  await save()
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].message, errorMessage)
})

test('renderer insertion uses the committed direction when the preference changes before the reply', async () => {
  const { db, Playlists, state } = await fixture(true)
  const actions = storeActions({
    upsertVideoByPlaylistId: async (...args) => {
      const result = await Playlists.upsertVideoByPlaylistId(...args)
      state.playlists[0].addVideosToTop = false
      return result
    },
  })
  await actions.addVideo({ commit: (name, payload) => mutations[name](state, payload) }, { _id: 'custom', videoData: { videoId: 'new' } })
  assert.deepEqual(Array.from(state.playlists[0].videos, video => video.videoId), Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, video => video.videoId))
})

test('partial bulk failure names the failed playlist and counts only the successful target', async () => {
  const toasts = []
  const save = vm.runInNewContext(promptSaveSource + '\naddSelectedToPlaylists', {
    saving: { value: false },
    selectedPlaylistIdList: { value: ['saved', 'failed'] },
    allPlaylists: { value: [{ _id: 'saved', playlistName: 'Saved playlist', videos: [] }, { _id: 'failed', playlistName: 'Failed playlist', videos: [] }] },
    toBeAddedToPlaylistVideoList: { value: [{ videoId: 'new' }, { videoId: 'other' }] },
    addingDuplicateVideosEnabled: { value: false },
    store: { dispatch: async (_action, payload) => payload._id === 'saved' },
    showToast: toast => toasts.push(toast),
    t: (key, params) => params ? `Saved to ${params.playlistCount}` : key,
    hide: () => {},
  })
  await save()
  assert.equal(toasts.length, 2)
  assert.equal(toasts[0].message, 'Saved to 1')
  assert.ok(toasts[1].message.startsWith('Failed playlist: '))
})

for (const allowDuplicates of [false, true]) {
  test(`bulk saves keep duplicate policy ${allowDuplicates} after it changes while saving`, async () => {
    const toggle = { value: allowDuplicates }
    const writes = []
    const toasts = []
    const save = vm.runInNewContext(promptSaveSource + '\naddSelectedToPlaylists', {
      saving: { value: false },
      selectedPlaylistIdList: { value: ['first', 'second'] },
      allPlaylists: { value: ['first', 'second'].map(_id => ({ _id, videos: [{ videoId: 'existing' }] })) },
      toBeAddedToPlaylistVideoList: { value: [{ videoId: 'existing' }, { videoId: 'new' }] },
      addingDuplicateVideosEnabled: toggle,
      store: { dispatch: async (_action, payload) => { writes.push(payload); toggle.value = !allowDuplicates; return true } },
      showToast: toast => toasts.push(toast),
      t: (_key, params) => `Saved to ${params.playlistCount}`,
      hide: () => {},
    })
    await save()
    assert.equal(writes.length, 2)
    for (const payload of writes) {
      assert.deepEqual(Array.from(payload.videos, video => video.videoId), allowDuplicates ? ['existing', 'new'] : ['new'])
    }
    assert.equal(toasts[0].message, 'Saved to 2')
  })
}

test('a bulk save skips empty filtered batches without reporting an addition', async () => {
  const toasts = []
  const save = vm.runInNewContext(promptSaveSource + '\naddSelectedToPlaylists', {
    saving: { value: false },
    selectedPlaylistIdList: { value: ['custom'] },
    allPlaylists: { value: [{ _id: 'custom', videos: [{ videoId: 'existing' }] }] },
    toBeAddedToPlaylistVideoList: { value: [{ videoId: 'existing' }, { videoId: 'existing' }] },
    addingDuplicateVideosEnabled: { value: false },
    store: { dispatch: () => assert.fail('An empty batch must not be written') },
    showToast: toast => toasts.push(toast),
    t: key => key,
    hide: () => {},
  })
  await save()
  assert.deepEqual(toasts, [])
})

test('an insertion retry does not overwrite a newer playlist timestamp', async () => {
  const { db, Playlists } = await fixture(true)
  const update = db.playlists.updateAsync.bind(db.playlists)
  let intercepted = false
  db.playlists.updateAsync = async (query, changes, options) => {
    if (!intercepted && query.$where) {
      intercepted = true
      await update({ _id: 'custom' }, { $set: { lastUpdatedAt: 100 } })
    }
    return update(query, changes, options)
  }
  await Playlists.upsertVideoByPlaylistId('custom', 30, { videoId: 'new' })
  assert.equal((await db.playlists.findOneAsync({ _id: 'custom' })).lastUpdatedAt, 100)
})
