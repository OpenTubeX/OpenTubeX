import { computed, watch } from 'vue'

import store from '../../../store/index'
import { setAndroidAutoPictureInPicture } from '../../../helpers/androidUi'
import {
  applyFocusState,
  applyMinimizedState,
  applyPictureInPictureState,
  BLUR_TRIGGER_RECHECK_DELAY_MS,
  createAutoPictureInPictureState,
  markPictureInPictureRequested,
  markPictureInPictureRequestFailed,
  resolveAndroidAutoPictureInPictureUpdate,
  resolveAutoPictureInPictureAction,
  shouldAutoPictureInPicture
} from './autoPictureInPictureState'

/**
 * OpenTubeX tab-awareness and automatic Picture-in-Picture behavior.
 *
 * @param {{
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   props: { format: string },
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   tabId?: string | null,
 *   isTabPresented?: import('vue').ComputedRef<boolean> | null,
 *   initialState?: {
 *     minimized?: boolean,
 *     focused?: boolean,
 *     autoPipActive?: boolean,
 *     pendingPipTarget?: boolean | null,
 *     blurTriggerArmed?: boolean,
 *     pictureInPictureDismissed?: boolean
 *   } | null
 * }} options
 */
export function useAutoPictureInPicture({
  getUi,
  props,
  video,
  tabId = null,
  isTabPresented = null,
  initialState = null
}) {
  const isActiveTab = computed(() => {
    return isTabPresented?.value !== false
  })
  const autoPictureInPictureTriggers = computed(() => store.getters.getAutoPictureInPictureTriggers)
  const androidAutoPictureInPicture = computed(() => store.getters.getAndroidAutoPictureInPicture)

  const triggerOnTabChange = computed(() => autoPictureInPictureTriggers.value.includes('tab'))
  const triggerOnMinimize = computed(() => autoPictureInPictureTriggers.value.includes('minimize'))
  const triggerOnBlur = computed(() => autoPictureInPictureTriggers.value.includes('blur'))
  const autoPipEnabled = computed(() => autoPictureInPictureTriggers.value.length > 0)

  // In Electron the minimized state is driven by native window events (see setup below),
  // because `document.hidden` doesn't fire on minimize on Wayland. On the web we fall back
  // to `document.hidden`, which also covers browser-tab switches.
  const state = createAutoPictureInPictureState(initialState ?? {
    minimized: process.env.IS_ELECTRON ? false : document.hidden,
    focused: document.hasFocus()
  })
  let stopActiveTabWatch = null
  let removeMinimizedListener = null
  let removeFocusedListener = null
  let blurTriggerRecheckTimeout = null

  function canAutoPipNow() {
    if (!autoPipEnabled.value || props.format === 'audio') return false

    const videoElement = video.value
    return !!videoElement && !videoElement.ended && (!videoElement.paused || state.autoPipActive)
  }

  function shouldAutoPipNow() {
    return shouldAutoPictureInPicture(state, {
      canAutoPip: canAutoPipNow(),
      isActiveTab: isActiveTab.value,
      triggerOnTabChange: triggerOnTabChange.value,
      triggerOnMinimize: triggerOnMinimize.value,
      triggerOnBlur: triggerOnBlur.value
    })
  }

  function triggerPipToggle() {
    if (process.env.IS_ELECTRON && window.ftElectron?.requestPiP) {
      window.ftElectron.requestPiP(tabId)
      return true
    }

    const ui = getUi()
    if (!ui) return false

    try {
      ui.getControls().togglePiP()
      return true
    } catch (error) {
      console.warn('Auto Picture-in-Picture: togglePiP failed', error)
      return false
    }
  }

  function updateAutoPip() {
    if (process.env.IS_CAPACITOR) {
      const videoElement = video.value
      const enabled = resolveAndroidAutoPictureInPictureUpdate(
        isActiveTab.value,
        androidAutoPictureInPicture.value,
        props.format,
        videoElement
      )
      if (enabled === null) return
      setAndroidAutoPictureInPicture(
        enabled,
        videoElement
      ).catch(error => console.warn('Failed to configure Android auto Picture-in-Picture:', error))
      return
    }

    const ui = getUi()
    if (!ui) return

    const controls = ui.getControls?.()
    if (!controls) return

    const action = resolveAutoPictureInPictureAction(state, {
      wantPip: shouldAutoPipNow(),
      inPip: controls.isPiPEnabled()
    })

    if (action === 'enter') {
      if (!controls.isPiPAllowed()) return

      markPictureInPictureRequested(state, true)
      if (!triggerPipToggle()) {
        markPictureInPictureRequestFailed(state)
      }
    } else if (action === 'exit') {
      markPictureInPictureRequested(state, false)
      if (!triggerPipToggle()) {
        markPictureInPictureRequestFailed(state)
      }
    }
  }

  function refreshFocusState() {
    applyFocusState(state, document.hasFocus())
    updateAutoPip()
  }

  function refreshVisibilityState() {
    state.windowMinimized = document.hidden
    applyFocusState(state, document.hasFocus())
    updateAutoPip()
  }

  function handleMinimizedState(minimized) {
    applyMinimizedState(state, minimized)
    if (!minimized) {
      // The blur trigger stays disarmed until the document is focused again. Re-check
      // shortly after in case the restore doesn't emit a focus event at all.
      clearBlurTriggerRecheck()
      blurTriggerRecheckTimeout = setTimeout(() => {
        blurTriggerRecheckTimeout = null
        refreshFocusState()
      }, BLUR_TRIGGER_RECHECK_DELAY_MS)
    }
    updateAutoPip()
  }

  function handleFocusedState(focused) {
    applyFocusState(state, focused)
    updateAutoPip()
  }

  function clearBlurTriggerRecheck() {
    if (blurTriggerRecheckTimeout != null) {
      clearTimeout(blurTriggerRecheckTimeout)
      blurTriggerRecheckTimeout = null
    }
  }

  function initializeActiveTab() {
    applyFocusState(state, document.hasFocus())
    if (!process.env.IS_ELECTRON) {
      state.windowMinimized = document.hidden
    }
    updateAutoPip()
  }

  function setupAutoPictureInPicture() {
    if (process.env.IS_CAPACITOR) {
      video.value?.addEventListener('play', updateAutoPip)
      video.value?.addEventListener('pause', updateAutoPip)
      video.value?.addEventListener('ended', updateAutoPip)
      updateAutoPip()
    } else if (process.env.IS_ELECTRON) {
      removeMinimizedListener = window.ftElectron?.handleWindowMinimizedState?.(handleMinimizedState) ?? null
      removeFocusedListener = window.ftElectron?.handleWindowFocusedState?.(handleFocusedState) ?? null
    } else {
      document.addEventListener('visibilitychange', refreshVisibilityState)
      window.addEventListener('focus', refreshFocusState)
      window.addEventListener('blur', refreshFocusState)
    }
    stopActiveTabWatch = watch(isActiveTab, updateAutoPip)
  }

  /**
   * Reports an observed Picture-in-Picture transition of this player.
   *
   * @param {boolean} inPip
   */
  function notifyPictureInPictureState(inPip) {
    if (applyPictureInPictureState(state, inPip)) {
      updateAutoPip()
    }
  }

  /**
   * Restores PiP without letting an active automatic trigger request a second
   * toggle before Chromium reports the first one.
   *
   * @param {boolean} automatic
   */
  function restorePictureInPicture(automatic) {
    markPictureInPictureRequested(state, true, { automatic })
    if (!triggerPipToggle()) {
      markPictureInPictureRequestFailed(state)
    }
  }

  function getAutoPictureInPictureState() {
    return {
      minimized: state.windowMinimized,
      focused: state.windowFocused,
      autoPipActive: state.autoPipActive,
      pendingPipTarget: state.pendingPipTarget,
      blurTriggerArmed: state.blurTriggerArmed,
      pictureInPictureDismissed: state.pictureInPictureDismissed
    }
  }

  function teardownAutoPictureInPicture() {
    if (process.env.IS_CAPACITOR) {
      video.value?.removeEventListener('play', updateAutoPip)
      video.value?.removeEventListener('pause', updateAutoPip)
      video.value?.removeEventListener('ended', updateAutoPip)
      if (isActiveTab.value) {
        setAndroidAutoPictureInPicture(false, video.value).catch(() => {})
      }
    } else if (process.env.IS_ELECTRON) {
      removeMinimizedListener?.()
      removeMinimizedListener = null
      removeFocusedListener?.()
      removeFocusedListener = null
    } else {
      document.removeEventListener('visibilitychange', refreshVisibilityState)
      window.removeEventListener('focus', refreshFocusState)
      window.removeEventListener('blur', refreshFocusState)
    }
    clearBlurTriggerRecheck()
    stopActiveTabWatch?.()
    stopActiveTabWatch = null
  }

  watch(autoPictureInPictureTriggers, updateAutoPip)
  watch(androidAutoPictureInPicture, updateAutoPip)

  return {
    getAutoPictureInPictureState,
    initializeActiveTab,
    isActiveTab,
    notifyPictureInPictureState,
    restorePictureInPicture,
    setupAutoPictureInPicture,
    teardownAutoPictureInPicture,
    updateAutoPip,
  }
}
