import { isSeparateProfileSeenMarksSetting } from './subscriptionSeenMarkSettings.js'

// Passwords, keys and account tokens. They are encrypted at rest where the
// system can hold the key, and never leave this device.
export const SECRET_SETTINGS = new Set([
  'youTubeAccount',
  'proxyPassword',
  'syncServerToken',
  'syncServerPrivacyKey',
  'yatteePassword',
  'invidiousInstanceCredentials',
])

export const NON_TRANSFERABLE_SETTINGS = new Set([
  ...SECRET_SETTINGS,
  // Which profile's own settings show and the shared values they replace,
  // see `profileSettingsState` in the settings store.
  'profileSettingsState',
  // Local migration bookkeeping is not a user preference.
  'historyWatchedStatusMigrated',
  'channelSettingsSyncMigration',
  'controlBarButtonsMigration',
  // Backup locations and schedules belong to this device.
  'scheduledBackupEnabled',
  'scheduledBackupFolderPath',
  'scheduledBackupInterval',
  'scheduledBackupKeepCount',
  'scheduledBackupStatus',
  // Installed fonts are specific to the current operating system.
  'appFont',
  // Diagnostic logging is for troubleshooting this device.
  'diagnosticLogging',
  // Media servers depend on the current internet connection.
  'alwaysUseBackupMediaServer',
  /* Depends on process.env.IS_ELECTRON */
  // ProxySettings
  'useProxy',
  'proxyProtocol',
  'proxyHostname',
  'proxyPort',
  'proxyUsername',
  'proxyPassword',
  'videoIpBlockScriptPath',
  // ExternalPlayerSettings
  'externalPlayer',
  'externalPlayerExecutable',
  // Approved in a native dialog on this device.
  'externalPlayerApprovedArgs',
  'externalPlayerIgnoreWarnings',
  'externalPlayerIgnoreDefaultArgs',
  'externalPlayerCustomArgs',
  'showAddedExternalPlayerCustomArgs',
  // ExternalSoftwareSettings
  'videoPlaybackEngine',
  'playbackEngineFallback',
  'ytDlpSource',
  'ytDlpChannel',
  'ytDlpPath',
  // The YouTube account is signed in on this device only.
  'youTubeAccount',
  'youTubeAccountSyncSubscriptions',
  'youTubeAccountSyncPlaylists',
  'youTubeAccountSyncState',
  'youTubeAccountWatchHistory',
  'youTubeAccountVideoRatings',
  'youTubeAccountReplyNotifications',
  'ytDlpPlaybackAuthMode',
  'ytDlpPlaybackCookiesPath',
  'ytDlpPlaybackCookiesBrowser',
  'ytDlpPlaybackCookiesBrowserProfile',
  'ytDlpCookieUses',
  'ytDlpPlaybackCacheMaxEntrySize',
  'ytDlpFfmpegSource',
  'ytDlpFfmpegPath',
  'externalSoftwareUpdateMode',
  // DownloadSettings
  'ytDlpDownloadFolderPath',
  'ytDlpDownloadCustomArgs',
  // Templates carry yt-dlp arguments and output paths, like the two above.
  'ytDlpDownloadTemplates',
  // It can name a custom template, which only exists here.
  'ytDlpSelectedTemplate',
  // Others
  'disableSmoothScrolling',
  'useTrayIcon',
  'trayIconPreset',
  'appIconPreset',
  'hideToTrayOnClose',
  'hideToTrayOnMinimize',
  'settingsPassword',
  'screenshotAskPath',
  'screenshotFolderPath',
  'syncServerEnabled',
  'syncServerUrl',
  'syncServerUsername',
  'syncServerToken',
  'syncServerDeviceId',
  'syncServerDeviceName',
  'syncServerWatchStatsReset',
  'syncServerScopedWatchStatsResets',
  'syncServerPrivacyMode',
  'syncServerPrivacyKey',
  'syncServerPrivacySalt',
  'syncServerAutoSync',
  'syncServerResumeAutoSync',
  'syncServerSyncSubscriptions',
  'syncServerSyncPlaylists',
  'syncServerSyncHistory',
  'syncServerSyncWatchStats',
  'syncServerSyncLiveReminders',
  'syncServerSyncNotifications',
  'syncServerSyncProfiles',
  'syncServerSyncSessions',
  'syncServerSharedTabs',
  'syncServerSyncSettings',
  'syncServerSettingsExcluded',
  'syncServerSettingUpdatedAt',
  'syncServerLastSyncAt',
  'syncServerSnapshot',
  'syncServerActivityClearedThrough',
  'subscriptionSeenVideos',
  'subscriptionSeenPosts',
  'rssFeedSeenItems',

  /* Depends on process.env.SUPPORTS_LOCAL_API */
  'backendFallback',
  'backendPreference',
  'proxyVideos',
  // Server credentials belong to this device.
  'yatteeServerUrl',
  'yatteeUsername',
  'yatteePassword',
  'yatteeProxyVideos',
])

/**
 * The settings that exports and backups include.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function getTransferableSettings(settings) {
  // Separate profiles' seen marks stay on this device like the shared ones.
  // Profiles' own settings are saved under their profile, see `profileSettingsId`.
  const transferable = Object.fromEntries(Object.entries(settings)
    .filter(([key]) => !NON_TRANSFERABLE_SETTINGS.has(key) && !isSeparateProfileSeenMarksSetting(key) &&
      !key.startsWith('profileSettings-')))
  // Saving splits credentials off, but not off a URL that does not parse, such as one with an invalid port.
  if (typeof transferable.defaultInvidiousInstance === 'string') {
    transferable.defaultInvidiousInstance = transferable.defaultInvidiousInstance.trim()
      // URLs ignore tabs and line breaks
      .replaceAll(/[\t\n\r]/g, '')
      .replace(/^([a-z][\w+.-]*:[/\\]*)[^/\\?#]*@/i, '$1')
  }
  return transferable
}
