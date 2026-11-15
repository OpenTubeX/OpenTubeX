import assert from 'node:assert/strict'
import test from 'node:test'

import { forgetChannel, getRecentChannel, rememberChannel } from '../../src/renderer/helpers/recentPlatformChannels.js'

const channel = { id: 'channel', name: 'Channel' }
const page = title => ({ results: [{ kind: 'item', item: { title } }], continuation: null })

test('keeps pages of a reloaded channel, not those of views that loaded it before', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const before = Date.now()
  rememberChannel('peertube', 'a', channel, { videos: page('old') }, before)

  t.mock.timers.tick(1000)
  forgetChannel('peertube', 'a')
  assert.equal(getRecentChannel('peertube', 'a'), null)
  // Another view's request that started before the reload
  rememberChannel('peertube', 'a', channel, { videos: page('old') }, before)
  assert.equal(getRecentChannel('peertube', 'a'), null)

  rememberChannel('peertube', 'a', channel, { videos: page('new') }, Date.now())
  assert.equal(getRecentChannel('peertube', 'a').pages.videos.results[0].item.title, 'new')
})

test('lets channel pages expire with their first load', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const loadedAt = Date.now()
  rememberChannel('peertube', 'b', channel, { videos: page('first') }, loadedAt)

  t.mock.timers.tick(6 * 60_000)
  assert.equal(getRecentChannel('peertube', 'b'), null)
  // A page the view loaded later doesn't make it new again
  rememberChannel('peertube', 'b', channel, { videos: page('first'), clips: page('later') }, loadedAt)
  assert.equal(getRecentChannel('peertube', 'b'), null)
})
