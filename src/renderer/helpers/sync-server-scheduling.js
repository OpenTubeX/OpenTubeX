let remoteSyncDispatchDepth = 0

// Vuex calls action subscribers synchronously when dispatch starts. Scope this
// marker to that call, not its promise, so concurrent user actions stay local.
export function dispatchRemoteSyncAction(dispatch, ...args) {
  remoteSyncDispatchDepth++
  try {
    return dispatch(...args)
  } finally {
    remoteSyncDispatchDepth--
  }
}

export function isRemoteSyncDispatch() {
  return remoteSyncDispatchDepth > 0
}

export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000

export const SYNC_ACTION_REASONS = new Map([
  ['addChannelToProfiles', 'profilesOrSubscriptions'],
  ['addPlaylist', 'playlists'],
  ['addPlaylists', 'playlists'],
  ['addVideo', 'playlists'],
  ['addVideos', 'playlists'],
  ['createProfile', 'profiles'],
  ['markAllHistoryAsWatched', 'history'],
  ['mergeSubscriptionSeenVideos', 'history'],
  ['mergeSubscriptionSeenPosts', 'history'],
  ['overwriteHistory', 'history'],
  ['removeAllHistory', 'history'],
  ['removeAllPlaylists', 'playlists'],
  ['removeAllVideos', 'playlists'],
  ['removeChannelFromProfiles', 'profilesOrSubscriptions'],
  ['removeFromHistory', 'history'],
  ['removeHistoryOlderThan', 'history'],
  ['removePlaylist', 'playlists'],
  ['removePlaylistBookmark', 'playlists'],
  ['removePlaylists', 'playlists'],
  ['removeProfile', 'profiles'],
  ['removeVideo', 'playlists'],
  ['removeVideos', 'playlists'],
  ['updateHistory', 'history'],
  ['updateSubscriptionHistory', 'history'],
  ['updateCustomThemes', 'settings'],
  ['updateChannelSettings', 'settings'],
  ['updatePlaylist', 'playlists'],
  ['savePlaylistBookmark', 'playlists'],
  ['updateProfile', 'profilesOrSubscriptions'],
  ['updateWatchProgress', 'history'],
  ['recordWatchTime', 'watchStats'],
  ['adjustHistoricalWatchTime', 'watchStats'],
  ['clearWatchStats', 'watchStats'],
])

export const SYNC_MUTATION_REASONS = new Map([
  ['setHistoryEntryScroll', 'sessions'],
  ['setPresentedTab', 'sessions'],
  ['setTabContentTitle', 'sessions'],
  ['setTabNavigation', 'sessions'],
  ['setTabsState', 'sessions'],
  ['setCustomThemes', 'settings'],
  ['updateChannelSettings', 'settings'],
  ['addProfileToList', 'profiles'],
  ['addChannelToProfiles', 'profilesOrSubscriptions'],
  ['removeChannelFromProfiles', 'profilesOrSubscriptions'],
  ['removeProfileFromList', 'profiles'],
  ['upsertProfileToList', 'profilesOrSubscriptions'],
  ['addPlaylist', 'playlists'],
  ['addPlaylists', 'playlists'],
  ['addVideo', 'playlists'],
  ['addVideos', 'playlists'],
  ['removeAllPlaylists', 'playlists'],
  ['removeAllVideos', 'playlists'],
  ['removePlaylist', 'playlists'],
  ['removePlaylists', 'playlists'],
  ['removeVideo', 'playlists'],
  ['removeVideos', 'playlists'],
  ['setPlaylistBookmarks', 'playlists'],
  ['upsertPlaylistToList', 'playlists'],
  ['upsertToHistoryCache', 'history'],
  ['applyHistorySyncChanges', 'history'],
  ['setHistoryCacheSorted', 'history'],
  ['setHistoryCacheById', 'history'],
  ['setSubscriptionSeenVideos', 'history'],
  ['setSubscriptionSeenPosts', 'history'],
  ['removeFromHistoryCacheById', 'history'],
  ['removeMultipleFromHistoryCache', 'history'],
  ['updateRecordWatchProgressInHistoryCache', 'history'],
  ['addWatchTime', 'watchStats'],
  ['setWatchStats', 'watchStats'],
  ['resetWatchStats', 'watchStats'],
])

export function isSyncReasonEnabled(settings, reason) {
  switch (reason) {
    case 'subscriptions':
      return settings.syncServerSyncSubscriptions
    case 'playlists':
      return settings.syncServerSyncPlaylists
    case 'history':
      return settings.syncServerSyncHistory
    case 'watchStats':
      return settings.syncServerPrivacyMode === 'enhanced' && settings.syncServerSyncWatchStats
    case 'liveReminders':
      return settings.syncServerPrivacyMode === 'enhanced' && settings.syncServerSyncLiveReminders
    case 'profiles':
      return settings.syncServerSyncProfiles
    case 'profilesOrSubscriptions':
      return settings.syncServerSyncProfiles || settings.syncServerSyncSubscriptions
    case 'sessions':
      return settings.syncServerPrivacyMode === 'enhanced' &&
        settings.syncServerSyncSessions
    case 'settings':
      return settings.syncServerPrivacyMode === 'enhanced' &&
        settings.syncServerSyncSettings
    case 'data':
    case 'automatic':
      return settings.syncServerSyncSubscriptions ||
        settings.syncServerSyncPlaylists ||
        settings.syncServerSyncHistory ||
        (settings.syncServerPrivacyMode === 'enhanced' && settings.syncServerSyncWatchStats) ||
        (settings.syncServerPrivacyMode === 'enhanced' && settings.syncServerSyncLiveReminders) ||
        settings.syncServerSyncProfiles ||
        (settings.syncServerPrivacyMode === 'enhanced' && (
          settings.syncServerSyncSessions || settings.syncServerSyncSettings
        ))
    default:
      return false
  }
}

export function isRecentSync(lastSyncAt, now = Date.now()) {
  const age = now - lastSyncAt
  return Number.isFinite(lastSyncAt) && lastSyncAt > 0 &&
    age >= 0 && age < AUTO_SYNC_INTERVAL_MS
}
