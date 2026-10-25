import { computed, onBeforeUnmount, ref, watch } from 'vue'

import store from '../../../store/index'
import { isThumbnailPreviewImageUsable } from '../../../helpers/thumbnailPreview.js'

const THUMBNAIL_PREVIEW_DELAY = 250

/**
 * Shows a card's animated thumbnail after the pointer rests on it. The image is
 * preloaded on hover and only replaces the static thumbnail once it decoded.
 *
 * @param {{ getData: () => { thumbnailPreviewUrl?: unknown }, getAppearance: () => string, thumbnailPreference: import('vue').ComputedRef<string> }} options
 */
export function useThumbnailHoverPreview({ getData, getAppearance, thumbnailPreference }) {
  const thumbnailPreviewActive = ref(false)
  const thumbnailPreviewLoaded = ref(false)
  let thumbnailPreviewLoader = null
  let thumbnailPreviewLoaderUrl = null
  let thumbnailPreviewTimer = null

  const thumbnailPreviewUrl = computed(() => {
    if (
      !store.getters.getShowThumbnailPreviews ||
      thumbnailPreference.value === 'hidden' ||
      getAppearance() === 'youtubeShort'
    ) {
      return null
    }

    const previewUrl = getData().thumbnailPreviewUrl
    return typeof previewUrl === 'string'
      ? previewUrl
      : null
  })

  function clearThumbnailPreviewTimer() {
    if (thumbnailPreviewTimer !== null) {
      clearTimeout(thumbnailPreviewTimer)
      thumbnailPreviewTimer = null
    }
  }

  function startThumbnailPreview() {
    clearThumbnailPreviewTimer()

    const previewUrl = thumbnailPreviewUrl.value
    if (!previewUrl) {
      return
    }

    if (thumbnailPreviewLoaderUrl !== previewUrl) {
      const loader = new Image()
      thumbnailPreviewLoader = loader
      thumbnailPreviewLoaderUrl = previewUrl
      thumbnailPreviewLoaded.value = false

      loader.onload = () => {
        if (
          thumbnailPreviewLoader === loader &&
          thumbnailPreviewUrl.value === previewUrl
        ) {
          if (isThumbnailPreviewImageUsable(loader)) {
            thumbnailPreviewLoaded.value = true
          } else {
            resetThumbnailPreview()
          }
        }
      }
      loader.onerror = () => {
        if (thumbnailPreviewLoader === loader) {
          thumbnailPreviewLoader = null
          thumbnailPreviewLoaderUrl = null
          thumbnailPreviewLoaded.value = false
        }
      }
      loader.src = previewUrl
    }

    thumbnailPreviewTimer = setTimeout(() => {
      thumbnailPreviewTimer = null
      if (thumbnailPreviewUrl.value === previewUrl) {
        thumbnailPreviewActive.value = true
      }
    }, THUMBNAIL_PREVIEW_DELAY)
  }

  function stopThumbnailPreview() {
    clearThumbnailPreviewTimer()
    thumbnailPreviewActive.value = false
  }

  function resetThumbnailPreview() {
    stopThumbnailPreview()
    if (thumbnailPreviewLoader !== null) {
      thumbnailPreviewLoader.onload = null
      thumbnailPreviewLoader.onerror = null
    }
    thumbnailPreviewLoader = null
    thumbnailPreviewLoaderUrl = null
    thumbnailPreviewLoaded.value = false
  }

  watch(thumbnailPreviewUrl, resetThumbnailPreview)
  onBeforeUnmount(resetThumbnailPreview)

  return {
    thumbnailPreviewActive,
    thumbnailPreviewLoaded,
    thumbnailPreviewUrl,
    startThumbnailPreview,
    stopThumbnailPreview,
    resetThumbnailPreview
  }
}
