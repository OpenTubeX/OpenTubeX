/**
 * @typedef {'download' | 'subscriptions' | 'playlists' | 'playlistBookmarks' | 'history' | 'watchStats' | 'profiles' | 'sessionsV2' | 'settings' | 'upload' | 'finishing'} SyncStage
 */

/**
 * Build the initial protocol stage order. The sync runner may insert or remove
 * stages later when it learns which collections the server supports.
 *
 * @param {{ syncServerSyncSubscriptions?: boolean, syncServerSyncPlaylists?: boolean, syncServerSyncHistory?: boolean, syncServerSyncWatchStats?: boolean, syncServerSyncProfiles?: boolean, syncServerSyncSessions?: boolean, syncServerSyncSettings?: boolean }} settings
 * @param {{ encrypted: boolean, supportsSessions: boolean }} capabilities
 * @returns {SyncStage[]}
 */
export function getInitialSyncStages(settings, { encrypted, supportsSessions }) {
  return [
    ...(encrypted ? ['download'] : []),
    ...(settings.syncServerSyncSubscriptions ? ['subscriptions'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlists'] : []),
    ...(settings.syncServerSyncPlaylists ? ['playlistBookmarks'] : []),
    ...(settings.syncServerSyncHistory ? ['history'] : []),
    ...(encrypted && settings.syncServerSyncWatchStats ? ['watchStats'] : []),
    ...(settings.syncServerSyncProfiles ? ['profiles'] : []),
    ...(supportsSessions && encrypted && settings.syncServerSyncSessions ? ['sessionsV2'] : []),
    ...(encrypted && settings.syncServerSyncSettings ? ['settings'] : []),
    ...(encrypted ? ['upload'] : []),
    'finishing',
  ]
}
