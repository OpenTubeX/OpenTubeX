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

const LEGACY_ENCRYPTED_COLLECTIONS = [
  'subscriptions', 'playlists', 'history', 'profiles', 'playlistBookmarks'
]

/**
 * @typedef {{legacy_data: boolean, collections: Array<{collection: string, revision: number}>}} EncryptedSyncManifest
 */

/** Select the collections needed to migrate or sync an encrypted document.
 * @param {{enabled: string[], manifest: EncryptedSyncManifest, hasLegacyEncryptedPayload?: boolean}} options
 * @returns {{upload: string[], download: string[]}}
 */
export function planEncryptedSyncCollections({ enabled, manifest, hasLegacyEncryptedPayload = false }) {
  const migrating = manifest.legacy_data || hasLegacyEncryptedPayload
  const upload = migrating
    ? Array.from(new Set([...enabled, ...LEGACY_ENCRYPTED_COLLECTIONS]))
    : enabled
  const compatibility = [
    ...(manifest.collections.some(entry => entry.collection === 'playbackSpeeds') ? ['playbackSpeeds'] : []),
    ...(enabled.includes('sessionsV2') ? ['sessions'] : []),
  ]
  return { upload, download: Array.from(new Set([...upload, ...compatibility])) }
}
