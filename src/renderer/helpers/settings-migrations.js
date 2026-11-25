import { navigationItemsFromLegacySettings } from '../../navigationItems.js'
import { DEFAULT_QUICK_SETTINGS } from './quickSettings.js'

import {
  blockedItemsModeFromSwitches,
  fixedTabWidthFromSwitch,
  FORMER_CHANNEL_SETTING_SWITCHES,
  FORMER_NAVIGATION_SWITCHES,
  isFormerDefaultQuickSettings,
  listFromSwitches,
  REMOVED_SETTINGS,
  SWITCH_LISTS,
  ytDlpPreloadCountFromSwitch,
  holdPlaybackRateMultiplierFromSwitch,
  keepPlayerVisibleOnScrollFromLegacy,
  navigationBarLabelsFromCompactSwitch,
  migrateSettingIds,
  thumbnailDataSaverModeFromSwitch,
  titleLineLimitFromSwitch,
} from '../../datastores/settingsMigrations.js'

export function migrateSyncServerUrl(value) {
  if (typeof value !== 'string') return value
  try {
    const url = new URL(value)
    if (url.origin === 'https://sync.d3sox.me' &&
        url.pathname === '/' && !url.search && !url.hash &&
        !url.username && !url.password) {
      return 'https://sync.opentubex.org'
    }
  } catch {
    // Leave custom or invalid settings untouched.
  }
  return value
}

/**
 * Persists the replacement for the legacy AI summary visibility setting before
 * removing the legacy value. This keeps the old preference recoverable when
 * persistence fails.
 * @param {object} options
 * @param {boolean} options.legacyValue
 * @param {boolean} options.hasCurrentSetting
 * @param {(value: 'hide' | 'collapsed') => Promise<void>} options.saveCurrentSetting
 * @param {() => Promise<void>} options.deleteLegacySetting
 */
export async function migrateStoredAiVideoSummarySetting({
  legacyValue,
  hasCurrentSetting,
  saveCurrentSetting,
  deleteLegacySetting,
}) {
  if (!hasCurrentSetting) {
    await saveCurrentSetting(legacyValue === true ? 'hide' : 'collapsed')
  }
  await deleteLegacySetting()
}

/**
 * Replaces setting keys that were renamed between exported settings formats.
 * Current keys take precedence when an import contains both versions.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function migrateLegacySettings(settings) {
  const migratedSettings = { ...settings }

  if (migratedSettings.landingPage === 'settings') {
    migratedSettings.landingPage = 'subscriptions'
  }

  const navigationMigrationKeys = [...FORMER_NAVIGATION_SWITCHES, 'hidePlaylists']
  if (
    !Object.hasOwn(migratedSettings, 'navigationItems') &&
    navigationMigrationKeys.some(key => Object.hasOwn(migratedSettings, key))
  ) {
    migratedSettings.navigationItems = navigationItemsFromLegacySettings(migratedSettings)
  }
  for (const key of FORMER_NAVIGATION_SWITCHES) delete migratedSettings[key]

  if (Object.hasOwn(migratedSettings, 'enableBlockLists') || Object.hasOwn(migratedSettings, 'blurBlockedItems')) {
    if (!Object.hasOwn(migratedSettings, 'blockedItemsMode')) {
      migratedSettings.blockedItemsMode = blockedItemsModeFromSwitches(
        migratedSettings.enableBlockLists,
        migratedSettings.blurBlockedItems
      )
    }
    delete migratedSettings.enableBlockLists
    delete migratedSettings.blurBlockedItems
  }

  // Exports from before these switches were removed hold both the switch and its value.
  if (Object.hasOwn(migratedSettings, 'useFixedTabWidth')) {
    migratedSettings.fixedTabWidth = fixedTabWidthFromSwitch(migratedSettings.useFixedTabWidth, migratedSettings.fixedTabWidth)
    delete migratedSettings.useFixedTabWidth
  }
  if (Object.hasOwn(migratedSettings, 'ytDlpPreloadEnabled')) {
    migratedSettings.ytDlpPreloadCount = ytDlpPreloadCountFromSwitch(migratedSettings.ytDlpPreloadEnabled, migratedSettings.ytDlpPreloadCount)
    delete migratedSettings.ytDlpPreloadEnabled
  }
  for (const [listKey, switches] of Object.entries(SWITCH_LISTS)) {
    const switchKeys = Object.keys(switches)
    if (!switchKeys.some(key => Object.hasOwn(migratedSettings, key))) continue
    if (!Object.hasOwn(migratedSettings, listKey)) {
      migratedSettings[listKey] = listFromSwitches(listKey, key => migratedSettings[key])
    }
    for (const key of switchKeys) delete migratedSettings[key]
  }
  for (const key of REMOVED_SETTINGS) delete migratedSettings[key]

  if (Object.hasOwn(migratedSettings, 'showSubscriptionRefreshToast')) {
    if (!Object.hasOwn(migratedSettings, 'showProgressBarToast')) {
      migratedSettings.showProgressBarToast = migratedSettings.showSubscriptionRefreshToast === true
    }
    delete migratedSettings.showSubscriptionRefreshToast
  }

  if (
    Object.hasOwn(migratedSettings, 'hideLiveChat') &&
    !Object.hasOwn(migratedSettings, 'hideLiveChatReplay')
  ) {
    migratedSettings.hideLiveChatReplay = migratedSettings.hideLiveChat === true
  }

  if (
    Object.hasOwn(migratedSettings, 'generalAutoLoadMorePaginatedItemsEnabled') &&
    !Object.hasOwn(migratedSettings, 'autoLoadComments')
  ) {
    migratedSettings.autoLoadComments = migratedSettings.generalAutoLoadMorePaginatedItemsEnabled !== false
  }

  if (Object.hasOwn(migratedSettings, 'useVerticalTabBar')) {
    if (!Object.hasOwn(migratedSettings, 'tabBarPosition')) {
      migratedSettings.tabBarPosition = migratedSettings.useVerticalTabBar === true ? 'left' : 'top'
    }
    delete migratedSettings.useVerticalTabBar
  }

  if (!Object.hasOwn(migratedSettings, 'playlistThumbnailSize') && Object.hasOwn(migratedSettings, 'thumbnailSize')) {
    migratedSettings.playlistThumbnailSize = migratedSettings.thumbnailSize
  }

  if (!Object.hasOwn(migratedSettings, 'autoPictureInPictureTriggers')) {
    const enabled = Object.hasOwn(migratedSettings, 'autoPictureInPictureOnTabChange')
      ? migratedSettings.autoPictureInPictureOnTabChange === true
      : Object.hasOwn(migratedSettings, 'autoPictureInPictureMode')
        ? ['tab', 'both'].includes(migratedSettings.autoPictureInPictureMode)
        : null
    if (enabled !== null) migratedSettings.autoPictureInPictureTriggers = enabled ? ['tab', 'minimize'] : []
  }
  if (!Object.hasOwn(migratedSettings, 'keepPlayerVisibleOnScroll')) {
    const legacy = ['scrollPlayerMode', 'scrollMiniPlayerEnabled'].find(key => Object.hasOwn(migratedSettings, key))
    if (legacy) {
      migratedSettings.keepPlayerVisibleOnScroll = keepPlayerVisibleOnScrollFromLegacy(migratedSettings[legacy])
    } else if (Object.hasOwn(migratedSettings, 'autoPictureInPictureMode')) {
      migratedSettings.keepPlayerVisibleOnScroll = migratedSettings.autoPictureInPictureMode !== 'never'
    }
  }
  delete migratedSettings.autoPictureInPictureMode
  delete migratedSettings.autoPictureInPictureOnTabChange

  delete migratedSettings.scrollMiniPlayerEnabled
  delete migratedSettings.scrollMiniPlayerOnAllTabs
  delete migratedSettings.scrollPlayerMode

  if (Object.hasOwn(migratedSettings, 'holdToDoublePlaybackSpeed')) {
    if (!Object.hasOwn(migratedSettings, 'holdPlaybackRateMultiplier')) {
      migratedSettings.holdPlaybackRateMultiplier = holdPlaybackRateMultiplierFromSwitch(migratedSettings.holdToDoublePlaybackSpeed)
    }
    delete migratedSettings.holdToDoublePlaybackSpeed
  }

  if (Object.hasOwn(migratedSettings, 'thumbnailDataSaver')) {
    if (!Object.hasOwn(migratedSettings, 'thumbnailDataSaverMode')) {
      migratedSettings.thumbnailDataSaverMode = thumbnailDataSaverModeFromSwitch(migratedSettings.thumbnailDataSaver)
    }
    delete migratedSettings.thumbnailDataSaver
  }

  if (Object.hasOwn(migratedSettings, 'compactNavigationLabels')) {
    if (!Object.hasOwn(migratedSettings, 'navigationBarLabels')) {
      migratedSettings.navigationBarLabels = navigationBarLabelsFromCompactSwitch(migratedSettings.compactNavigationLabels)
    }
    delete migratedSettings.compactNavigationLabels
  }

  if (Object.hasOwn(migratedSettings, 'moveDownloadsToQuickSettings')) {
    if (!Object.hasOwn(migratedSettings, 'moveDownloadsToAppHeader')) {
      migratedSettings.moveDownloadsToAppHeader = migratedSettings.moveDownloadsToQuickSettings !== true
    }
    delete migratedSettings.moveDownloadsToQuickSettings
  }

  if (Object.hasOwn(migratedSettings, 'hideAiVideoSummaries')) {
    if (!Object.hasOwn(migratedSettings, 'aiVideoSummaryMode')) {
      migratedSettings.aiVideoSummaryMode = migratedSettings.hideAiVideoSummaries === true
        ? 'hide'
        : 'collapsed'
    }
    delete migratedSettings.hideAiVideoSummaries
  }

  if (Object.hasOwn(migratedSettings, 'hideVideoDescription')) {
    if (!Object.hasOwn(migratedSettings, 'videoDescriptionMode')) {
      migratedSettings.videoDescriptionMode = migratedSettings.hideVideoDescription === true
        ? 'hide'
        : 'collapsed'
    }
    delete migratedSettings.hideVideoDescription
  }

  if (Object.hasOwn(migratedSettings, 'limitTitlesToTwoLines')) {
    if (!Object.hasOwn(migratedSettings, 'titleLineLimit')) {
      migratedSettings.titleLineLimit = titleLineLimitFromSwitch(migratedSettings.limitTitlesToTwoLines)
    }
    delete migratedSettings.limitTitlesToTwoLines
  }

  // Saved channel settings are always applied now. Automatic saving only ran
  // while its former switch was on, so it stays off for switches that were off.
  for (const [rememberKey, autoUpdateKey] of FORMER_CHANNEL_SETTING_SWITCHES) {
    if (!Object.hasOwn(migratedSettings, rememberKey)) continue
    if (migratedSettings[rememberKey] !== true && migratedSettings[autoUpdateKey] === true) {
      migratedSettings[autoUpdateKey] = false
    }
    delete migratedSettings[rememberKey]
  }

  if (isFormerDefaultQuickSettings(migratedSettings.quickSettings)) {
    migratedSettings.quickSettings = [...DEFAULT_QUICK_SETTINGS]
  } else if (Object.hasOwn(migratedSettings, 'quickSettings')) {
    migratedSettings.quickSettings = migrateSettingIds(migratedSettings.quickSettings)
  }

  return migratedSettings
}
