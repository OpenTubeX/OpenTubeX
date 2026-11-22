import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SUBSCRIPTION_TABS,
  getVisibleSubscriptionTabs,
  normalizeSubscriptionTabs,
} from '../../src/renderer/helpers/subscriptionTabs.js'

test('keeps a saved order, drops invalid entries and appends missing tabs', () => {
  assert.deepEqual(normalizeSubscriptionTabs(undefined), DEFAULT_SUBSCRIPTION_TABS)
  assert.deepEqual(
    normalizeSubscriptionTabs(['new', 'live', 'videos', 'new', 'unknown', null]),
    ['new', 'live', 'videos', 'shorts', 'community', 'platforms', 'feeds']
  )
})

test('shows the enabled tabs in the saved order', () => {
  const options = {
    hideVideos: false,
    hideShorts: true,
    hideLive: false,
    hideCommunity: false,
    showNewFeed: true,
    enableRssFeeds: false,
    hasFollowedChannels: false,
  }
  assert.deepEqual(
    getVisibleSubscriptionTabs(['new', 'live', 'videos', 'shorts', 'community', 'platforms', 'feeds'], options),
    ['new', 'live', 'videos', 'community']
  )
  // The New feed needs content from another tab, an RSS feed or another platform.
  assert.deepEqual(
    getVisibleSubscriptionTabs(['new', 'feeds'], { ...options, hideVideos: true, hideLive: true, hideCommunity: true }),
    []
  )
  assert.deepEqual(
    getVisibleSubscriptionTabs(['feeds', 'new'], { ...options, hideVideos: true, hideLive: true, hideCommunity: true, enableRssFeeds: true }),
    ['feeds', 'new']
  )
})
