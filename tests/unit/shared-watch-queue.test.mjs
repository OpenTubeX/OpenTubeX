import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from 'vuex'
import { createSharedWatchQueue, createFileWatchQueue } from '../../src/main/watchQueue.js'
import watchQueue, { persistWatchQueue } from '../../src/renderer/store/modules/watch-queue.js'

function sharedWindows() {
  let saved = '[]'
  const storage = { read: () => JSON.parse(saved), write: items => { saved = JSON.stringify(items) } }
  const update = createSharedWatchQueue(storage)
  const listeners = []
  const snapshots = []
  const adapter = {
    update(request) {
      const snapshot = update(request)
      if (request.type) snapshots.push(snapshot)
      return snapshot
    },
    onUpdated: handler => listeners.push(handler),
  }
  return {
    window: () => createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, null, adapter)] }),
    restored: () => createSharedWatchQueue(storage)({}).items.map(item => item.videoId),
    deliverUpdates: () => snapshots.splice(0).forEach(snapshot => listeners.forEach(listener => listener(structuredClone(snapshot)))),
  }
}

const addVideo = (store, videoId) => store.commit('addVideoToWatchQueue', { video: { videoId, title: videoId } })

test('a stale window cannot resurrect a cleared item when adding another video', () => {
  const windows = sharedWindows()
  const first = windows.window()
  addVideo(first, 'one')
  const second = windows.window()
  first.commit('clearWatchQueue')
  addVideo(second, 'two')
  assert.deepEqual(windows.restored(), ['two'])
  windows.deliverUpdates()
  for (const store of [first, second]) assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['two'])
})

test('additions from two stale windows both persist and delayed events cannot roll back newer state', () => {
  const windows = sharedWindows()
  const first = windows.window()
  const second = windows.window()
  addVideo(first, 'one')
  addVideo(second, 'two')
  assert.deepEqual(windows.restored(), ['one', 'two'])
  windows.deliverUpdates()
  first.commit('removeVideoFromWatchQueue', first.getters.getWatchQueue[0].queueItemId)
  second.commit('removeVideoFromWatchQueue', second.getters.getWatchQueue[1].queueItemId)
  assert.deepEqual(windows.restored(), [])
  windows.deliverUpdates()
  for (const store of [first, second]) assert.equal(store.getters.getWatchQueueLength, 0)
})

test('the desktop queue persists to disk before replying and restores download routes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-queue-test-'))
  try {
    const filename = join(directory, 'watch-queue.json')
    const update = createFileWatchQueue(filename)
    const video = { videoId: 'download', title: 'Saved video', route: { path: '/watch/download', query: { downloadId: '42' } } }
    update({ type: 'addVideoToWatchQueue', payload: { video } })
    const restored = createFileWatchQueue(filename)({})
    assert.deepEqual(restored.items.map(({ queueItemId, ...item }) => item), [video])
    update({ type: 'clearWatchQueue' })
    assert.deepEqual(createFileWatchQueue(filename)({}).items, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
