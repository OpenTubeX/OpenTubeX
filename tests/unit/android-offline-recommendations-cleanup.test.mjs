import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../android/offline-recommendations.test.mjs', import.meta.url), 'utf8')
const cleanupStart = source.indexOf('\n  } finally {')
const cleanupEnd = source.lastIndexOf('\n})')
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'Android cleanup source markers must exist in order')
const cleanup = source.slice(cleanupStart, cleanupEnd)

for (const failure of ['store', 'handle']) {
  test(`Android recommendation cleanup restores network overrides and closes CDP after a ${failure} failure`, async () => {
    const fetch = () => {}
    const navigator = {}
    const window = {
      fetch: () => {},
      __offlineRecommendationsFetch: fetch,
      __offlineRecommendationsOnline: undefined,
      dispatchEvent() {},
    }
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const store = {
      state: { watchQueue: { items: [] } },
      commit() { if (failure === 'store') throw new Error('Injected store failure') },
    }
    let closed = false
    const context = {
      saved: { downloads: [], settings: {}, queue: [], route: '#/history' }, ids: [1],
      watch: { async dispose() { if (failure === 'handle') throw new Error('Injected handle failure') } },
      browser: { async close() { closed = true } },
      page: { async evaluate(fn, argument) {
        return runInNewContext(`(${fn.toString()})(argument)`, {
          argument, window, navigator, Event: class {}, location: { hash: '' },
          document: { querySelector: selector => selector === 'video' ? null : {
            __vue_app__: { config: { globalProperties: { $store: store } } },
          } },
        })
      } },
    }
    await assert.rejects(runInNewContext(`(async () => { try {${cleanup}})()`, context), /Injected/)
    assert.equal(window.fetch, fetch)
    assert.equal(Object.hasOwn(navigator, 'onLine'), false)
    assert.equal(closed, true)
  })
}

test('Android recommendation cleanup closes CDP when WebView context discovery fails', async () => {
  let closed = false
  const browser = {
    contexts: () => [],
    async close() { closed = true },
  }
  const callbackStart = source.indexOf('}, async () => {')
  const setupEnd = source.indexOf("    await page.locator('.profileTrigger')")
  assert.ok(callbackStart >= 0 && setupEnd > callbackStart, 'Android setup source markers must exist in order')
  const setup = source.slice(callbackStart + '}, async () => {'.length, setupEnd)
  await assert.rejects(runInNewContext(`(async () => {${setup}${cleanup}})()`, {
    chromium: { async connectOverCDP() { return browser } }, process: { env: {} },
  }), /pages/)
  assert.equal(closed, true)
})
