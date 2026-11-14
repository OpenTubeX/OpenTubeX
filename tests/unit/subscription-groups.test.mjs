import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addChannelsToNamedGroups,
  filterSubscriptionsByGroup,
  normalizeSubscriptionGroups,
  sortSubscribedChannels,
  SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS
} from '../../src/renderer/helpers/subscription-groups.js'
import { moveItemByVisibleOffset } from '../../src/orderedItems.js'
import { parseTakeoutSubscriptions } from '../../src/renderer/helpers/import-preview.js'

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

test('group edits apply to the saved groups, so edits from other windows and devices stay', async () => {
  const { readFile } = await import('node:fs/promises')
  const vm = await import('node:vm')
  const source = await readFile(new URL('../../src/renderer/store/modules/subscription-groups.js', import.meta.url), 'utf8')
  const start = source.indexOf('const actions = {')
  const actions = vm.runInNewContext(`${source.slice(start, source.indexOf('\nconst mutations', start))}\nactions`, {
    normalizeSubscriptionGroups,
    crypto,
  })
  let saved = []
  // Every window's store reads and writes the same saved groups
  const store = { state: {}, commit() {}, dispatch: async (action, update) => { saved = update(saved); return true } }

  const id = await actions.createSubscriptionGroup(store, { name: 'Music', channelIds: [] })
  // Two windows that both showed the empty group each add a channel
  await actions.setChannelInSubscriptionGroup(store, { groupId: id, channelId: 'UCa', included: true })
  await actions.setChannelInSubscriptionGroup(store, { groupId: id, channelId: 'UCb', included: true })
  assert.deepEqual(structuredClone(saved).map(group => group.channelIds), [['UCa', 'UCb']])

  // Saving a group that another device deleted meanwhile keeps the edits
  const news = { id: 'news', name: 'News', channelIds: ['UCc'] }
  saved = [news]
  const edited = { id, name: 'Songs', channelIds: ['UCa'] }
  await actions.saveSubscriptionGroup(store, edited)
  assert.deepEqual(structuredClone(saved), [news, edited])
})

test('imported CSV group columns add channels to existing groups and create missing ones', () => {
  const content = [
    'Channel Id,Channel Url,Channel Title,Groups',
    'UCa,https://www.youtube.com/channel/UCa,"Channel, A","tech; Web Design ;"',
    'UCb,https://www.youtube.com/channel/UCb,Channel B,',
    'UCc,https://www.youtube.com/channel/UCc,Channel C,Tech',
  ].join('\r\n')
  const channels = parseTakeoutSubscriptions({ path: 'subscriptions.csv', content })
  assert.deepEqual(channels.map(({ name, groups }) => [name, groups]), [
    ['Channel, A', ['tech', 'Web Design']],
    ['Channel B', []],
    ['Channel C', ['Tech']],
  ])

  let nextId = 0
  const groups = addChannelsToNamedGroups([{ id: 'tech', name: 'Tech', channelIds: ['UCc', 'UCz'], icon: 'code' }], channels, () => `new-${nextId++}`)
  assert.deepEqual(groups, [
    { id: 'tech', name: 'Tech', channelIds: ['UCc', 'UCz', 'UCa'], icon: 'code' },
    { id: 'new-0', name: 'Web Design', channelIds: ['UCa'] },
  ])
})
