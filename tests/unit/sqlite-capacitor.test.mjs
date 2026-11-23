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
  'settings.db': [
    JSON.stringify({ _id: 'proxyPassword', value: 'proxy-secret' }),
    JSON.stringify({ _id: 'theme', value: 'dark' }),
  ].join('\n'),
}
const removals = []
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
  './androidStorage.js': {
    readFileAsync: async filename => legacyFiles[filename] ?? '',
    // The WebView copy Android imported from, which can still hold secrets the records no longer have
    readRetainedAsync: async filename => filename === 'settings.db' ? JSON.stringify({ _id: 'syncServerToken', value: 'retained-secret' }) : '',
    removeDocumentsAsync: async (filename, ids) => { removals.push({ filename, ids }) },
  },
  '@capacitor/core': {
    Capacitor: { convertFileSrc: path => `https://localhost/_capacitor_file_${path}` },
    registerPlugin: () => ({
      query: async ({ name, sql, params, documentColumn }) => {
        const path = `/cache/library-results/${nextResult++}.json`
        const rows = (await driver(name).execute([[sql, JSON.parse(JSON.stringify(params))]]))[0]
        // Like the plugin, objects and arrays without NeDB dates are written as their JSON.
        resultFiles.set(path, `[${rows.map(row => `[${row.map((value, column) => (
          column === documentColumn && typeof value === 'string' && /^[[{]/.test(value) && !value.includes('"$$date"') ? value : JSON.stringify(value)
        )).join(',')}]`).join(',')}]`)
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
  await history.insertAsync([{ _id: 'a', title: 'Line\nbreak "quoted"' }, { _id: 'b', watched: 3 }, { _id: 'c', at: new Date(5) }])
  const before = nextResult
  assert.deepEqual(await history.findAsync({}).sort({ _id: 1 }), [
    { _id: 'a', title: 'Line\nbreak "quoted"' },
    { _id: 'b', watched: 3 },
    { _id: 'c', at: new Date(5) },
  ])
  assert.equal(nextResult, before + 1)
  const members = createBrowserDatastore('members-results', { childField: 'videos' })
  await members.insertAsync({ _id: 'm', videos: ['text', '123', 4, { videoId: 'a' }] })
  assert.deepEqual(await members.findAsync({}), [{ _id: 'm', videos: ['text', '123', 4, { videoId: 'a' }] }])
  // Released asynchronously after reading.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resultFiles.size, 0)
})

test('Capacitor builds remove secrets from the record storage and the WebView copy it was imported from', async () => {
  const settings = createBrowserDatastore('settings')
  assert.equal((await settings.findOneAsync({ _id: 'proxyPassword' })).value, 'proxy-secret')
  await settings.removeOlderCopiesAsync("json_extract(data, '$._id') IN (SELECT value FROM json_each(?))", [JSON.stringify(['proxyPassword', 'syncServerToken'])])
  assert.deepEqual(removals, [{ filename: 'settings.db', ids: ['proxyPassword', 'syncServerToken'] }])
  assert.equal((await settings.findOneAsync({ _id: 'proxyPassword' })).value, 'proxy-secret', 'the library keeps it')
  // Android refuses to install an older version over this one, so nothing writes the record storage again.
  await settings.removeOlderCopiesAsync("json_extract(data, '$._id') IN (SELECT value FROM json_each(?))", [JSON.stringify(['proxyPassword', 'syncServerToken'])])
  assert.equal(removals.length, 1, 'later starts do not read it again')
})
