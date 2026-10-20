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
// Large reads are written to result files and fetched from the local server.
const resultFiles = new Map()
let nextResult = 0
globalThis.fetch = async url => {
  const contents = resultFiles.get(url.replace('https://localhost/_capacitor_file_', ''))
  return contents === undefined
    ? { ok: false, status: 404 }
    : { ok: true, status: 200, json: async () => JSON.parse(contents) }
}
const modules = {
  './androidStorage.js': { readFileAsync: async filename => legacyFiles[filename] ?? '' },
  '@capacitor/core': {
    Capacitor: { convertFileSrc: path => `https://localhost/_capacitor_file_${path}` },
    registerPlugin: () => ({
      query: async ({ name, sql, params }) => {
        const path = `/cache/library-results/${nextResult++}.json`
        resultFiles.set(path, JSON.stringify((await driver(name).execute([[sql, JSON.parse(JSON.stringify(params))]]))[0]))
        return { path }
      },
      release: async ({ path }) => { resultFiles.delete(path) },
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

test('Capacitor loads whole datastores through result files and releases them', async () => {
  const history = createBrowserDatastore('history-results')
  await history.insertAsync([{ _id: 'a', title: 'Line\nbreak "quoted"' }, { _id: 'b', watched: 3 }])
  const before = nextResult
  assert.deepEqual(await history.findAsync({}).sort({ _id: 1 }), [
    { _id: 'a', title: 'Line\nbreak "quoted"' },
    { _id: 'b', watched: 3 },
  ])
  assert.equal(nextResult, before + 1)
  // Released asynchronously after reading.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resultFiles.size, 0)
})
