import assert from 'node:assert/strict'
import test from 'node:test'

import { createSubscriptionRefreshPlatform } from '../../src/renderer/helpers/subscriptionRefreshPlatform.js'

function createStorage() {
  const values = new Map()
  return {
    values,
    setItem: (key, value) => values.set(key, value),
    getItem (key) { return values.get(key) ?? null },
    removeItem: key => values.delete(key),
  }
}

test('web refresh publishes start, progress, and finish through storage', async () => {
  const storage = createStorage()
  const platform = createSubscriptionRefreshPlatform({ runtime: 'web', storage })

  assert.deepEqual(await platform.startNotification(3, 'Videos', 'Cancel'), {
    acquired: true,
    notificationsDenied: false,
  })
  platform.publishStarted({ tab: 'videos', refreshId: 3 })
  assert.deepEqual(JSON.parse(storage.values.get(platform.progressKey)), {
    tab: 'videos', refreshId: 3, percentage: 0,
  })
  platform.publishProgress({ refreshId: 3 }, 52, 'unused')
  assert.equal(JSON.parse(storage.values.get(platform.progressKey)).percentage, 52)
  assert.equal(platform.handlesStorageProgress, true)
  platform.publishFinished()
  assert.equal(storage.values.has(platform.progressKey), false)
})

test('Electron refresh sends progress to its coordinator without storage broadcasts', () => {
  const storage = createStorage()
  const calls = []
  const platform = createSubscriptionRefreshPlatform({
    runtime: 'electron', storage,
    electron: {
      setProgress: (...args) => calls.push(['progress', ...args]),
      backgroundCompleted: value => calls.push(['completed', value]),
    },
  })

  platform.publishStarted({ tab: 'live' })
  platform.publishProgress({ ownerTabId: 'tab-1' }, 40, 'fallback')
  platform.publishProgress({}, 60, 'fallback')
  platform.backgroundCompleted({ profileId: 'profile', feedType: 'live', timestamp: 123 })
  platform.publishFinished()
  assert.deepEqual(calls, [
    ['progress', 'tab-1', 40],
    ['progress', 'fallback', 60],
    ['completed', { profileId: 'profile', feedType: 'live', timestamp: 123 }],
  ])
  assert.equal(storage.values.size, 0)
  assert.equal(platform.handlesStorageProgress, false)
})

test('Android refresh starts and updates notification alongside storage progress', async () => {
  const storage = createStorage()
  const calls = []
  const platform = createSubscriptionRefreshPlatform({
    runtime: 'android', storage,
    android: {
      start: async (...args) => { calls.push(['start', ...args]); return { acquired: false, notificationsDenied: true } },
      update: (...args) => calls.push(['update', ...args]),
    },
  })

  assert.deepEqual(await platform.startNotification(9, 'Live', 'Cancel'), {
    acquired: false, notificationsDenied: true,
  })
  platform.publishStarted({ tab: 'live', refreshId: 9 })
  platform.publishProgress({ refreshId: 9 }, 75, 'unused')
  assert.deepEqual(calls, [['start', 9, 'Live', 'Cancel'], ['update', 9, 75]])
  assert.equal(JSON.parse(storage.values.get(platform.progressKey)).percentage, 75)
})

test('web progress recovery clears stale storage when no refresh lock is held', async () => {
  const storage = createStorage()
  storage.setItem('opentubex.subscriptionAutoRefresh.inProgress', JSON.stringify({ tab: 'videos', percentage: 29 }))
  const platform = createSubscriptionRefreshPlatform({
    runtime: 'web', storage,
    locks: { query: async () => ({ held: [] }) },
    lockName: 'refresh-lock',
  })

  assert.deepEqual(await platform.readInProgress(), {
    inProgress: false, percentage: 0, tab: null,
  })
  assert.equal(storage.values.size, 0)
})

test('Electron delegates background configuration, activity and live state', async () => {
  const calls = []
  const platform = createSubscriptionRefreshPlatform({
    runtime: 'electron', storage: createStorage(),
    electron: {
      configureBackground: async value => { calls.push(value) },
      isInProgress: async () => ({ inProgress: true, percentage: 30, tab: 'posts' }),
    },
    electronTabs: { isActive: async () => false },
  })

  assert.equal(await platform.configureBackground({ intervals: {} }, true), false)
  assert.deepEqual(calls, [{ intervals: {}, enabled: true }])
  assert.equal(await platform.isActive(), false)
  assert.deepEqual(await platform.readInProgress(), {
    inProgress: true, percentage: 30, tab: 'posts',
  })
})
