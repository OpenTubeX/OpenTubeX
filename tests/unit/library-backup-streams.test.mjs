import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { openLibrary } from '../../src/datastores/sqlite/migration.js'
import { LibraryExports } from '../../src/datastores/sqlite/export.js'
import { LibraryImports } from '../../src/datastores/sqlite/import.js'

// Load the real renderer helper, replacing only its IPC/store boundaries.
const helper = new URL('../../src/renderer/helpers/libraryBackup.js', import.meta.url).href
const handlers = { query: async () => { throw new Error('IPC fixture not initialized') } }
const store = { dispatch: async () => {} }
const picker = { showSaveFilePicker: async () => { throw new Error('Save picker fixture not initialized') } }
globalThis.window = picker
globalThis.__libraryBackupTest = { handlers, store }
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === helper) {
      if (specifier === '../../datastores/handlers/index') return { url: 'data:text/javascript,export const DBLibraryHandlers = globalThis.__libraryBackupTest.handlers', shortCircuit: true }
      if (specifier === '../store/index') return { url: 'data:text/javascript,export default globalThis.__libraryBackupTest.store', shortCircuit: true }
    }
    return next(specifier, context)
  },
})
const { writeLibraryBackup, stageLibraryBackup, importLibraryRecords } = await import(helper)
after(() => { hooks.deregister(); delete globalThis.__libraryBackupTest; delete globalThis.window })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-backup-streams-'))
  const engine = await openLibrary(directory)
  const imports = new LibraryImports(engine)
  const exports = new LibraryExports(engine)
  const calls = []
  t.after(async () => {
    for (const id of imports.jobs.keys()) imports.cancel({ id })
    for (const id of exports.jobs.keys()) exports.cancel({ id })
    engine.database.close()
    await rm(directory, { recursive: true, force: true })
  })
  t.mock.method(handlers, 'query', async (method, payload = {}) => {
    calls.push([method, structuredClone(payload)])
    const args = structuredClone(payload)
    const result = method === 'importApply'
      ? await imports.apply(args, {})
      : (method.startsWith('import') ? imports : exports)[method.replace(/^(import|export)/, '').toLowerCase()](args)
    return structuredClone(result)
  })
  return { engine, imports, exports, calls }
}

function destination(t, write = async () => {}) {
  const chunks = []
  let closed = false
  let aborted = false
  t.mock.method(picker, 'showSaveFilePicker', async () => ({ createWritable: async () => ({
    async write(data) { await write(data); chunks.push(Buffer.from(data)) },
    async close() { closed = true },
    async abort() { aborted = true },
  }) }))
  return { bytes: () => Buffer.concat(chunks), closed: () => closed, aborted: () => aborted }
}

test('the renderer streams a real backup through export, staging and atomic restore', async t => {
  const { engine, imports, exports } = await fixture(t)
  const record = { _id: 'saved', videoId: 'saved', timeWatched: 123, isWatched: false, unknown: { text: '雪😀', values: [null, false] } }
  await engine.collections.history.insertAsync(record)
  const file = destination(t)
  assert.equal(await writeLibraryBackup({}, 'backup.zip', 'Backup', 'backup', 'documents'), true)
  assert.equal(file.closed(), true)
  assert.equal(exports.jobs.size, 0)
  await engine.collections.history.removeAsync({}, { multi: true })
  const staged = await stageLibraryBackup(new Blob([file.bytes()]))
  assert.equal(staged.counts.history, 1)
  await imports.apply({ id: staged.id, sections: ['history'] }, {})
  assert.deepEqual(await engine.collections.history.findAsync({}), [record])
})

for (const format of ['ndjson', 'youtubeHistory']) {
  test(`the renderer streams ${format} history exports from the real SQLite snapshot`, async t => {
    const { engine, exports } = await fixture(t)
    const record = { _id: 'h', videoId: 'video', title: '雪😀', author: 'Channel', authorId: 'channel', timeWatched: 123, unknown: { keep: true } }
    await engine.collections.history.insertAsync(record)
    const file = destination(t)
    await writeLibraryBackup({}, 'history.json', 'History', 'history', 'documents', { format, collection: 'history' })
    const parsed = JSON.parse(file.bytes().toString('utf8'))
    assert.deepEqual(parsed, format === 'ndjson' ? record : [{ header: 'YouTube', title: 'Watched 雪😀', titleUrl: 'https://www.youtube.com/watch?v=video', subtitles: [{ name: 'Channel', url: 'https://www.youtube.com/channel/channel' }], time: new Date(123).toISOString(), products: ['YouTube'], activityControls: ['YouTube watch history'] }])
    assert.equal(file.closed(), true)
    assert.equal(exports.jobs.size, 0)
  })
}

test('a destination failure aborts the output and cancels the export snapshot without hiding the error', async t => {
  const { engine, exports } = await fixture(t)
  await engine.collections.history.insertAsync({ videoId: 'keep', timeWatched: 1 })
  const failure = new Error('destination write failed')
  const file = destination(t, async () => { throw failure })
  await assert.rejects(writeLibraryBackup({}, 'backup.zip', 'Backup', 'backup', 'documents'), error => error === failure)
  assert.equal(file.aborted(), true)
  assert.equal(file.closed(), false)
  assert.equal(exports.jobs.size, 0)
  assert.equal(await engine.collections.history.countAsync({}), 1)
})

test('malformed staged input and a source reader failure cancel their stages without touching live data', async t => {
  const { engine, imports } = await fixture(t)
  const record = { _id: 'saved', videoId: 'saved', timeWatched: 1 }
  await engine.collections.history.insertAsync(record)
  await assert.rejects(stageLibraryBackup(new Blob(['invalid archive'])))
  assert.equal(imports.jobs.size, 0)
  const failure = new Error('reader unavailable')
  await assert.rejects(stageLibraryBackup({ stream() { throw failure } }), error => error === failure)
  assert.equal(imports.jobs.size, 0)
  assert.deepEqual(await engine.collections.history.findAsync({}), [record])
})

test('record merges use bounded staged chunks, refresh after commit, and cancel malformed batches', async t => {
  const { engine, imports, calls } = await fixture(t)
  const records = Array.from({ length: 251 }, (_, i) => ({ _id: `h${i}`, videoId: `v${i}`, timeWatched: i, isWatched: false, unknown: { keep: i } }))
  const dispatched = []
  t.mock.method(store, 'dispatch', async (action, reason) => {
    assert.equal(await engine.collections.history.countAsync({}), records.length)
    dispatched.push([action, reason])
  })
  await importLibraryRecords('history', records)
  assert.deepEqual(calls.filter(([method]) => method === 'importChunk').map(([, payload]) => payload.records.length), [250, 1])
  assert.deepEqual(dispatched, [['scheduleSyncServer', 'history'], ['grabHistory', undefined]])
  assert.equal(imports.jobs.size, 0)
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ timeWatched: 1 }), records)
  await assert.rejects(importLibraryRecords('history', [{ videoId: 'not-committed', timeWatched: 500 }, null]))
  assert.equal(imports.jobs.size, 0)
  assert.deepEqual(dispatched, [['scheduleSyncServer', 'history'], ['grabHistory', undefined]])
  assert.deepEqual(await engine.collections.history.findAsync({}).sort({ timeWatched: 1 }), records)
})

for (const section of ['history', 'playlists']) {
  for (const failure of ['none', 'apply', 'refresh']) {
    test(`${section} import schedules sync only after commit, including a ${failure} failure`, async t => {
      const { engine, imports } = await fixture(t)
      const record = section === 'history' ? { _id: 'incoming', videoId: 'incoming', timeWatched: 1, isWatched: false } : { _id: 'incoming', playlistName: 'Incoming', videos: [], createdAt: 1, lastUpdatedAt: 1, protected: false }
      const originalQuery = handlers.query
      const error = new Error(failure)
      t.mock.method(handlers, 'query', async (method, args) => {
        if (method === 'importApply' && failure === 'apply') throw error
        return originalQuery(method, args)
      })
      const dispatched = []
      t.mock.method(store, 'dispatch', async (action, reason) => {
        assert.deepEqual(await engine.collections[section].findAsync({}), [record])
        dispatched.push([action, reason])
        if (action !== 'scheduleSyncServer' && failure === 'refresh') throw error
      })
      const request = importLibraryRecords(section, [record])
      if (failure === 'none') await request
      else await assert.rejects(request, error)
      assert.deepEqual(dispatched, failure === 'apply' ? [] : [['scheduleSyncServer', section], [section === 'history' ? 'grabHistory' : 'grabAllPlaylists', undefined]])
      assert.deepEqual(await engine.collections[section].findAsync({}), failure === 'apply' ? [] : [record])
      assert.equal(imports.jobs.size, 0)
    })
  }
}
