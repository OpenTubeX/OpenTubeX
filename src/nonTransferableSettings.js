export const NON_TRANSFERABLE_SETTINGS = new Set([
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
  'ytDlpPlaybackAuthMode',
  'ytDlpPlaybackCookiesPath',
  'ytDlpPlaybackCookiesBrowser',
  'ytDlpPlaybackCookiesBrowserProfile',
  'ytDlpPlaybackAlwaysUseCookies',
  'ytDlpSubtitleUseCookies',
  'ytDlpDownloadUseCookies',
  'ytDlpPlaybackCacheMaxEntrySize',
  'ytDlpFfmpegSource',
  'ytDlpFfmpegPath',
  'externalSoftwareUpdateMode',
  // DownloadSettings
  'ytDlpDownloadFolderPath',
  'ytDlpDownloadCustomArgs',
  // Templates carry yt-dlp arguments and output paths, like the two above.
  'ytDlpDownloadTemplates',
  // Others
  'disableSmoothScrolling',
  'useTrayIcon',
  'trayIconPreset',
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
 * The settings that exports and backups include. An Invidious instance URL can
 * contain the server's username and password, which stay on this device.
 * Importing the result on this device keeps them, since the values compare equal.
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, unknown>}
 */
export function getTransferableSettings(settings) {
  const transferable = Object.fromEntries(Object.entries(settings).filter(([key]) => !NON_TRANSFERABLE_SETTINGS.has(key)))
  if (typeof transferable.defaultInvidiousInstance === 'string') {
    transferable.defaultInvidiousInstance = transferable.defaultInvidiousInstance.replace(/^([a-z][\w+.-]*:\/\/)[^/?#]*@/i, '$1')
  }
  return transferable
}
