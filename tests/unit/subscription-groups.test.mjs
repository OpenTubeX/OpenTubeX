import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterSubscriptionsByGroup,
  normalizeSubscriptionGroups,
  sortSubscribedChannels,
  sortSubscriptionGroups,
  SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS
} from '../../src/renderer/helpers/subscription-groups.js'
import { moveItemByVisibleOffset } from '../../src/orderedItems.js'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

test('synced groups keep only well-formed entries and unique channel IDs', () => {
  assert.deepEqual(normalizeSubscriptionGroups(null), [])
  assert.deepEqual(normalizeSubscriptionGroups('[]'), [])
  assert.deepEqual(normalizeSubscriptionGroups([
    { id: 'music', name: ' Music ', channelIds: ['UCa', 'UCa', '', 3, 'UCb'] },
    { id: 'music', name: 'Duplicate ID', channelIds: [] },
    { id: 'blank', name: '   ', channelIds: [] },
    { id: '', name: 'No ID', channelIds: [] },
    { id: 'no-channels', name: 'No Channels' },
    null,
    'group',
  ]), [
    { id: 'music', name: 'Music', channelIds: ['UCa', 'UCb'] },
    { id: 'no-channels', name: 'No Channels', channelIds: [] },
  ])
})

test('groups are listed by name', () => {
  const groups = [
    { id: 'b', name: 'gaming', channelIds: [] },
    { id: 'c', name: 'Group 10', channelIds: [] },
    { id: 'a', name: 'Group 2', channelIds: [] },
  ]
  assert.deepEqual(sortSubscriptionGroups(groups, collator).map(group => group.id), ['b', 'a', 'c'])
})

test('a group limits subscriptions to its channels without changing their order', () => {
  const subscriptions = [{ id: 'UCa' }, { id: 'UCb' }, { id: 'UCc' }]
  assert.equal(filterSubscriptionsByGroup(subscriptions, null), subscriptions)
  assert.deepEqual(
    filterSubscriptionsByGroup(subscriptions, { id: 'g', name: 'G', channelIds: ['UCc', 'UCa', 'UCx'] }),
    [{ id: 'UCa' }, { id: 'UCc' }]
  )
})

test('subscribed channels sort by name or the saved custom order', () => {
  const channels = [
    { id: 'UCc', name: 'charlie' },
    { id: 'UCa', name: 'Alpha' },
    { id: 'UCn', name: 'New' },
    { id: 'UCb', name: 'Bravo' },
    { id: 'UCm', name: 'Missing name' },
  ]
  const ids = sortBy => sortSubscribedChannels(channels, sortBy, ['UCb', 'UCgone', 'UCc', 'UCa'], collator)
    .map(channel => channel.id)

  assert.deepEqual(ids(SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS.NameAscending), ['UCa', 'UCb', 'UCc', 'UCm', 'UCn'])
  assert.deepEqual(ids(SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS.NameDescending), ['UCn', 'UCm', 'UCc', 'UCb', 'UCa'])
  // Channels missing from the saved order, such as new subscriptions, come last by name
  assert.deepEqual(ids(SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS.Custom), ['UCb', 'UCc', 'UCa', 'UCm', 'UCn'])
  assert.deepEqual(ids('unknown'), ['UCa', 'UCb', 'UCc', 'UCm', 'UCn'])
})

test('moving a channel within a group keeps hidden channels in place', () => {
  const order = ['UCa', 'UChidden', 'UCb', 'UCc']
  const visible = ['UCa', 'UCb', 'UCc']
  assert.deepEqual(moveItemByVisibleOffset(order, visible, 'UCc', -1), ['UCa', 'UChidden', 'UCc', 'UCb'])
  assert.deepEqual(moveItemByVisibleOffset(order, visible, 'UCa', 1), ['UChidden', 'UCb', 'UCa', 'UCc'])
})
