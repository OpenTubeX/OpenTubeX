import assert from 'node:assert/strict'
import test from 'node:test'

import { getProfileWithUpdatedSubscriptionDetails } from '../../src/renderer/helpers/subscription-profile-details.js'

test('updates channel details without changing the source profile', () => {
  const profile = {
    _id: 'allChannels',
    subscriptions: [
      { id: 'first', name: 'Old name', thumbnail: 'old-thumbnail' },
      { id: 'second', name: 'Unchanged', thumbnail: '' }
    ]
  }
  const updated = getProfileWithUpdatedSubscriptionDetails(profile, [
    {
      channelId: 'first',
      channelName: 'New name',
      channelThumbnailUrl: 'https://invidious.example/ggpht/avatar=s88'
    }
  ])

  assert.deepEqual(updated, {
    _id: 'allChannels',
    subscriptions: [
      {
        id: 'first',
        name: 'New name',
        thumbnail: 'https://yt3.googleusercontent.com/avatar=s176'
      },
      { id: 'second', name: 'Unchanged', thumbnail: '' }
    ]
  })
  assert.equal(profile.subscriptions[0].name, 'Old name')
  assert.equal(profile.subscriptions[0].thumbnail, 'old-thumbnail')
})

test('preserves ordered duplicate updates and skips an unchanged profile', () => {
  const profile = {
    _id: 'allChannels',
    subscriptions: [{ id: 'channel', name: 'Original', thumbnail: '' }]
  }

  const updated = getProfileWithUpdatedSubscriptionDetails(profile, [
    { channelId: 'channel', channelName: 'First' },
    { channelId: 'channel', channelName: null, channelThumbnailUrl: '' },
    { channelId: 'channel', channelName: 'Final' }
  ])

  assert.equal(updated.subscriptions[0].name, 'Final')
  assert.equal(updated.subscriptions[0].thumbnail, '')
  assert.equal(getProfileWithUpdatedSubscriptionDetails(updated, [
    { channelId: 'channel', channelName: 'Final' }
  ]), null)
})

test('checks each profile subscription once for a large no-op refresh', () => {
  const channelCount = 933
  let idReads = 0
  const subscriptions = Array.from({ length: channelCount }, (_, index) => ({
    get id () {
      idReads++
      return `channel-${index}`
    },
    name: `Channel ${index}`,
    thumbnail: ''
  }))
  const channels = Array.from({ length: channelCount }, (_, index) => ({
    channelId: `channel-${index}`,
    channelName: `Channel ${index}`
  }))

  assert.equal(getProfileWithUpdatedSubscriptionDetails({ subscriptions }, channels), null)
  assert.equal(idReads, channelCount)
})
