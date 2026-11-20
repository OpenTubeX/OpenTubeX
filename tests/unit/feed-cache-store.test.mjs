import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const writes = []
globalThis.__feedCacheHandlers = {
  find: async () => [],
  write: async (change) => {
    writes.push(change)
    if (writes.length === 1) throw new Error('Disk full')
  },
  deleteAll: async () => {},
  onChange: () => {},
}

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../../datastores/handlers/index' && context.parentURL?.endsWith('/helpers/feedCacheStore.js')) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export const DBFeedCacheHandlers = globalThis.__feedCacheHandlers')}`
      }
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.js`, context)
    return nextResolve(specifier, context)
  }
})
const { createFeedCacheMirror } = await import('../../src/renderer/helpers/feedCacheStore.js')
hooks.deregister()

test('a feed cache write that failed is retried by the next save', async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const mirror = createFeedCacheMirror('rss:', () => {})
    await mirror.loaded
    const item = { id: 'a' }
    const documents = () => new Map([['https://a.example.test/feed', { items: [item] }]])
    await mirror.save(documents)
    await mirror.save(documents)
    assert.deepEqual(writes.map(change => change.docs.map(doc => doc._id)), [
      ['rss:https://a.example.test/feed'],
      ['rss:https://a.example.test/feed'],
    ])
    // Written now, so an unchanged save writes nothing
    await mirror.save(documents)
    assert.equal(writes.length, 2)
  } finally {
    console.error = originalError
  }
})
