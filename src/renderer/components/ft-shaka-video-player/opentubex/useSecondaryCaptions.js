import { onBeforeUnmount, ref, watch } from 'vue'
import shaka from 'shaka-player'
import store from '../../../store/index'
import { findCaptionByLocale } from '../../../../captionLanguages'
import { getActiveCueText } from '../../../helpers/player/secondary-captions'
import { getSubtitleRequestUrl } from '../../../helpers/player/subtitleCookies'

/**
 * The secondary caption language the user picked while its settings write is still pending.
 * The store commits the setting only after the write, but text track changes, in this player
 * or in one that replaces it, read it back right away. Shared, so a replacement player sees it too.
 * @type {string | null}
 */
let pendingSecondaryCaptionLocale = null
// Counts the picks, so an earlier write that settles late cannot clear a later pending pick,
// even one of the same language. The settings store skips the commit of a superseded write.
let secondaryCaptionLocalePicks = 0

/**
 * Shows a second caption track below or above the main captions, as Shaka can only display one track.
 * @param {{
 *   container: import('vue').Ref<HTMLElement | null>,
 *   getCaptionTimingOffset: () => number,
 *   getPlayer: () => shaka.Player | null,
 *   props: { captions: { url: string, label: string, language: string, mimeType: string }[] },
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 * }} options
 */
export function useSecondaryCaptions({
  container,
  getCaptionTimingOffset,
  getPlayer,
  props,
  video,
}) {
  const secondaryCaptionText = ref('')
  /** @type {{ url: string, label: string, language: string, mimeType: string } | null} */
  let secondaryCaption = null
  /** @type {import('../../../helpers/player/secondary-captions').SecondaryCaptionCue[]} */
  let secondaryCaptionCues = []
  /** @type {AbortController | null} */
  let secondaryCaptionAbortController = null
  // Follows Shaka's caption area, which makes room for the visible controls and the fullscreen side dock
  const secondaryCaptionsBox = ref({})
  /** @type {ResizeObserver | null} */
  let secondaryCaptionsBoxObserver = null
  /** @type {HTMLElement | null} */
  let observedTextContainer = null
  onBeforeUnmount(() => {
    secondaryCaptionAbortController?.abort()
    secondaryCaptionsBoxObserver?.disconnect()
  })

  function observeSecondaryCaptionsBox() {
    const textContainer = container.value?.querySelector('.shaka-text-container')
    // Shaka replaces the container when it reloads, so follow the current one
    if (!(textContainer instanceof HTMLElement) || textContainer === observedTextContainer) return

    secondaryCaptionsBoxObserver ??= new ResizeObserver(() => {
      if (!observedTextContainer) return
      secondaryCaptionsBox.value = {
        inset: `${observedTextContainer.offsetTop}px auto auto ${observedTextContainer.offsetLeft}px`,
        inlineSize: `${observedTextContainer.offsetWidth}px`,
        blockSize: `${observedTextContainer.offsetHeight}px`,
      }
    })
    secondaryCaptionsBoxObserver.disconnect()
    observedTextContainer = textContainer
    secondaryCaptionsBoxObserver.observe(textContainer)
  }

  /**
   * Shows a second caption track alongside the main captions, Shaka can only display one track itself.
   * @param {{ url: string, label: string, language: string, mimeType: string } | null} caption
   * @param {boolean} [remember] keep the language for later videos
   * @returns {Promise<boolean>}
   */
  async function selectSecondaryCaption(caption, remember = true) {
    secondaryCaptionAbortController?.abort()
    secondaryCaptionAbortController = null
    secondaryCaption = caption
    secondaryCaptionCues = []
    updateSecondaryCaptionText()

    const language = caption?.language ?? ''
    if (remember && language !== getRememberedSecondaryCaptionLocale()) {
      const pick = ++secondaryCaptionLocalePicks
      pendingSecondaryCaptionLocale = language
      store.dispatch('updateSecondaryCaptionLocale', language).finally(() => {
        if (secondaryCaptionLocalePicks === pick) {
          pendingSecondaryCaptionLocale = null
        }
      })
    }

    if (!caption) {
      return true
    }

    const abortController = new AbortController()
    secondaryCaptionAbortController = abortController
    const { signal } = abortController

    try {
      const response = await fetch(await getSubtitleRequestUrl(caption.url, store.getters), { signal })
      if (!response.ok) {
        throw new Error(`Secondary captions request failed with HTTP ${response.status}`)
      }

      const parserFactory = shaka.text.TextEngine.findParser(caption.mimeType)
      const cues = parserFactory().parseMedia(
        new TextEncoder().encode(await response.text()),
        { periodStart: 0, segmentStart: 0, segmentEnd: Infinity, vttOffset: 0 },
        caption.url,
        []
      )

      if (signal.aborted) {
        return false
      }

      secondaryCaptionCues = cues
      updateSecondaryCaptionText()
      return true
    } catch (error) {
      if (signal.aborted) {
        return false
      }
      console.error('Failed to load secondary captions', error)
      secondaryCaption = null
      return false
    } finally {
      if (secondaryCaptionAbortController === abortController) {
        secondaryCaptionAbortController = null
      }
    }
  }

  /** @returns {string} the language of the remembered secondary captions, or an empty string */
  function getRememberedSecondaryCaptionLocale() {
    return pendingSecondaryCaptionLocale ?? store.getters.getSecondaryCaptionLocale
  }

  /**
   * Loads the remembered secondary captions once the main captions are shown for a video.
   */
  function restoreSecondaryCaption() {
    const player = getPlayer()
    const language = getRememberedSecondaryCaptionLocale()
    const activeTrack = player?.getTextTracks().find(track => track.active)

    if (!language || !activeTrack || player.isLive() || (secondaryCaption && props.captions.includes(secondaryCaption))) {
      return
    }

    const caption = findCaptionByLocale(
      props.captions.filter(caption => !isShownAsMainCaption(caption, activeTrack)),
      language
    )

    if (caption) {
      selectSecondaryCaption(caption, false)
    }
  }

  /**
   * @param {{ label: string, language: string }} caption
   * @param {shaka.extern.Track | undefined} activeTrack
   */
  function isShownAsMainCaption(caption, activeTrack) {
    return activeTrack?.language === caption.language && activeTrack.label === caption.label
  }

  function updateSecondaryCaptionText() {
    const activeTrack = secondaryCaptionCues.length > 0 ? getPlayer()?.getTextTracks().find(track => track.active) : undefined

    // Only shown together with the main captions, so turning captions off hides both
    secondaryCaptionText.value = activeTrack && !isShownAsMainCaption(secondaryCaption, activeTrack)
      ? getActiveCueText(secondaryCaptionCues, (video.value?.currentTime ?? 0) - getCaptionTimingOffset())
      : ''

    if (secondaryCaptionText.value) {
      observeSecondaryCaptionsBox()
    }
  }

  watch(() => props.captions, () => {
    if (secondaryCaption && !props.captions.includes(secondaryCaption)) {
      secondaryCaptionAbortController?.abort()
      secondaryCaptionAbortController = null
      secondaryCaption = null
      secondaryCaptionCues = []
      updateSecondaryCaptionText()
    }
  })

  return {
    getSecondaryCaption: () => secondaryCaption,
    isShownAsMainCaption,
    restoreSecondaryCaption,
    secondaryCaptionsBox,
    secondaryCaptionText,
    selectSecondaryCaption,
    updateSecondaryCaptionText,
  }
}
