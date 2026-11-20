import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterAvailableNavigationItems,
  isMostPopularAvailable,
  isTrendingAvailable,
} from '../../src/navigationAvailability.js'

test('exposes only navigation supported by the selected provider', () => {
  const localOnly = {
    supportsLocalApi: true,
    backendPreference: 'local',
    backendFallback: false,
  }
  assert.equal(isTrendingAvailable(localOnly), true)
  assert.equal(isMostPopularAvailable(localOnly), false)

  const invidiousOnly = { ...localOnly, backendPreference: 'invidious' }
  assert.equal(isTrendingAvailable(invidiousOnly), false)
  assert.equal(isMostPopularAvailable(invidiousOnly), true)
})

test('filters unavailable navigation items without changing their order', () => {
  assert.deepEqual(filterAvailableNavigationItems(
    ['history', 'stats', 'popular', 'twitch', 'home', 'trending'],
    {
      supportsLocalApi: true,
      backendPreference: 'local',
      backendFallback: false,
      showWatchStats: false,
      supportsYtDlp: false,
      enableTwitchPage: true,
    }
  ), ['history', 'home', 'trending'])
})

test('shows the Twitch page only where yt-dlp plays it and the user has it on', () => {
  const options = {
    supportsLocalApi: true,
    backendPreference: 'local',
    backendFallback: false,
    showWatchStats: true,
    supportsYtDlp: true,
    enableTwitchPage: true,
  }
  assert.deepEqual(filterAvailableNavigationItems(['home', 'twitch'], options), ['home', 'twitch'])
  assert.deepEqual(filterAvailableNavigationItems(['home', 'twitch'], { ...options, enableTwitchPage: false }), ['home'])
})
