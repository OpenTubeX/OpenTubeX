/**
 * Start independent startup reads together. Profile loading waits for settings,
 * while the caller remains free to render as soon as the first phase is ready.
 *
 * @param {object} dependencies
 * @param {{ dispatch: (action: string, value?: string) => Promise<unknown> }} dependencies.store
 * @param {(settingsReady: Promise<unknown>) => Promise<unknown>} dependencies.loadTabs
 * @param {() => Promise<unknown>} dependencies.afterSettings
 * @param {() => Promise<Array<{id: string}>>} dependencies.loadThemes
 * @param {() => Promise<unknown> | undefined} dependencies.preloadInitialRoute
 * @param {string} dependencies.allChannelsLabel
 */
export function initializeApplicationData({
  store, loadTabs, afterSettings, loadThemes, preloadInitialRoute, allChannelsLabel,
}) {
  const settingsReady = store.dispatch('grabUserSettings').then(async tutorialState => {
    await afterSettings()
    return tutorialState
  })
  const tabsReady = loadTabs(settingsReady)
  const themesReady = loadThemes().catch(error => {
    console.error('Failed to load custom theme:', error)
    return []
  })
  const instancesReady = store.dispatch('fetchInvidiousInstancesFromFile')
  const profilesReady = settingsReady.then(() => store.dispatch('grabAllProfiles', allChannelsLabel))

  tabsReady.then(preloadInitialRoute).catch(error => {
    console.error('Failed to preload the initial route', error)
  })

  const startupReady = Promise.all([settingsReady, themesReady, instancesReady, tabsReady])
    .then(([tutorialState, themes]) => ({ tutorialState, themes }))

  return { startupReady, profilesReady }
}

/**
 * Load saved user data before starting synchronization. Search history remains
 * independent because it does not affect the initial application state.
 *
 * @param {{ dispatch: (action: string) => Promise<unknown> }} store
 */
export async function loadPersistentApplicationData(store) {
  const ready = Promise.all([
    store.dispatch('grabHistory'),
    store.dispatch('grabAllPlaylists'),
    store.dispatch('grabAllSubscriptions'),
  ])
  store.dispatch('grabSearchHistoryEntries')
  await ready
  store.dispatch('initializeSyncServer').catch(error => {
    console.error('Initial sync server sync failed', error)
  })
}
