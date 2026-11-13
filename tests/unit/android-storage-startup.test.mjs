import assert from 'node:assert/strict'
import test from 'node:test'

const pending = new Map()
globalThis.__androidStoragePending = pending
// index.js loads the platform's datastore factory with require().
globalThis.require = () => ({
  createBrowserDatastore: name => ({
    autoloadPromise: new Promise((resolve, reject) => {
      pending.set(`${name}.db`, { resolve, reject })
    })
  })
})
const { waitForDatastores } = await import('../../src/datastores/index.js')
delete globalThis.require

test('Android startup waits for every datastore and blocks startup after a migration failure', async () => {
  const failure = new Error('Device storage full')
  let settled = false
  const ready = waitForDatastores().finally(() => { settled = true })
  const rejected = assert.rejects(ready, error => error === failure)
  pending.get('history.db').reject(failure)
  for (const [name, { resolve }] of pending) {
    if (!['settings.db', 'history.db'].includes(name)) resolve()
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, 'Other pending migrations must finish before offering a retry')
  pending.get('settings.db').resolve()
  await rejected
})
