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

test('exposes both provider pages when fallback is enabled', () => {
  const withFallback = {
    supportsLocalApi: true,
    backendPreference: 'local',
    backendFallback: true,
  }
  assert.equal(isTrendingAvailable(withFallback), true)
  assert.equal(isMostPopularAvailable(withFallback), true)
})

test('does not expose Trending in builds without the Local API', () => {
  assert.equal(isTrendingAvailable({
    supportsLocalApi: false,
    backendPreference: 'local',
    backendFallback: true,
  }), false)
})

test('filters unavailable navigation items without changing their order', () => {
  assert.deepEqual(filterAvailableNavigationItems(
    ['history', 'stats', 'popular', 'home', 'trending'],
    {
      supportsLocalApi: true,
      backendPreference: 'local',
      backendFallback: false,
      showWatchStats: false,
    }
  ), ['history', 'home', 'trending'])
})
