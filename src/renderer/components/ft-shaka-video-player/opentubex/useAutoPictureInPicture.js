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
  const autoPictureInPictureOnTabChange = computed(() => store.getters.getAutoPictureInPictureOnTabChange)

  let autoPipActive = false
  let tabVisible = isActiveTab.value && !document.hidden
  let stopActiveTabWatch = null

  function shouldAutoPipNow() {
    if (!autoPictureInPictureOnTabChange.value || props.format === 'audio') return false

    const videoElement = video.value
    if (!videoElement || videoElement.ended || (videoElement.paused && !autoPipActive)) return false

    return !tabVisible
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

  function updateTabVisibility() {
    tabVisible = isActiveTab.value && !document.hidden
    updateAutoPip()
  }

  function initializeActiveTab() {
    updateTabVisibility()
  }

  function setupAutoPictureInPicture() {
    document.addEventListener('visibilitychange', updateTabVisibility)
    stopActiveTabWatch = watch(isActiveTab, updateTabVisibility)
  }

  function resetAutoPictureInPictureOwnership() {
    autoPipActive = false
  }

  function teardownAutoPictureInPicture() {
    document.removeEventListener('visibilitychange', updateTabVisibility)
    stopActiveTabWatch?.()
    stopActiveTabWatch = null
  }

  watch(autoPictureInPictureOnTabChange, updateAutoPip)

  return {
    initializeActiveTab,
    isActiveTab,
    resetAutoPictureInPictureOwnership,
    setupAutoPictureInPicture,
    teardownAutoPictureInPicture,
    updateAutoPip,
  }
}
