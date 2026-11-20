import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const stored = [
  { _id: 'rss:https://kept.example.test/feed', items: [], seen: ['old'] },
  { _id: 'rss:https://gone.example.test/feed', items: [] },
]
let finds = 0
let failingWrites = 0
const writes = []
globalThis.__feedCacheHandlers = {
  find: async () => {
    if (++finds === 1) throw new Error('Database busy')
    return stored
  },
  write: async (change) => {
    writes.push(change)
    if (failingWrites > 0) {
      failingWrites--
      throw new Error('Disk full')
    }
  },
  deleteAll: async () => {
    throw new Error('Disk full')
  },
  // Another window changed the cache after the read, before this one listened
  onChange: listener => listener('upsert', {
    docs: [{ _id: 'rss:https://kept.example.test/feed', items: [], seen: ['newer'] }],
    removed: ['rss:https://gone.example.test/feed'],
  }),
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
const { clearFeedCache, createFeedCacheMirror } = await import('../../src/renderer/helpers/feedCacheStore.js')
hooks.deregister()

/** A window's state, which takes the documents the mirror reports */
function createWindow(prefix, initial) {
  const state = new Map(initial)
  const changes = []
  const mirror = createFeedCacheMirror(prefix, (change) => {
    changes.push(change)
    if (change === null) {
      state.clear()
      return
    }
    for (const [key, doc] of change) {
      if (doc === null) state.delete(key)
      else state.set(key, doc)
    }
  })
  return { mirror, state, changes, save: () => mirror.save(() => new Map(state)) }
}

test('a feed cache that could not be read is read again before a save replaces it', async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const window = createWindow('rss:', [['https://a.example.test/feed', { items: [{ id: 'a' }] }]])
    assert.equal((await window.mirror.loaded).size, 0)
    assert.equal(await window.save(), true)
    // The window took the stored history instead of removing it, with the
    // later changes of the other window
    assert.deepEqual(window.state.get('https://kept.example.test/feed'), { items: [], seen: ['newer'] })
    assert.equal(window.state.has('https://gone.example.test/feed'), false)
    assert.deepEqual(writes.map(change => [change.docs.map(doc => doc._id), change.removed]), [
      [['rss:https://a.example.test/feed'], []],
    ])
  } finally {
    console.error = originalError
  }
})

test('a feed cache write that failed is retried by the next save', async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    writes.length = 0
    failingWrites = 1
    const window = createWindow('platform:', [['twitch:1', { live: [{ id: 'a' }] }]])
    await window.mirror.loaded
    // Callers keep what they would lose until a save reports it written
    assert.equal(await window.save(), false)
    assert.equal(await window.save(), true)
    assert.deepEqual(writes.map(change => change.docs.map(doc => doc._id)), [
      ['platform:twitch:1'],
      ['platform:twitch:1'],
    ])
    // Written now, so an unchanged save writes nothing
    assert.equal(await window.save(), true)
    assert.equal(writes.length, 2)
  } finally {
    console.error = originalError
  }
})

test('a feed cache clear that failed leaves the windows their items', async () => {
  const window = createWindow('platform:', [])
  await window.mirror.loaded
  await assert.rejects(clearFeedCache(), /Disk full/)
  assert.deepEqual(window.changes, [])
})
