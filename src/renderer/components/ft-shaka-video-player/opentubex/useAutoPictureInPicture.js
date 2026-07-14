import { computed, ref, watch } from 'vue'

import store from '../../../store/index'

/**
 * OpenTubeX tab-awareness and automatic Picture-in-Picture behavior.
 *
 * @param {{
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   props: { format: string },
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useAutoPictureInPicture({ getUi, props, video }) {
  const isActiveTab = ref(!process.env.IS_ELECTRON)
  const autoPictureInPictureOnTabChange = computed(() => store.getters.getAutoPictureInPictureOnTabChange)

  let autoPipActive = false
  let tabVisible = !document.hidden
  /** @type {(() => void) | null} */
  let activeTabChangedCleanup = null

  function shouldAutoPipNow() {
    if (!autoPictureInPictureOnTabChange.value || props.format === 'audio') return false

    const videoElement = video.value
    if (!videoElement || videoElement.ended || (videoElement.paused && !autoPipActive)) return false

    return !tabVisible
  }

  function triggerPipToggle() {
    if (process.env.IS_ELECTRON && window.ftElectron?.requestPiP) {
      window.ftElectron.requestPiP()
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

  function handleDocumentVisibilityChange() {
    tabVisible = !document.hidden
    updateAutoPip()
  }

  async function initializeActiveTab() {
    if (!process.env.IS_ELECTRON || !window.ftElectron?.tabs?.isActive) return

    try {
      const active = await window.ftElectron.tabs.isActive()
      isActiveTab.value = active
      tabVisible = active
    } catch (error) {
      console.error('Failed to get active tab state for video autoplay:', error)
    }
  }

  function setupAutoPictureInPicture() {
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange)

    if (!process.env.IS_ELECTRON || !window.ftElectron?.tabs?.onActiveChanged) return

    try {
      activeTabChangedCleanup = window.ftElectron.tabs.onActiveChanged((active) => {
        isActiveTab.value = active
        tabVisible = active
        updateAutoPip()
      })
    } catch (error) {
      console.error('Failed to set up active tab listener for auto PiP:', error)
    }
  }

  function resetAutoPictureInPictureOwnership() {
    autoPipActive = false
  }

  function teardownAutoPictureInPicture() {
    document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)

    if (activeTabChangedCleanup) {
      activeTabChangedCleanup()
      activeTabChangedCleanup = null
    }
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
