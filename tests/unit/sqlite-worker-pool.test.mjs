import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/datastores/sqliteWorker.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')

// The OPFS pool holds a fixed number of files and never grows on its own.
function createWorker() {
  const files = new Set()
  let capacity = 0
  const add = path => {
    if (files.has(path)) return
    if (files.size >= capacity) throw new Error(`No free file for ${path}`)
    files.add(path)
  }
  const pool = {
    getFileCount: () => files.size,
    getFileNames: () => [...files],
    reserveMinimumCapacity: async minimum => { capacity = Math.max(capacity, minimum) },
    OpfsSAHPoolDb: class {
      constructor(path) { this.path = path; add(path) }
      selectValue() { return 0 }
      // SQLite creates the rollback journal when a transaction first writes.
      exec(sql) { if (sql === 'BEGIN IMMEDIATE') add(`${this.path}-journal`) }
      prepare() { return { bind() {}, step: () => false, get: () => [], reset() {}, finalize() {} } }
      close() {}
    },
  }
  const replies = new Map()
  const self = {
    isSecureContext: true,
    postMessage: reply => replies.get(reply.id)(reply),
  }
  vm.runInNewContext(source, {
    self,
    navigator: { locks: { request: (_name, _options, hold) => { hold(); return new Promise(() => {}) } } },
    AbortSignal,
    SCHEMA_VERSION: 1,
    sqlite3InitModule: async () => ({ installOpfsSAHPoolVfs: async () => pool }),
  })
  let id = 0
  return (method, args) => new Promise(resolve => {
    replies.set(++id, resolve)
    self.onmessage({ data: { id, method, args } })
  })
}

test('databases opened together keep room for the journals they create when they first write', async () => {
  const request = createWorker()
  const names = ['history', 'profile-6b696473-history', 'profile-6b696473-playlists']
  // A first opening reads before it writes its schema.
  await Promise.all(names.map(name => request('execute', { name, statements: [['SELECT 1']] })))
  const writes = await Promise.all(names.map(name => request('execute', { name, statements: [['SELECT 1']], transaction: true })))
  assert.deepEqual(writes.map(reply => reply.error), [undefined, undefined, undefined])
})
