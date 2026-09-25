import assert from 'node:assert/strict'
import test from 'node:test'

import { createSubscriptionRefreshState } from '../../src/renderer/helpers/subscriptionRefreshState.js'

test('subscription refresh progress never regresses within the same feed', () => {
  const current = { inProgress: true, tab: 'videos', progress: 80 }
  const store = {
    getters: {
      get getSubscriptionFeedRefreshInProgress () { return current.inProgress },
      get getSubscriptionFeedRefreshTab () { return current.tab },
      get getSubscriptionFeedRefreshProgress () { return current.progress },
    },
    commit (name, value) {
      if (name === 'setSubscriptionFeedRefreshInProgress') current.inProgress = value
      if (name === 'setSubscriptionFeedRefreshTab') current.tab = value
      if (name === 'setSubscriptionFeedRefreshProgress') current.progress = value
    },
  }
  const { applyState } = createSubscriptionRefreshState(store)
  applyState({ inProgress: true, tab: 'videos', percentage: 40 })
  assert.equal(current.progress, 80)
  applyState({ inProgress: true, tab: 'shorts', percentage: 30 })
  assert.equal(current.progress, 30)
  applyState({ inProgress: false, percentage: 999 })
  assert.deepEqual(current, { inProgress: false, tab: null, progress: 100 })
})

test('subscription storage progress handles malformed and out-of-range values', () => {
  const { parseStorageProgress } = createSubscriptionRefreshState({ getters: {}, commit: () => {} })
  assert.equal(parseStorageProgress(null), null)
  assert.equal(parseStorageProgress('{broken'), null)
  assert.deepEqual(parseStorageProgress('{"tab":"live","percentage":-5}'), {
    tab: 'live', percentage: 0,
  })
})
