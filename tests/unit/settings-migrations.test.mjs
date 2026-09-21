import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { DEFAULT_NAVIGATION_ITEMS } from '../../src/navigationItems.js'
import {
  migrateLegacySettings,
  migrateStoredAiVideoSummarySetting,
  migrateSyncServerUrl,
} from '../../src/renderer/helpers/settings-migrations.js'

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

test('migrates the legacy AI video summary visibility preference', () => {
  assert.deepEqual(migrateLegacySettings({ hideAiVideoSummaries: true }), {
    aiVideoSummaryMode: 'hide',
  })
  assert.deepEqual(migrateLegacySettings({ hideAiVideoSummaries: false }), {
    aiVideoSummaryMode: 'collapsed',
  })
})

test('prefers the current AI video summary mode', () => {
  assert.deepEqual(migrateLegacySettings({
    hideAiVideoSummaries: true,
    aiVideoSummaryMode: 'expanded',
  }), {
    aiVideoSummaryMode: 'expanded',
  })
})

test('keeps the stored legacy AI summary preference when replacement persistence fails', async () => {
  let deletedLegacySetting = false

  await assert.rejects(migrateStoredAiVideoSummarySetting({
    legacyValue: false,
    hasCurrentSetting: false,
    saveCurrentSetting: async () => { throw new Error('write failed') },
    deleteLegacySetting: async () => { deletedLegacySetting = true },
  }), /write failed/)

  assert.equal(deletedLegacySetting, false)
})

test('removes the stored legacy AI summary preference after replacement persistence', async () => {
  let savedMode = null
  let deletedLegacySetting = false

  await migrateStoredAiVideoSummarySetting({
    legacyValue: false,
    hasCurrentSetting: false,
    saveCurrentSetting: async mode => { savedMode = mode },
    deleteLegacySetting: async () => { deletedLegacySetting = true },
  })

  assert.equal(savedMode, 'collapsed')
  assert.equal(deletedLegacySetting, true)
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

test('migrates the public sync server while preserving account and encryption settings', () => {
  for (const syncServerUrl of ['https://sync.d3sox.me', 'https://sync.d3sox.me/', 'https://SYNC.D3SOX.ME:443/']) {
    const settings = {
      syncServerUrl,
      syncServerToken: 'existing-token',
      syncServerUsername: 'existing-user',
      syncServerPrivacyKey: 'existing-key',
      syncServerDeviceId: 'existing-device',
      syncServerEnabled: false,
    }
    const migrated = migrateLegacySettings(settings)
    assert.deepEqual(migrated, { ...settings, syncServerUrl: 'https://sync.opentubex.org' })
    assert.equal(settings.syncServerUrl, syncServerUrl)
    assert.deepEqual(migrateLegacySettings(migrated), migrated)
  }
})

test('preserves custom sync servers and does not add an absent server setting', () => {
  for (const syncServerUrl of [
    'https://sync.opentubex.org', 'https://sync.libretube.dev',
    'https://sync.d3sox.me/custom', 'https://sync.d3sox.me:8443',
    'https://sync.d3sox.me.example.org', 'https://sync.d3sox.me?custom=1',
    'https://user:password@sync.d3sox.me', '', null,
  ]) {
    assert.deepEqual(migrateLegacySettings({ syncServerUrl }), { syncServerUrl })
  }
  assert.deepEqual(migrateLegacySettings({}), {})
})

test('startup persists the new sync URL and retries after a failed write without clearing the session', async () => {
  const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
  const start = source.indexOf('      for (const { _id, value } of userSettings)')
  const end = source.indexOf('      const hasNavigationItems', start)
  assert.ok(start >= 0 && end > start)
  const stored = {
    syncServerUrl: 'https://sync.d3sox.me',
    syncServerToken: 'existing-token',
    syncServerPrivacyKey: 'existing-key',
    syncServerDeviceId: 'existing-device',
  }
  let failWrite = true
  let writes = 0
  const run = async () => {
    const loaded = {}
    await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      userSettings: Object.entries(stored).map(([_id, value]) => ({ _id, value })),
      mutationIds: Object.keys(stored),
      defaultMutationId: key => key,
      settingsWithSideEffects: [],
      migrateSyncServerUrl,
      DBSettingHandlers: {
        async upsert(key, value) {
          writes++
          if (failWrite) throw new Error('write failed')
          stored[key] = value
        },
      },
      commit: (key, value) => { loaded[key] = value },
      console: { error() {} },
    })
    assert.deepEqual(loaded, stored)
    return loaded
  }
  assert.equal((await run()).syncServerUrl, 'https://sync.d3sox.me')
  failWrite = false
  assert.equal((await run()).syncServerUrl, 'https://sync.opentubex.org')
  assert.equal((await run()).syncServerUrl, 'https://sync.opentubex.org')
  assert.equal(writes, 2)
  assert.equal(stored.syncServerToken, 'existing-token')
  assert.equal(stored.syncServerPrivacyKey, 'existing-key')
  assert.equal(stored.syncServerDeviceId, 'existing-device')
})
