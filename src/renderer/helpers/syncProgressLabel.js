export function syncProgressLabel(t, stage) {
  const labels = {
    download: t('Settings.Sync Settings.Downloading encrypted data'),
    subscriptions: t('Settings.Sync Settings.Syncing subscriptions'),
    playlists: t('Settings.Sync Settings.Syncing playlists'),
    playlistBookmarks: t('Settings.Sync Settings.Syncing playlists'),
    history: t('Settings.Sync Settings.Syncing history'),
    profiles: t('Settings.Sync Settings.Syncing profiles'),
    sessions: t('Settings.Sync Settings.Syncing open tabs'),
    sessionsV2: t('Settings.Sync Settings.Syncing open tabs'),
    settings: t('Settings.Sync Settings.Syncing settings'),
    upload: t('Settings.Sync Settings.Uploading encrypted data'),
    finishing: t('Settings.Sync Settings.Finishing sync'),
  }
  return labels[stage] ?? t('Settings.Sync Settings.Sync Settings')
}
