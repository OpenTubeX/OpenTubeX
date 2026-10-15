import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeSqliteDriver } from '../../src/datastores/sqliteNode.js'

// Stand-ins for the shipped record storage and the LibraryDatabase plugin,
// which sqliteBrowser.js loads with require() in Capacitor builds.
const legacyFiles = {
  'playlists.db': [
    JSON.stringify({ _id: 'p', playlistName: 'Legacy', videos: [{ videoId: 'a', playlistItemId: '1' }] }),
    JSON.stringify({ _id: 'gone', playlistName: 'Deleted', videos: [] }),
    JSON.stringify({ $$deleted: true, _id: 'gone' }),
  ].join('\n'),
}
const drivers = new Map()
const driver = name => {
  if (!drivers.has(name)) drivers.set(name, createNodeSqliteDriver(':memory:'))
  return drivers.get(name)
}
const modules = {
  './androidStorage.js': { readFileAsync: async filename => legacyFiles[filename] ?? '' },
  '@capacitor/core': {
    registerPlugin: () => ({
      execute: async ({ name, statements, transaction }) => ({
        // Values cross the bridge as JSON.
        results: JSON.parse(JSON.stringify(await driver(name).execute(JSON.parse(JSON.stringify(statements)), transaction)))
      }),
      drop: async ({ name }) => drivers.get(name)?.drop(),
    }),
  },
}
process.env.IS_CAPACITOR = 'true'
globalThis.require = name => modules[name]
const { createBrowserDatastore } = await import('../../src/datastores/sqliteBrowser.js')
delete globalThis.require

test('Capacitor builds import the legacy datastore from the shipped record storage', async () => {
  const playlists = createBrowserDatastore('playlists', { childField: 'videos' })
  assert.deepEqual(await playlists.findAsync({}), [{ _id: 'p', playlistName: 'Legacy', videos: [{ videoId: 'a', playlistItemId: '1' }] }])
  await playlists.updateAsync({ _id: 'p' }, { $push: { videos: { videoId: 'b', playlistItemId: '2' } } })
  assert.deepEqual((await playlists.findOneAsync({ _id: 'p' })).videos.map(video => video.videoId), ['a', 'b'])
})
