import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { AppShortcuts } from '@capawesome/capacitor-app-shortcuts'
import { watch } from 'vue'

import { createAppShortcuts, getAppShortcutPath } from './appShortcuts.js'
import { setAndroidAppVisible } from './appVisibility.js'
import { isAndroidLauncherReturnInProgress } from './androidUi.js'
import { addAndroidMediaSessionActionListener, shouldPauseAndroidPlaybackOnAppStateChange } from './androidMediaSession.js'
import { initializeCapacitorLiveReminderActions } from './liveReminders.js'
import { playbackScreenWake } from './playbackScreenWake.js'
import { tabMediaCoordinator } from '../tabs/TabMediaCoordinator.js'

// Keep the native integrations together so App.vue only supplies navigation,
// translations, and the settings store they act on. The runtime argument lets
// lifecycle behavior be exercised without a native bridge.
const nativeRuntime = {
  CapacitorApp,
  Capacitor,
  AppShortcuts,
  watch,
  createAppShortcuts,
  getAppShortcutPath,
  setAndroidAppVisible,
  isAndroidLauncherReturnInProgress,
  addAndroidMediaSessionActionListener,
  shouldPauseAndroidPlaybackOnAppStateChange,
  initializeCapacitorLiveReminderActions,
  playbackScreenWake,
  tabMediaCoordinator,
  setTimeout,
  clearTimeout,
}

export async function enableCapacitorIntegrations({
  appWindow,
  locale,
  t,
  store,
  handleAndroidBack,
  handleYoutubeLink,
  openInternalPath,
}, runtime = nativeRuntime) {
  const {
    CapacitorApp, Capacitor, AppShortcuts, watch, createAppShortcuts,
    getAppShortcutPath, setAndroidAppVisible, isAndroidLauncherReturnInProgress,
    addAndroidMediaSessionActionListener, shouldPauseAndroidPlaybackOnAppStateChange,
    initializeCapacitorLiveReminderActions, playbackScreenWake,
    tabMediaCoordinator, setTimeout, clearTimeout,
  } = runtime
  const backButtonHandle = Capacitor.getPlatform() === 'android'
    ? await CapacitorApp.addListener('backButton', handleAndroidBack)
    : null
  const urlHandle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (url) handleYoutubeLink(url)
  })
  const shortcutHandle = await AppShortcuts.addListener('click', async ({ shortcutId }) => {
    const path = getAppShortcutPath(shortcutId)
    if (!path) return
    await store.dispatch('hideSettingsWindow')
    await openInternalPath({ path })
  })
  const stopShortcutUpdates = watch(locale, () => {
    const shortcuts = createAppShortcuts({
      subscriptions: t('Subscriptions.Subscriptions'),
      userplaylists: t('Playlists'),
      history: t('History.History'),
      downloads: t('Settings.Download Settings.Download Settings'),
    })
    AppShortcuts.set({ shortcuts }).catch(error => console.error('Failed to update app shortcuts', error))
  }, { immediate: true })
  const removeReminderActions = await initializeCapacitorLiveReminderActions((videoId) => {
    handleYoutubeLink(`https://www.youtube.com/watch?v=${videoId}`)
  })
  const removeMediaActions = await addAndroidMediaSessionActionListener(({ action, ...details }) => {
    tabMediaCoordinator.dispatchAction(action, details)
  })
  const handleTaskRemoved = () => tabMediaCoordinator.pauseAll()
  appWindow.addEventListener('opentubex:android-task-removed', handleTaskRemoved)
  let receivedAppState = false
  let backgroundStateTimeout = null
  let appStateVersion = 0
  const appStateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    receivedAppState = true
    appStateVersion += 1
    const version = appStateVersion
    playbackScreenWake?.setAppActive(isActive)
    clearTimeout(backgroundStateTimeout)
    if (Capacitor.getPlatform() === 'android' && !isActive) {
      // The launcher briefly stops the PiP Activity while returning to its
      // existing task. Do not hide or pause playback for that handoff.
      const checkBackgroundState = async () => {
        if (await isAndroidLauncherReturnInProgress()) {
          if (version === appStateVersion) {
            backgroundStateTimeout = setTimeout(checkBackgroundState, 10_000)
          }
          return
        }
        const state = await CapacitorApp.getState().catch(() => ({ isActive: false }))
        if (version !== appStateVersion || state.isActive) return
        setAndroidAppVisible(false)
        if (shouldPauseAndroidPlaybackOnAppStateChange(
          false,
          store.getters.getContinuePlaybackWhenScreenIsLocked
        )) tabMediaCoordinator.pauseAll()
      }
      backgroundStateTimeout = setTimeout(checkBackgroundState, 250)
      return
    }
    setAndroidAppVisible(isActive)
    if (shouldPauseAndroidPlaybackOnAppStateChange(
      isActive,
      store.getters.getContinuePlaybackWhenScreenIsLocked
    )) tabMediaCoordinator.pauseAll()
  })
  const appState = await CapacitorApp.getState()
  if (!receivedAppState) {
    playbackScreenWake?.setAppActive(appState.isActive)
    setAndroidAppVisible(appState.isActive)
  }
  const launch = await CapacitorApp.getLaunchUrl()
  if (launch?.url) await handleYoutubeLink(launch.url)

  return () => {
    clearTimeout(backgroundStateTimeout)
    stopShortcutUpdates()
    shortcutHandle.remove()
    backButtonHandle?.remove()
    urlHandle.remove()
    appStateHandle.remove()
    appWindow.removeEventListener('opentubex:android-task-removed', handleTaskRemoved)
    playbackScreenWake?.setAppActive(false)
    setAndroidAppVisible(null)
    removeReminderActions()
    removeMediaActions()
  }
}
