import assert from 'node:assert/strict'
import test from 'node:test'
import { dismissAutoSyncNotice, shouldShowAutoSyncNotice } from '../../src/renderer/helpers/sync-auto-sync-notice.js'

const settings = {
  syncServerEnabled: true,
  syncServerToken: 'test-token',
  syncServerAutoSync: false,
}
function createStorage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('an existing client keeps the notice across launches until dismissed', () => {
  const storage = createStorage()
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), true)
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings, storage), true)
  dismissAutoSyncNotice(storage)
  assert.equal(shouldShowAutoSyncNotice('0.35.0', settings, storage), false)
})

test('unavailable local storage does not interrupt startup or dismissal', (t) => {
  t.mock.method(console, 'error', () => {})
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable') } })
  t.after(() => delete globalThis.localStorage)
  assert.equal(shouldShowAutoSyncNotice('0.34.0', settings), false)
  assert.doesNotThrow(() => dismissAutoSyncNotice())
})
