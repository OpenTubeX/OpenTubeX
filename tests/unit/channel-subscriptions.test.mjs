import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/channel-subscriptions.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
  .replaceAll('export ', '')

test('a separate profile subscribes and unsubscribes only itself, without the YouTube account', async () => {
  const channel = 'UCaaaaaaaaaaaaaaaaaaaaaa'
  const profiles = [
    { _id: 'allChannels', subscriptions: [] },
    { _id: 'shared', subscriptions: [{ id: channel }] },
    { _id: 'separate', separate: true, subscriptions: [] },
  ]
  const dispatched = []
  const mirrored = []
  const helpers = vm.runInNewContext(`${source}\n({ subscribeToChannel, unsubscribeFromChannel })`, {
    MAIN_PROFILE_ID: 'allChannels',
    store: {
      getters: { getProfileList: profiles, getSubscribedChannelsById: new Map() },
      dispatch: async (type, payload) => { dispatched.push([type, [...payload.profileIds]]); return true },
    },
    normalizeChannelHandle: () => null,
    normalizeSubscriptionChannelSettings: () => ({ feedTypes: [], notificationFeedTypes: [], showMembersOnly: false }),
    showToast: () => {},
    mirrorYouTubeSubscription: (...args) => mirrored.push(args),
  })
  const t = key => key

  assert.equal(await helpers.subscribeToChannel(profiles[2], { id: channel, name: 'Channel' }, t), true)
  profiles[2].subscriptions.push({ id: channel })
  assert.equal(await helpers.unsubscribeFromChannel(profiles[2], channel, t), true)
  assert.deepEqual(dispatched, [['addChannelToProfiles', ['separate']], ['removeChannelFromProfiles', ['separate']]])
  assert.deepEqual(mirrored, [])

  // Unsubscribing All Channels still unsubscribes the shared profiles and the account.
  dispatched.length = 0
  await helpers.unsubscribeFromChannel(profiles[0], channel, t)
  assert.deepEqual(dispatched, [['removeChannelFromProfiles', ['allChannels', 'shared']]])
  assert.deepEqual(mirrored, [[channel, false]])
})
