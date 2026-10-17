import assert from 'node:assert/strict'
import test from 'node:test'
import { startMemoryPressureMonitor } from '../../src/renderer/helpers/memoryPressure.js'

test('unloads tabs only above half the heap limit and waits for memory to be reclaimed', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] })
  let usedHeapSize = 1000
  const notifications = []
  let unloadCount = 0
  const stop = startMemoryPressureMonitor({
    getHeapStatistics: () => ({ usedHeapSize, heapSizeLimit: 4000 }),
    unloadTabs: async () => ++unloadCount,
    notify: count => notifications.push(count)
  })
  t.after(stop)
  const tick = async (ms = 30_000) => {
    t.mock.timers.tick(ms)
    await new Promise(resolve => setImmediate(resolve))
  }

  await tick()
  assert.equal(unloadCount, 0)

  usedHeapSize = 2500
  await tick()
  assert.deepEqual(notifications, [1])

  await tick()
  assert.equal(unloadCount, 1, 'waits for the unloaded pages to be garbage collected')

  await tick(2 * 60_000)
  assert.deepEqual(notifications, [1, 2])
})
