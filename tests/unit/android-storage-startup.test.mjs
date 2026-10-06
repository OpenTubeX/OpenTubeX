import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const pending = new Map()
globalThis.__androidStoragePending = pending
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@seald-io/nedb' && context.parentURL?.endsWith('/datastores/index.js')) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`export default class {
          constructor({ filename }) {
            this.autoloadPromise = new Promise((resolve, reject) => {
              globalThis.__androidStoragePending.set(filename, { resolve, reject })
            })
          }
        }`)}`,
      }
    }
    return nextResolve(specifier, context)
  },
})
const { waitForDatastores } = await import('../../src/datastores/index.js')
hooks.deregister()

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
