import assert from 'node:assert/strict'
import test from 'node:test'

import { forgetChannel, getRecentChannel, rememberChannel, startChannelLoad } from '../../src/renderer/helpers/recentPlatformChannels.js'

const channel = { id: 'channel', name: 'Channel' }
const page = title => ({ results: [{ kind: 'item', item: { title } }], continuation: null })
const title = id => getRecentChannel('peertube', id)?.pages.videos.results[0].item.title

test('keeps pages of a reloaded channel, not those of loads that started before', (t) => {
  // In the same millisecond, and with more channels saved than the cache keeps
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const before = startChannelLoad()
  rememberChannel('peertube', 'a', channel, { videos: page('old') }, before)

  forgetChannel('peertube', 'a')
  assert.equal(title('a'), undefined)
  for (let index = 0; index < 20; index++) rememberChannel('peertube', `other-${index}`, channel, {}, startChannelLoad())
  // Another view's request that started before the reload
  rememberChannel('peertube', 'a', channel, { videos: page('old') }, before)
  assert.equal(title('a'), undefined)

  const reload = startChannelLoad()
  rememberChannel('peertube', 'a', channel, { videos: page('new') }, reload)
  rememberChannel('peertube', 'a', channel, { videos: page('old') }, before)
  assert.equal(title('a'), 'new')
})

test('lets channel pages expire with their first load', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const load = startChannelLoad()
  rememberChannel('peertube', 'b', channel, { videos: page('first') }, load)

  t.mock.timers.tick(6 * 60_000)
  assert.equal(title('b'), undefined)
  // A page the view loaded later doesn't make it new again
  rememberChannel('peertube', 'b', channel, { videos: page('later') }, load)
  assert.equal(title('b'), undefined)
})
