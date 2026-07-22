import assert from 'node:assert/strict'
import test from 'node:test'

import { getValidSubscriptionChannels } from '../../src/renderer/helpers/subscription-channels.js'

test('removes empty and malformed subscription entries', () => {
  const subscriptions = new Array(6)
  subscriptions[0] = { id: 'channel-1', name: 'One' }
  subscriptions[2] = null
  subscriptions[3] = { name: 'Missing id' }
  subscriptions[4] = { id: '' }
  subscriptions[5] = { id: 'channel-2' }

  assert.deepEqual(getValidSubscriptionChannels(subscriptions), [
    { id: 'channel-1', name: 'One' },
    { id: 'channel-2' }
  ])
})

test('handles a missing subscriptions array', () => {
  assert.deepEqual(getValidSubscriptionChannels(undefined), [])
})
