import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import * as videoCounts from '../../src/renderer/helpers/playlist-video-counts.js'

const source = await readFile(new URL('../../src/renderer/store/modules/playlists.js', import.meta.url), 'utf8')
const handlers = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')

function playlist(_id, playlistName, protectedValue = false) {
  return {
    _id, playlistName, protected: protectedValue, createdAt: 1, lastUpdatedAt: 1,
    videos: [{ videoId: `${_id}-video`, playlistItemId: `${_id}-item`, timeAdded: 1, type: 'video' }],
  }
}

async function fixture(records) {
  const db = { playlists: new Datastore({ inMemoryOnly: true }) }
  await db.playlists.insertAsync(records)
  const DBPlaylistHandlers = vm.runInNewContext(
    handlers.slice(handlers.indexOf('class Playlists {'), handlers.indexOf('class SearchHistory {')) + '\nPlaylists', { db }
  )
  const errors = []
  // Observe detached writes too, so the test reports their errors as assertions.
  const pending = []
  for (const method of ['create', 'upsert', 'delete']) {
    const original = DBPlaylistHandlers[method].bind(DBPlaylistHandlers)
    DBPlaylistHandlers[method] = (...args) => {
      const result = original(...args).catch(error => { errors.push(error) })
      pending.push(result)
      return result
    }
  }
  const module = vm.runInNewContext(
    source.slice(source.indexOf('function generateRandomPlaylistId()')).replace('export default', 'globalThis.playlistsModule =') + '\nplaylistsModule',
    { DBPlaylistHandlers, ...videoCounts, console: { error: error => errors.push(error) } }
  )
  const context = {
    state: module.state,
    rootState: { settings: { quickBookmarkTargetPlaylistId: records[0]._id } },
    commit: (name, value) => module.mutations[name](module.state, value),
    dispatch: (name, value) => module.actions[name]?.(context, value),
  }
  return {
    db, module, errors, handlers: DBPlaylistHandlers,
    async load() {
      await module.actions.grabAllPlaylists(context)
      for (let i = 0; i < pending.length; i++) await pending[i]
    },
  }
}

for (const [id, name] of [['watchLater', 'Watch Later'], ['favorites', 'Favorites']]) {
  for (const existingDefault of [false, true]) {
    test(`loading preserves a custom ${name} playlist, default present: ${existingDefault}`, async () => {
      const records = [playlist('custom', name), playlist('other', 'Other')]
      if (existingDefault) records.push(playlist(id, `Renamed ${name}`))
      const { db, module, errors, load } = await fixture(records)
      for (let restart = 0; restart < 2; restart++) {
        await load()
        const saved = await db.playlists.findAsync({})
        assert.deepEqual(saved.sort((a, b) => a._id.localeCompare(b._id)), records.toSorted((a, b) => a._id.localeCompare(b._id)))
        assert.deepEqual(Array.from(module.state.playlists, p => p._id).sort(), records.map(p => p._id).sort())
        assert.equal(module.state.playlistsReady, true)
        assert.equal(errors.length, 0)
      }
    })
  }

  test(`loading still unlocks the renamed built-in ${name} playlist`, async () => {
    const { db, load } = await fixture([playlist(id, 'Renamed', true)])
    await load()
    assert.equal((await db.playlists.findOneAsync({ _id: id })).protected, false)
  })
}

test('a failed protection repair does not hide loaded playlists', async () => {
  const records = [playlist('watchLater', 'Watch Later', true), playlist('custom', 'My playlist')]
  const { module, errors, handlers, load } = await fixture(records)
  const failure = new Error('Storage temporarily unavailable')
  handlers.upsert = async () => { throw failure }

  await load()

  assert.equal(module.state.playlistsReady, true)
  assert.deepEqual(Array.from(module.state.playlists, p => p._id).sort(), ['custom', 'watchLater'])
  assert.deepEqual(errors, [failure])
})
