import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_NAVIGATION_ITEMS,
  navigationItemsFromLegacySettings,
  normalizeNavigationItems,
} from '../../src/navigationItems.js'

test('uses the mobile-first navigation order by default', () => {
  assert.deepEqual(DEFAULT_NAVIGATION_ITEMS, [
    'home',
    'subscriptions',
    'userplaylists',
    'history',
    'subscribedchannels',
    'trending',
    'popular',
    'stats',
  ])
})

test('keeps valid navigation items in the selected order', () => {
  assert.deepEqual(
    normalizeNavigationItems(['history', 'home', 'history', 'removed']),
    ['history', 'home']
  )
})

test('falls back to defaults only for an invalid stored value', () => {
  assert.deepEqual(normalizeNavigationItems(null), DEFAULT_NAVIGATION_ITEMS)
  assert.deepEqual(normalizeNavigationItems([]), [])
})

test('converts the former hide switches to navigation items', () => {
  assert.deepEqual(
    navigationItemsFromLegacySettings({
      hideHome: true,
      hidePlaylists: true,
      hidePopularVideos: false,
      hideTrendingVideos: true,
    }),
    ['subscriptions', 'history', 'subscribedchannels', 'popular', 'stats']
  )
})
