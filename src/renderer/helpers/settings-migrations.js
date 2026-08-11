/**
 * Replaces setting keys that were renamed between exported settings formats.
 * Current keys take precedence when an import contains both versions.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function migrateLegacySettings(settings) {
  const migratedSettings = { ...settings }

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

  return migratedSettings
}
