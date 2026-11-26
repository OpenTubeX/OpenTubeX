import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../../src/renderer/helpers/polyfills.js', import.meta.url), 'utf8')

// Runs the polyfills as on a WebView without AbortSignal.any, such as Chromium 114.
function polyfilledAbortSignal() {
  const context = vm.createContext({ AbortSignal: {}, AbortController, Promise, URL })
  vm.runInContext(source, context)
  return context.AbortSignal
}

test('AbortSignal.any polyfill aborts with the first source reason and releases the others', () => {
  const AbortSignalPolyfill = polyfilledAbortSignal()
  const request = new AbortController()
  const shutdown = new AbortController()
  let shutdownListeners = 0
  const add = shutdown.signal.addEventListener.bind(shutdown.signal)
  const remove = shutdown.signal.removeEventListener.bind(shutdown.signal)
  shutdown.signal.addEventListener = (type, listener) => { shutdownListeners++; add(type, listener) }
  shutdown.signal.removeEventListener = (type, listener) => { shutdownListeners--; remove(type, listener) }

  const combined = AbortSignalPolyfill.any([request.signal, shutdown.signal])
  assert.equal(combined.aborted, false)
  assert.equal(shutdownListeners, 1)

  request.abort('cancelled')
  assert.equal(combined.aborted, true)
  assert.equal(combined.reason, 'cancelled')
  // A long-lived source must not keep listeners of finished requests.
  assert.equal(shutdownListeners, 0)
  shutdown.abort('shutdown')
  assert.equal(combined.reason, 'cancelled')
})

test('AbortSignal.any polyfill returns an aborted signal for an aborted source', () => {
  const AbortSignalPolyfill = polyfilledAbortSignal()
  const combined = AbortSignalPolyfill.any([new AbortController().signal, AbortSignal.abort('gone')])
  assert.equal(combined.aborted, true)
  assert.equal(combined.reason, 'gone')
})
