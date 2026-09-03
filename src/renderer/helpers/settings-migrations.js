import { navigationItemsFromLegacySettings } from '../../navigationItems.js'

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

  return migratedSettings
}
