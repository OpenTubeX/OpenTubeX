import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_NAVIGATION_ITEMS } from '../../src/navigationItems.js'
import { migrateLegacySettings } from '../../src/renderer/helpers/settings-migrations.js'

test('migrates an enabled legacy subscription progress notification preference', () => {
  assert.deepEqual(migrateLegacySettings({ showSubscriptionRefreshToast: true }), {
    showProgressBarToast: true,
  })
})

test('migrates the legacy subscription progress notification preference', () => {
  assert.deepEqual(migrateLegacySettings({ showSubscriptionRefreshToast: false }), {
    showProgressBarToast: false,
  })
})

test('prefers the current progress notification preference', () => {
  assert.deepEqual(migrateLegacySettings({
    showSubscriptionRefreshToast: false,
    showProgressBarToast: true,
  }), {
    showProgressBarToast: true,
  })
})

test('preserves the old live chat visibility choice for replays', () => {
  assert.deepEqual(migrateLegacySettings({ hideLiveChat: true }), {
    hideLiveChat: true,
    hideLiveChatReplay: true,
  })
})

test('prefers an explicit live chat replay visibility choice', () => {
  assert.deepEqual(migrateLegacySettings({
    hideLiveChat: true,
    hideLiveChatReplay: false,
  }), {
    hideLiveChat: true,
    hideLiveChatReplay: false,
  })
})

test('migrates the legacy vertical tab bar preference to the left layout', () => {
  assert.deepEqual(migrateLegacySettings({ useVerticalTabBar: true }), {
    tabBarPosition: 'left',
  })
})

test('prefers an explicit tab bar position over the legacy preference', () => {
  assert.deepEqual(migrateLegacySettings({
    useVerticalTabBar: true,
    tabBarPosition: 'right',
  }), {
    tabBarPosition: 'right',
  })
})

test('inverts the legacy Downloads placement preference', () => {
  assert.deepEqual(migrateLegacySettings({ moveDownloadsToQuickSettings: false }), {
    moveDownloadsToAppHeader: true,
  })
  assert.deepEqual(migrateLegacySettings({ moveDownloadsToQuickSettings: true }), {
    moveDownloadsToAppHeader: false,
  })
})

test('prefers the current Downloads placement preference', () => {
  assert.deepEqual(migrateLegacySettings({
    moveDownloadsToQuickSettings: false,
    moveDownloadsToAppHeader: false,
  }), {
    moveDownloadsToAppHeader: false,
  })
})

test('migrates navigation visibility switches to an ordered list', () => {
  assert.deepEqual(migrateLegacySettings({
    hideHome: true,
    hidePlaylists: false,
    hidePopularVideos: true,
    hideTrendingVideos: false,
  }), {
    hidePlaylists: false,
    navigationItems: [
      'subscriptions',
      'userplaylists',
      'history',
      'subscribedchannels',
      'trending',
      'stats',
    ],
  })
})

test('prefers current navigation items over former visibility switches', () => {
  assert.deepEqual(migrateLegacySettings({
    navigationItems: ['history'],
    hideHome: false,
  }), {
    navigationItems: ['history'],
  })
})

test('keeps Hide Playlists because it also controls playlist actions', () => {
  assert.deepEqual(migrateLegacySettings({
    hidePlaylists: true,
  }), {
    hidePlaylists: true,
    navigationItems: DEFAULT_NAVIGATION_ITEMS.filter(id => id !== 'userplaylists'),
  })
})
