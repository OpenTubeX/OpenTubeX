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
    ['history', 'stats', 'popular', 'home', 'trending'],
    {
      supportsLocalApi: true,
      backendPreference: 'local',
      backendFallback: false,
      showWatchStats: false,
    }
  ), ['history', 'home', 'trending'])
})
