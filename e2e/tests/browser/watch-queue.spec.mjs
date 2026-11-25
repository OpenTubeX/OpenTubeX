import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

const [vue, vuex, shared, browser, queue] = await Promise.all([
  '../../../node_modules/vue/dist/vue.global.prod.js',
  '../../../node_modules/vuex/dist/vuex.global.prod.js',
  '../../../src/watchQueue.js',
  '../../../src/renderer/helpers/browserWatchQueue.js',
  '../../../src/renderer/store/modules/watch-queue.js'
].map(path => readFile(new URL(path, import.meta.url), 'utf8')))

test.beforeEach(async ({ context }) => {
  await context.route('http://localhost/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Watch queue persistence</title>'
  }))
})

async function queueTab(context, setup) {
  const page = await context.newPage()
  if (setup) await page.addInitScript(setup)
  await page.goto('http://localhost/')
  const plain = source => source.replace(/^import .*\n/gm, '').replace(/^export \{.*\}\n/gm, '').replace('export default', 'const queueModule =').replace(/^export /gm, '')
  await page.addScriptTag({ content: `${vue}\n${vuex}\nwindow.process = { env: {} };\n${[shared, browser, queue].map(plain).join('\n')}\nwindow.store = Vuex.createStore({ modules: { watchQueue: queueModule }, plugins: [persistWatchQueue] });` })
  return page
}

const videos = page => page.evaluate(() => window.store.getters.getWatchQueue.map(item => item.videoId))
const add = (page, videoId) => page.evaluate(videoId => {
  window.store.commit('addVideoToWatchQueue', { video: { videoId, title: videoId } })
}, videoId)

test('two browser tabs retain simultaneous additions after reloading', async ({ context }) => {
  const first = await queueTab(context)
  const second = await queueTab(context)
  await Promise.all([add(first, 'one'), add(second, 'two')])
  for (const page of [first, second]) await expect.poll(async () => (await videos(page)).sort()).toEqual(['one', 'two'])
  const order = await videos(first)
  await first.close()
  await second.close()
  const restored = await queueTab(context)
  await expect.poll(() => videos(restored)).toEqual(order)
})

function failQueueWrites() {
  window.failWrites = 0
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    const result = put.apply(this, args)
    if (this.name === 'state' && window.failWrites > 0) {
      window.failWrites--
      this.transaction.abort()
    }
    return result
  }
}

for (const operation of ['add', 'remove', 'clear']) {
  test(`a failed browser ${operation} immediately rolls back without affecting another tab`, async ({ context }) => {
    const first = await queueTab(context, failQueueWrites)
    await add(first, 'saved')
    const second = await queueTab(context)
    await expect.poll(() => videos(second)).toEqual(['saved'])
    await first.evaluate(operation => {
      window.failWrites = 1
      const store = window.store
      if (operation === 'add') store.commit('addVideoToWatchQueue', { video: { videoId: 'unsaved' } })
      else if (operation === 'remove') store.commit('removeVideoFromWatchQueue', store.getters.getWatchQueue[0].queueItemId)
      else store.commit('clearWatchQueue')
    }, operation)
    await expect.poll(() => first.evaluate(() => window.failWrites)).toBe(0)
    for (const page of [first, second]) await expect.poll(() => videos(page)).toEqual(['saved'])
    await add(first, 'recovered')
    for (const page of [first, second]) await expect.poll(() => videos(page)).toEqual(['saved', 'recovered'])
    const restored = await queueTab(context)
    await expect.poll(() => videos(restored)).toEqual(['saved', 'recovered'])
  })
}

test('browser queue retries opening storage after a transient startup failure', async ({ context }) => {
  const page = await queueTab(context, () => {
    window.openAttempts = 0
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (...args) {
      if (args[0] === 'opentubex-watch-queue' && ++window.openAttempts === 1) {
        throw new DOMException('Injected open failure', 'UnknownError')
      }
      return open.apply(this, args)
    }
  })
  await expect.poll(() => page.evaluate(() => window.openAttempts)).toBe(1)
  await add(page, 'recovered')
  const restored = await queueTab(context)
  await expect.poll(() => videos(restored)).toEqual(['recovered'])
  await expect.poll(() => page.evaluate(() => window.openAttempts)).toBe(2)
})

test('clearing in one browser tab cannot be undone by adding in another', async ({ context }) => {
  const first = await queueTab(context)
  await add(first, 'cleared')
  const second = await queueTab(context)
  await expect.poll(() => videos(second)).toEqual(['cleared'])
  await first.evaluate(() => window.store.commit('clearWatchQueue'))
  await add(second, 'remaining')
  for (const page of [first, second]) await expect.poll(() => videos(page)).toEqual(['remaining'])
  await first.close()
  await second.close()
  const restored = await queueTab(context)
  await expect.poll(() => videos(restored)).toEqual(['remaining'])
})

test('pending edits preserve duplicate identities, reordering, removal, and download metadata', async ({ context }) => {
  const first = await queueTab(context)
  const remainingId = await first.evaluate(() => {
    const store = window.store
    store.commit('addVideoToWatchQueue', { video: { videoId: 'removed', title: 'Removed' } })
    store.commit('removeVideoFromWatchQueue', store.getters.getWatchQueue[0].queueItemId)
    const video = { videoId: 'saved', title: 'Downloaded video', author: 'Channel', route: { path: '/watch/saved', query: { downloadId: '42' } } }
    store.commit('addVideoToWatchQueue', { video })
    store.commit('addVideoToWatchQueue', { video })
    const [one, two] = store.getters.getWatchQueue
    if (one.queueItemId === two.queueItemId) throw new Error('Duplicate item IDs')
    store.commit('moveVideoInWatchQueue', { queueItemId: two.queueItemId, targetQueueItemId: one.queueItemId })
    store.commit('removeVideoFromWatchQueue', one.queueItemId)
    return two.queueItemId
  })
  const second = await queueTab(context)
  for (const page of [first, second]) {
    await expect.poll(() => page.evaluate(() => window.store.getters.getWatchQueue)).toEqual([{
      videoId: 'saved',
      title: 'Downloaded video',
      author: 'Channel',
      route: { path: '/watch/saved', query: { downloadId: '42' } },
      queueItemId: remainingId
    }])
  }
})
