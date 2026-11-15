import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// The renderer bundler resolves the extensionless import; Node needs the file URL.
const source = (await readFile(new URL('../../src/datastores/browserSubscriptionCache.js', import.meta.url), 'utf8'))
  .replace("from '../subscriptionFeedState'", `from '${new URL('../../src/subscriptionFeedState.js', import.meta.url)}'`)
const { createBrowserSubscriptionCache } = await import(`data:text/javascript,${encodeURIComponent(source)}`)

/** In-memory IndexedDB with the parts the cache uses. Counts read/write transactions. */
function fakeIndexedDB() {
  const stores = new Map()
  const counts = { readwrite: 0 }
  const request = run => {
    const req = {}
    queueMicrotask(() => {
      req.result = run()
      req.onsuccess?.()
    })
    return req
  }
  const db = {
    createObjectStore: name => stores.set(name, new Map()),
    transaction(_names, mode) {
      if (mode === 'readwrite') counts.readwrite++
      let pending = 0
      const tx = {
        abort() { setTimeout(() => tx.onabort?.()) },
        objectStore: name => {
          const store = stores.get(name)
          const track = run => {
            pending++
            return request(() => {
              const result = run()
              if (--pending === 0) setTimeout(() => { if (pending === 0) tx.oncomplete?.() })
              return result
            })
          }
          return {
            get: key => track(() => structuredClone(store.get(key))),
            getAll: () => track(() => [...store.values()].map(value => structuredClone(value))),
            put: (value, key) => track(() => store.set(key ?? value._id, structuredClone(value))),
          }
        },
      }
      setTimeout(() => { if (pending === 0) tx.oncomplete?.() })
      return tx
    },
  }
  const indexedDB = {
    open() {
      const req = {}
      setTimeout(() => {
        req.result = db
        if (stores.size === 0) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }
  return { indexedDB, counts }
}

test('marking a feed as seen writes every channel in one transaction', async () => {
  const { indexedDB, counts } = fakeIndexedDB()
  globalThis.indexedDB = indexedDB
  const video = (videoId) => ({ videoId, isNewInSubscriptionFeed: true })
  const cache = createBrowserSubscriptionCache(async () => [
    { _id: 'first', videos: [video('a')], shorts: [video('s')] },
    { _id: 'second', videos: [video('b'), video('c')] },
  ])
  await cache.find()
  const before = counts.readwrite

  await cache.markEntriesAsSeenMany([
    { channelId: 'first', tab: 'videos', entries: [{ videoId: 'a', isNewInSubscriptionFeed: false }] },
    { channelId: 'first', tab: 'shorts', entries: [{ videoId: 's', isNewInSubscriptionFeed: false }] },
    { channelId: 'second', tab: 'videos', entries: [{ videoId: 'b', isNewInSubscriptionFeed: false }] },
    { channelId: 'missing', tab: 'videos', entries: [{ videoId: 'x', isNewInSubscriptionFeed: false }] },
  ])

  assert.equal(counts.readwrite - before, 1)
  const records = Object.fromEntries((await cache.find()).map(record => [record._id, record]))
  assert.deepEqual(records.first.videos.map(entry => entry.isNewInSubscriptionFeed), [false])
  assert.deepEqual(records.first.shorts.map(entry => entry.isNewInSubscriptionFeed), [false])
  assert.deepEqual(records.second.videos.map(entry => entry.isNewInSubscriptionFeed), [false, true])
  assert.equal(records.missing, undefined)
  delete globalThis.indexedDB
})
