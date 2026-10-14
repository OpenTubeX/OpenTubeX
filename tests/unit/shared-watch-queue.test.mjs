import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
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
    async update(request) {
      const snapshot = await update(request)
      if (request.type) snapshots.push(snapshot)
      return snapshot
    },
    onUpdated: handler => listeners.push(handler),
  }
  return {
    window: () => createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, null, adapter)] }),
    restored: async () => (await createSharedWatchQueue(storage)({})).items.map(item => item.videoId),
    deliverUpdates: () => snapshots.splice(0).forEach(snapshot => listeners.forEach(listener => listener(structuredClone(snapshot)))),
  }
}

const addVideo = (store, videoId) => store.commit('addVideoToWatchQueue', { video: { videoId, title: videoId } })
const settle = () => new Promise(setImmediate)

test('an async failure rolls back only the failed edit while keeping newer pending edits', async () => {
  const requests = []
  const initial = { revision: 1, items: [{ videoId: 'saved', queueItemId: 'saved-id' }] }
  const adapter = {
    update: request => new Promise((resolve, reject) => requests.push({ request, resolve, reject })),
    onUpdated() {},
  }
  const store = createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, null, adapter)] })
  requests.shift().resolve(initial)
  await new Promise(setImmediate)
  addVideo(store, 'failed')
  addVideo(store, 'pending')
  requests.shift().reject(new Error('Transaction aborted'))
  await new Promise(setImmediate)
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['saved', 'pending'])
  const next = requests.shift()
  next.resolve({ revision: 2, items: [...initial.items, { ...next.request.payload.video, queueItemId: next.request.payload.queueItemId }] })
  await new Promise(setImmediate)
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['saved', 'pending'])
})

test('a failed restore blocks writes and retries before applying the next change', async () => {
  let unreadable = true
  let saved = [{ videoId: 'saved', title: 'Saved' }]
  let writes = 0
  const update = createSharedWatchQueue({
    read() {
      if (unreadable) throw new Error('Temporary read failure')
      return structuredClone(saved)
    },
    write(items) { saved = structuredClone(items); writes++ },
  })
  await assert.rejects(update({}), /Temporary read failure/)
  await assert.rejects(update({ type: 'clearWatchQueue' }), /Temporary read failure/)
  assert.equal(writes, 0)
  unreadable = false
  const snapshot = await update({ type: 'addVideoToWatchQueue', payload: { video: { videoId: 'new' } } })
  assert.deepEqual(snapshot.items.map(item => item.videoId), ['saved', 'new'])
  assert.equal(snapshot.revision, 1)
  assert.deepEqual(saved, snapshot.items)
})

test('failed writes roll back every window to the durable queue with a newer revision', async () => {
  let unwritable = false
  let saved = [{ videoId: 'saved', title: 'Saved' }]
  const update = createSharedWatchQueue({
    read: () => structuredClone(saved),
    write(items) {
      if (unwritable) throw new Error('Disk full')
      saved = structuredClone(items)
    },
  })
  const listeners = []
  const adapter = {
    async update(request) {
      const snapshot = await update(request)
      listeners.forEach(handler => handler(snapshot))
      return snapshot
    },
    onUpdated: handler => listeners.push(handler),
  }
  const window = () => createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, null, adapter)] })
  const first = window()
  const second = window()
  await settle()
  const initial = JSON.parse(JSON.stringify(first.getters.getWatchQueue))
  unwritable = true
  addVideo(first, 'unsaved')
  await settle()
  for (const store of [first, second]) assert.deepEqual(store.getters.getWatchQueue, initial)
  first.commit('clearWatchQueue')
  await settle()
  for (const store of [first, second]) assert.deepEqual(store.getters.getWatchQueue, initial)
  assert.equal((await update({})).revision, 2)
  unwritable = false
  addVideo(second, 'new')
  await settle()
  assert.deepEqual(saved.map(item => item.videoId), ['saved', 'new'])
})

test('a restore error allows app startup and a later edit retries the shared queue', async () => {
  let unavailable = true
  const update = createSharedWatchQueue({
    read: () => [{ videoId: 'saved' }],
    write() {},
  })
  const adapter = {
    update(request) {
      if (unavailable) throw new Error('Queue unavailable')
      return update(request)
    },
    onUpdated() {},
  }
  const store = createStore({ modules: { watchQueue }, plugins: [store => persistWatchQueue(store, null, adapter)] })
  assert.equal(store.getters.getWatchQueueLength, 0)
  unavailable = false
  addVideo(store, 'new')
  await settle()
  assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['saved', 'new'])
})

const component = await readFile(new URL('../../src/renderer/components/WatchVideoQueue/WatchVideoQueue.vue', import.meta.url), 'utf8')
const moveSource = component.slice(component.indexOf('function move(queueItemId, offset)'), component.indexOf('\nfunction setQueueDragHandle('))

for (const upwards of [true, false]) {
  test(`a stale window's ${upwards ? 'upward' : 'downward'} drag keeps its target after another window removes an intervening item`, async () => {
    const windows = sharedWindows()
    const first = windows.window()
    for (const id of ['one', 'two', 'three', 'four']) addVideo(first, id)
    const second = windows.window()
    await settle()
    second.commit('removeVideoFromWatchQueue', second.getters.getWatchQueue[1].queueItemId)
    await settle()
    const movedItem = first.getters.getWatchQueue[upwards ? 3 : 0]
    const move = runInNewContext(`${moveSource}\nmove`, { store: first, items: { value: first.getters.getWatchQueue } })
    move(movedItem.queueItemId, upwards ? -3 : 3)
    await settle()
    assert.deepEqual(await windows.restored(), upwards ? ['four', 'one', 'three'] : ['three', 'four', 'one'])
  })
}

test('a stale window cannot resurrect a cleared item when adding another video', async () => {
  const windows = sharedWindows()
  const first = windows.window()
  addVideo(first, 'one')
  const second = windows.window()
  await settle()
  first.commit('clearWatchQueue')
  addVideo(second, 'two')
  await settle()
  assert.deepEqual(await windows.restored(), ['two'])
  windows.deliverUpdates()
  for (const store of [first, second]) assert.deepEqual(store.getters.getWatchQueue.map(item => item.videoId), ['two'])
})

test('additions from two stale windows both persist and delayed events cannot roll back newer state', async () => {
  const windows = sharedWindows()
  const first = windows.window()
  const second = windows.window()
  await settle()
  addVideo(first, 'one')
  addVideo(second, 'two')
  await settle()
  assert.deepEqual(await windows.restored(), ['one', 'two'])
  windows.deliverUpdates()
  first.commit('removeVideoFromWatchQueue', first.getters.getWatchQueue[0].queueItemId)
  second.commit('removeVideoFromWatchQueue', second.getters.getWatchQueue[1].queueItemId)
  await settle()
  assert.deepEqual(await windows.restored(), [])
  windows.deliverUpdates()
  for (const store of [first, second]) assert.equal(store.getters.getWatchQueueLength, 0)
})

test('the desktop queue persists to disk before replying and restores download routes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-queue-test-'))
  try {
    const filename = join(directory, 'watch-queue.json')
    const update = createFileWatchQueue(filename)
    const video = { videoId: 'download', title: 'Saved video', route: { path: '/watch/download', query: { downloadId: '42' } } }
    await update({ type: 'addVideoToWatchQueue', payload: { video } })
    const restored = await createFileWatchQueue(filename)({})
    assert.deepEqual(restored.items.map(({ queueItemId, ...item }) => item), [video])
    await update({ type: 'clearWatchQueue' })
    assert.deepEqual((await createFileWatchQueue(filename)({})).items, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('repeated download removals from every window write the queue once', async () => {
  let writes = 0
  const update = createSharedWatchQueue({
    read: () => [{ videoId: 'download', route: { query: { downloadId: '42' } } }, { videoId: 'other' }],
    write() { writes++ },
  })
  const snapshots = await Promise.all([1, 2, 3].map(() => update({ type: 'removeYtDlpDownload', payload: 42 })))
  assert.deepEqual(snapshots.map(snapshot => snapshot.revision), [1, 1, 1])
  assert.deepEqual(snapshots[2].items.map(item => item.videoId), ['other'])
  assert.equal(writes, 1)
})

test('a restore request waits for pending queue writes so quitting can drain them', async () => {
  let finishWrite
  let saved = []
  const update = createSharedWatchQueue({
    read: () => saved,
    write: items => new Promise(resolve => { finishWrite = () => { saved = items; resolve() } }),
  })
  await update({})
  const write = update({ type: 'addVideoToWatchQueue', payload: { video: { videoId: 'last' } } })
  let drained = false
  const drain = update({}).then(() => { drained = true })
  await settle()
  assert.equal(drained, false)
  finishWrite()
  await Promise.all([write, drain])
  assert.deepEqual(saved.map(item => item.videoId), ['last'])
})
