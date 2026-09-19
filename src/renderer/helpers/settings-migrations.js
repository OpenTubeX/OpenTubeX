import { navigationItemsFromLegacySettings } from '../../navigationItems.js'

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

  const formerNavigationKeys = [
    'hideHome',
    'hidePopularVideos',
    'hideTrendingVideos',
  ]
  const navigationMigrationKeys = [...formerNavigationKeys, 'hidePlaylists']
  if (
    !Object.hasOwn(migratedSettings, 'navigationItems') &&
    navigationMigrationKeys.some(key => Object.hasOwn(migratedSettings, key))
  ) {
    migratedSettings.navigationItems = navigationItemsFromLegacySettings(migratedSettings)
  }
  for (const key of formerNavigationKeys) delete migratedSettings[key]

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

  if (Object.hasOwn(migratedSettings, 'useVerticalTabBar')) {
    if (!Object.hasOwn(migratedSettings, 'tabBarPosition')) {
      migratedSettings.tabBarPosition = migratedSettings.useVerticalTabBar === true ? 'left' : 'top'
    }
    delete migratedSettings.useVerticalTabBar
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

  return migratedSettings
}
