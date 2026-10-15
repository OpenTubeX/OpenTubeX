import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { PlaylistVideoAddResult } from '../../src/constants.js'
import { incrementPlaylistVideoCounts } from '../../src/renderer/helpers/playlist-video-counts.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const mutations = vm.runInNewContext(storeSource.slice(storeSource.indexOf('const mutations ='), storeSource.indexOf('\nexport default')) + '\nmutations', { incrementPlaylistVideoCounts })
const componentSource = await readFile(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
const refreshSource = componentSource.slice(componentSource.indexOf('async function addMissingVideos()'), componentSource.indexOf('async function savePlaylistInfo()'))

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
    assert.equal(await Playlists.upsertVideoByPlaylistId('custom', 10, videoData), PlaylistVideoAddResult.ADDED)
    mutations.addVideo(state, { _id: 'custom', lastUpdatedAt: 10, videoData })
    const expected = preference ? ['single', 'first', 'second'] : ['first', 'second', 'single']
    assert.deepEqual(Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, v => v.videoId), expected)
    assert.deepEqual(Array.from(state.playlists[0].videos, v => v.videoId), expected)

    const videos = [{ videoId: 'batch-a' }, { videoId: 'batch-b' }]
    await Playlists.upsertVideosByPlaylistId('custom', 20, videos)
    mutations.addVideos(state, { _id: 'custom', lastUpdatedAt: 20, videos })
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
  assert.equal(results.filter(result => result === PlaylistVideoAddResult.ADDED).length, 1)
  assert.equal(results.filter(result => result === PlaylistVideoAddResult.ALREADY_PRESENT).length, 2)
  assert.deepEqual(Array.from((await db.playlists.findOneAsync({ _id: 'custom' })).videos, v => v.videoId), ['new', 'first', 'second'])
  await db.playlists.removeAsync({ _id: 'custom' })
  assert.equal(await Playlists.upsertVideoByPlaylistId('custom', 20, { videoId: 'missing' }), PlaylistVideoAddResult.PLAYLIST_MISSING)
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
    const refresh = vm.runInNewContext(refreshSource + '\naddMissingVideos', {
      props: { id: 'custom' },
      selectedUserPlaylist: { value: { sourcePlaylistId: 'source' } },
      snapshotPending: { value: false },
      snapshotController: new AbortController(),
      loadSnapshot: async () => ({ videos: sourceVideos }),
      store: {
        getters: { getPlaylist: () => playlist },
        dispatch: async (_action, payload) => {
          const result = await Playlists.upsertVideoByPlaylistId(payload._id, 30, payload.videoData)
          if (result === PlaylistVideoAddResult.ADDED) mutations.addVideo(state, { ...payload, lastUpdatedAt: 30 })
          return result !== PlaylistVideoAddResult.PLAYLIST_MISSING
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
