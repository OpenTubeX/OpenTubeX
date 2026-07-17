import { computed, watch } from 'vue'

import store from '../../../store/index'

/**
 * OpenTubeX tab-awareness and automatic Picture-in-Picture behavior.
 *
 * @param {{
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   props: { format: string },
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   tabId?: string | null,
 *   isTabPresented?: import('vue').ComputedRef<boolean> | null
 * }} options
 */
export function useAutoPictureInPicture({ getUi, props, video, tabId = null, isTabPresented = null }) {
  const isActiveTab = computed(() => {
    return !process.env.IS_ELECTRON || isTabPresented?.value === true
  })
  const autoPictureInPictureTriggers = computed(() => store.getters.getAutoPictureInPictureTriggers)

  const triggerOnTabChange = computed(() => autoPictureInPictureTriggers.value.includes('tab'))
  const triggerOnMinimize = computed(() => autoPictureInPictureTriggers.value.includes('minimize'))
  const triggerOnBlur = computed(() => autoPictureInPictureTriggers.value.includes('blur'))
  const autoPipEnabled = computed(() => autoPictureInPictureTriggers.value.length > 0)

  let autoPipActive = false
  // In Electron the minimized state is driven by native window events (see setup below),
  // because `document.hidden` doesn't fire on minimize on Wayland. On the web we fall back
  // to `document.hidden`, which also covers browser-tab switches.
  let windowMinimized = process.env.IS_ELECTRON ? false : document.hidden
  let windowFocused = document.hasFocus()
  let stopActiveTabWatch = null
  let removeMinimizedListener = null

  function shouldAutoPipNow() {
    if (!autoPipEnabled.value || props.format === 'audio') return false

    const videoElement = video.value
    if (!videoElement || videoElement.ended || (videoElement.paused && !autoPipActive)) return false

    // An in-app tab change is handled by the 'tab' trigger. Window minimize / blur only
    // apply while this is the presented tab, so background tabs don't spuriously enter PiP.
    const active = isActiveTab.value
    const tabHidden = triggerOnTabChange.value && !active
    const minimized = active && triggerOnMinimize.value && windowMinimized
    const blurred = active && triggerOnBlur.value && !windowFocused

    return tabHidden || minimized || blurred
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
    const ui = getUi()
    if (!ui) return

    const controls = ui.getControls?.()
    if (!controls) return

    const wantPip = shouldAutoPipNow()
    const inPip = controls.isPiPEnabled()

    if (wantPip && !inPip) {
      if (!controls.isPiPAllowed()) return

      autoPipActive = true
      if (!triggerPipToggle()) {
        autoPipActive = false
      }
    } else if (!wantPip && inPip && autoPipActive) {
      triggerPipToggle()
      autoPipActive = false
    }
  }

  function refreshFocusState() {
    windowFocused = document.hasFocus()
    updateAutoPip()
  }

  function refreshVisibilityState() {
    windowMinimized = document.hidden
    windowFocused = document.hasFocus()
    updateAutoPip()
  }

  function handleMinimizedState(minimized) {
    windowMinimized = minimized
    updateAutoPip()
  }

  function initializeActiveTab() {
    windowFocused = document.hasFocus()
    if (!process.env.IS_ELECTRON) {
      windowMinimized = document.hidden
    }
    updateAutoPip()
  }

  function setupAutoPictureInPicture() {
    if (process.env.IS_ELECTRON) {
      removeMinimizedListener = window.ftElectron?.handleWindowMinimizedState?.(handleMinimizedState) ?? null
    } else {
      document.addEventListener('visibilitychange', refreshVisibilityState)
    }
    window.addEventListener('focus', refreshFocusState)
    window.addEventListener('blur', refreshFocusState)
    stopActiveTabWatch = watch(isActiveTab, updateAutoPip)
  }

  function resetAutoPictureInPictureOwnership() {
    autoPipActive = false
  }

  function teardownAutoPictureInPicture() {
    if (process.env.IS_ELECTRON) {
      removeMinimizedListener?.()
      removeMinimizedListener = null
    } else {
      document.removeEventListener('visibilitychange', refreshVisibilityState)
    }
    window.removeEventListener('focus', refreshFocusState)
    window.removeEventListener('blur', refreshFocusState)
    stopActiveTabWatch?.()
    stopActiveTabWatch = null
  }

  watch(autoPictureInPictureTriggers, updateAutoPip)

  return {
    initializeActiveTab,
    isActiveTab,
    resetAutoPictureInPictureOwnership,
    setupAutoPictureInPicture,
    teardownAutoPictureInPicture,
    updateAutoPip,
  }
}
