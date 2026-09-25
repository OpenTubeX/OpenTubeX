import assert from 'node:assert/strict'
import test from 'node:test'

import { createSubscriptionRefreshStorage } from '../../src/renderer/helpers/subscriptionRefreshStorage.js'

const prefix = 'opentubex.subscriptionAutoRefresh.'

function setup(profiles = [{ _id: 'first/profile' }, { _id: 'second' }], blocked = false) {
  const data = new Map()
  const storage = blocked
    ? {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') },
        removeItem: () => { throw new Error('blocked') },
      }
    : {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key),
      }
  const context = createSubscriptionRefreshStorage({
    storage,
    getProfiles: () => profiles,
    tabs: ['videos', 'shorts', 'live', 'posts'],
    legacyPrefix: prefix,
    deadlinePrefix: `${prefix}deadline.`,
    completionPrefix: `${prefix}completed.`,
  })
  return { data, context }
}

test('refresh deadlines use encoded profile keys and keep each profile isolated', () => {
  const { data, context } = setup()
  context.setStoredSubscriptionTabNextAutoRefreshTimestamp('first/profile', 'videos', 100)
  context.setStoredSubscriptionTabNextAutoRefreshTimestamp('second', 'videos', 200)
  assert.equal(context.getStoredSubscriptionTabNextAutoRefreshTimestamp('first/profile', 'videos'), 100)
  assert.equal(context.getStoredSubscriptionTabNextAutoRefreshTimestamp('second', 'videos'), 200)
  const firstKey = `${prefix}deadline.first%2Fprofile/videos`
  assert.equal(data.get(firstKey), '100')
  assert.deepEqual({ ...context.parseSubscriptionAutoRefreshStorageKey(firstKey, `${prefix}deadline.`) }, {
    profileId: 'first/profile', tab: 'videos',
  })
  assert.equal(context.parseSubscriptionAutoRefreshStorageKey(`${prefix}deadline.first%ZZ/videos`, `${prefix}deadline.`), null)
  assert.equal(context.parseSubscriptionAutoRefreshStorageKey(`${prefix}deadline.first%2Fprofile/unknown`, `${prefix}deadline.`), null)
})

test('legacy deadlines fill only missing profile deadlines and remove the old key', () => {
  const { data, context } = setup()
  data.set(`${prefix}videos`, '120')
  context.setStoredSubscriptionTabNextAutoRefreshTimestamp('second', 'videos', 240)
  context.migrateLegacySubscriptionAutoRefreshDeadlines()
  assert.equal(context.getStoredSubscriptionTabNextAutoRefreshTimestamp('first/profile', 'videos'), 120)
  assert.equal(context.getStoredSubscriptionTabNextAutoRefreshTimestamp('second', 'videos'), 240)
  assert.equal(data.has(`${prefix}videos`), false)
})

test('blocked storage leaves refresh scheduling usable for the current session', () => {
  const { context } = setup(undefined, true)
  assert.equal(context.getStoredSubscriptionTabNextAutoRefreshTimestamp('first/profile', 'videos'), null)
  assert.doesNotThrow(() => context.setStoredSubscriptionTabNextAutoRefreshTimestamp('first/profile', 'videos', 100))
  assert.doesNotThrow(() => context.migrateLegacySubscriptionAutoRefreshDeadlines())
})
