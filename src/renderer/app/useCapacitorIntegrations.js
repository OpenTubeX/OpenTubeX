import { nextTick, ref, watch } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { AppShortcuts } from '@capawesome/capacitor-app-shortcuts'

import store from '../store/index'
import { setAndroidAppActive, setAndroidAppVisible } from '../helpers/appVisibility.js'
import { createAppShortcuts, getAppShortcutPath } from '../helpers/appShortcuts'
import { getHomeWidgetPage } from '../helpers/homeWidgetData'
import { syncContinueWatchingWidget } from '../helpers/homeWidgets'
import { playbackScreenWake } from '../helpers/playbackScreenWake'
import { isAndroidLauncherReturnInProgress } from '../helpers/androidUi'
import { initializeAndroidBack } from '../helpers/androidBack'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'
import { extractSharedYoutubeLink } from '../helpers/sharedYoutubeLink'
import { openInternalPath, showToast } from '../helpers/utils'
import { initializeCapacitorLiveReminderActions } from '../helpers/liveReminders'
import {
  addAndroidMediaSessionActionListener,
  shouldPauseAndroidPlaybackOnAppStateChange,
} from '../helpers/androidMediaSession'
import { tabMediaCoordinator } from '../tabs/TabMediaCoordinator'

/**
 * Native integrations of the Capacitor apps: app and home widget URLs, app
 * shortcuts, the Android Back button, live reminder and media session actions,
 * app state changes, and YouTube links shared to the app.
 *
 * @param {{
 *   t: (key: string) => string,
 *   locale: import('vue').Ref<string>,
 *   dataReady: import('vue').Ref<boolean>,
 *   isAnyPromptOpen: import('vue').ComputedRef<boolean>,
 *   handleYoutubeLink: (href: string) => Promise<void>,
 *   handleAndroidBack: () => Promise<void>,
 *   getAndroidBackPreview: () => object | null,
 *   shouldInterceptAndroidBack: () => boolean
 * }} options
 */
export function useCapacitorIntegrations({
  t,
  locale,
  dataReady,
  isAnyPromptOpen,
  handleYoutubeLink,
  handleAndroidBack,
  getAndroidBackPreview,
  shouldInterceptAndroidBack
}) {
  const sharedYoutubeLink = ref(null)
  let sharedYoutubeLinkId = 0

  async function handleAndroidSharedText(text) {
    const id = ++sharedYoutubeLinkId
    const url = extractSharedYoutubeLink(text)
    let info = null
    try {
      info = url ? await store.dispatch('getYoutubeUrlInfo', url) : null
    } catch (error) {
      console.error('Unable to resolve shared YouTube link', error)
    }
    if (id !== sharedYoutubeLinkId) return
    sharedYoutubeLink.value = null
    if (!info || ['invalid_url', 'unknown'].includes(info.urlType) || (info.urlType === 'video' && !/^[\w-]{11}$/.test(info.videoId))) {
      showToast({ message: t('Share.No YouTube Link'), icon: ['fas', 'circle-exclamation'] })
      return
    }
    sharedYoutubeLink.value = { id, url, videoId: info.videoId ?? '' }
  }

  function openSharedYoutubeLink() {
    const url = sharedYoutubeLink.value?.url
    sharedYoutubeLink.value = null
    if (url) handleYoutubeLink(url)
  }

  async function enableCapacitorIntegrations() {
    const openUrl = async url => {
      if (!url) return
      const widgetPage = getHomeWidgetPage(url)
      if (widgetPage) {
        await store.dispatch('hideSettingsWindow')
        if (widgetPage.route) return openInternalPath(widgetPage.route)
        const focusSearch = () => {
          if (document.getElementById('app')?.inert) {
            // The startup splash keeps the app inert until it is hidden.
            document.addEventListener('startup-splash-hidden', focusSearch, { once: true })
          } else {
            window.dispatchEvent(new CustomEvent('opentubex:focus-search'))
          }
        }
        // A cold start opens the URL before the top navigation is mounted, and
        // open prompts make it inert, so its search cannot take focus yet.
        const canFocusSearch = () => dataReady.value && !isAnyPromptOpen.value
        if (canFocusSearch()) {
          focusSearch()
        } else {
          const stop = watch(canFocusSearch, ready => {
            if (!ready) return
            stop()
            // Let the update render and mount the top navigation first.
            nextTick(focusSearch)
          })
        }
        return
      }
      // iOS URL handling can remove the embedded protocol's colon.
      const target = url.replace(/^opentubex(?:-nightly)?:(?:\/\/)?/, '').replace(/^(https?)\/\//, '$1://')
      return handleYoutubeLink(target)
    }
    const backButtonHandle = Capacitor.getPlatform() === 'android'
      ? await CapacitorApp.addListener('backButton', handleAndroidBack)
      : null
    const removeAndroidBack = Capacitor.getPlatform() === 'android'
      ? await initializeAndroidBack({
          back: handleAndroidBack,
          getPreview: getAndroidBackPreview,
          shouldIntercept: shouldInterceptAndroidBack
        }).catch(error => {
          console.error('Unable to enable predictive back', error)
          return null
        })
      : null
    const urlHandle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      openUrl(url)
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
      AppShortcuts.set({ shortcuts: supportsYtDlp ? shortcuts : shortcuts.filter(shortcut => shortcut.id !== 'downloads') }).catch(error => console.error('Failed to update app shortcuts', error))
    }, { immediate: true })
    const stopHomeWidgetUpdates = syncContinueWatchingWidget(store, watch)
    const removeReminderActions = await initializeCapacitorLiveReminderActions((videoId) => {
      handleYoutubeLink(`https://www.youtube.com/watch?v=${videoId}`)
    })
    const removeMediaActions = await addAndroidMediaSessionActionListener(({ action, ...details }) => {
      tabMediaCoordinator.dispatchAction(action, details)
    })
    const handleTaskRemoved = () => tabMediaCoordinator.pauseAll()
    window.addEventListener('opentubex:android-task-removed', handleTaskRemoved)
    let receivedAppState = false
    let backgroundStateTimeout = null
    let appStateVersion = 0
    const appStateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (Capacitor.getPlatform() === 'android') setAndroidAppActive(isActive)
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
      if (Capacitor.getPlatform() === 'android') setAndroidAppActive(appState.isActive)
      playbackScreenWake?.setAppActive(appState.isActive)
      setAndroidAppVisible(appState.isActive)
    }
    const launch = await CapacitorApp.getLaunchUrl()
    await openUrl(launch?.url)

    return () => {
      clearTimeout(backgroundStateTimeout)
      stopShortcutUpdates()
      stopHomeWidgetUpdates()
      shortcutHandle.remove()
      backButtonHandle?.remove()
      removeAndroidBack?.()
      urlHandle.remove()
      appStateHandle.remove()
      window.removeEventListener('opentubex:android-task-removed', handleTaskRemoved)
      playbackScreenWake?.setAppActive(false)
      setAndroidAppActive(null)
      setAndroidAppVisible(null)
      removeReminderActions()
      removeMediaActions()
    }
  }

  return {
    sharedYoutubeLink,
    handleAndroidSharedText,
    openSharedYoutubeLink,
    enableCapacitorIntegrations
  }
}
