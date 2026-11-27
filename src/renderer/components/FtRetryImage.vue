<template>
  <!-- Keep a small box for lazy loading without expanding scroll overflow. -->
  <img
    v-bind="{ ...$attrs, ...parentScope }"
    :sizes="srcset ? imageSizes : undefined"
    :srcset="srcset || undefined"
    :src="imageUrl || undefined"
    :alt="$attrs.alt ?? ''"
    :class="{ downloadedContent: showsDownload }"
    :style="hasLoaded ? null : {
      position: 'absolute', visibility: 'hidden', pointerEvents: 'none', inlineSize: '1px', blockSize: '1px'
    }"
    @error="retryImageLoad"
    @load="handleImageLoad"
    @vue:mounted="checkCachedImage"
    @vue:updated="checkCachedImage"
  >
  <FtIcon
    v-if="!hasLoaded && fallbackIcon"
    v-bind="{ ...$attrs, ...parentScope }"
    class="retryImagePlaceholder"
    :class="{ 'ft-shimmer retryImageSkeleton': isLoading && useSkeleton, retryImageAvatar: isLoading && isAvatar }"
    :icon="fallbackIcon"
    aria-hidden="true"
  />
  <span
    v-else-if="!hasLoaded && isLoading"
    v-bind="{ ...$attrs, ...parentScope }"
    class="retryImagePlaceholder retryImageShimmer ft-shimmer"
    aria-hidden="true"
  >
    <!-- Retain the transparent skeleton's intrinsic size without an image
         request; replaced elements cannot host the animated pseudo-element. -->
    <svg
      :width="$attrs.width ?? 320"
      :height="$attrs.height ?? 180"
      viewBox="0 0 320 180"
    />
  </span>
  <img
    v-else-if="!hasLoaded"
    v-bind="{ ...$attrs, ...parentScope }"
    class="retryImagePlaceholder"
    :src="thumbnailPlaceholder"
    alt=""
    aria-hidden="true"
  >
</template>

<script setup>
import { computed, getCurrentInstance, inject, onBeforeUnmount, ref, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import store from '../store/index'
import { getThumbnailVideoId, getVideoThumbnailSource, getVideoThumbnailFallbackUrl, getVideoThumbnailSrcset, isMissingThumbnailPlaceholder, rememberMissingThumbnail, skipMissingThumbnails, thumbnailSizesKey } from '../helpers/videoThumbnail.js'
import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'
import { observeFirstVisible } from '../helpers/firstVisible'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'

defineOptions({ inheritAttrs: false })

// Multiple roots need the caller's scoped styles on both the image and placeholder.
const parentScopeId = getCurrentInstance().vnode.scopeId
const parentScope = parentScopeId ? { [parentScopeId]: '' } : {}

const RETRY_DELAY_MS = 3000
const SKELETON_TIMEOUT_MS = 10_000
const NATIVE_RECOVERY_TIMEOUT_MS = 6000

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  fallbackIcon: {
    type: [Array, String, Object],
    default: null
  },
  /**
   * The slot's rendered width as an `<img sizes>` value. Lets full-resolution
   * video thumbnails load their 320px version where that is sharp enough.
   * Defaults to the value provided by a list, such as a thumbnail grid.
   */
  sizes: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['error', 'load'])

const preferredSource = computed(() => {
  const src = typeof props.src === 'string' ? props.src.trim() : ''
  return skipMissingThumbnails(getVideoThumbnailSource(src.startsWith('//') ? 'https:' + src : src, store.getters.getUseDataSaverThumbnails))
})
const imageUrl = ref(preferredSource.value)
// Thumbnails of downloaded videos, such as those of playlists, keep their colors when grayscale spares downloads.
const showsDownload = computed(() => supportsYtDlp && store.getters.getGrayscaleScope === 'notDownloaded' &&
  store.getters.getEnableDownloads && store.getters.getLocalPlaybackDownloadIds.has(getThumbnailVideoId(preferredSource.value)))
const providedSizes = inject(thumbnailSizesKey, null)
const imageSizes = computed(() => props.sizes ?? providedSizes?.value ?? null)
// Retries keep their query parameter on both candidates.
const srcset = computed(() => imageSizes.value ? getVideoThumbnailSrcset(imageUrl.value) : null)
const hasLoaded = ref(false)
const hasFailed = ref(false)
const isLoading = computed(() => !hasLoaded.value && !hasFailed.value && !!preferredSource.value && preferredSource.value !== thumbnailPlaceholder)
const fallbackIconName = computed(() => Array.isArray(props.fallbackIcon) ? props.fallbackIcon[1] : props.fallbackIcon)
const isAvatar = computed(() => fallbackIconName.value === 'circle-user')
// Keep semantic badges and action icons legible while their images load.
const useSkeleton = computed(() => !['user-check', 'link', 'magnifying-glass'].includes(fallbackIconName.value))
let currentSource = preferredSource.value
let hasRetried = false
let retryPending = false
let retryTimeoutId
let nativeRecoveryTimeoutId
let finishNativeRecovery
let skeletonTimeoutId
/** @type {(() => void) | undefined} */
let stopObservingVisibility
let imageIsVisible = false
let sourceVersion = 0

watch(preferredSource, async (src, _previousSource, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  // Keep a loaded remote image visible while decoding its embedded cached
  // copy. Once decoded, the element hook can reveal it before the next paint.
  if (hasLoaded.value && src.startsWith('data:') && /^https?:/.test(currentSource)) {
    const image = new Image()
    image.src = src
    try {
      await image.decode()
    } catch {
      // Invalid cached images still go through the normal error/fallback path.
    }
    if (cancelled) return
  }
  resetSource(src)
}, { immediate: true })
// Element hooks run after patching, before paint, without a separate watcher.
function checkCachedImage({ el: image }) {
  if (hasLoaded.value || !currentSource) return
  if (!image.complete) {
    // Lazy images can remain unrequested offscreen. Give them their full loading
    // deadline once visible, without restarting it when scrolling away and back.
    if (image.loading !== 'lazy' || imageIsVisible) startLoadingTimeout()
    else if (!stopObservingVisibility) {
      // The first sighting is all the deadline needs. Observers kept alive
      // for every loaded avatar made each rendered frame more expensive, and
      // offscreen images share one observer while they wait.
      stopObservingVisibility = observeFirstVisible(image, () => {
        stopObservingVisibility = undefined
        imageIsVisible = true
        startLoadingTimeout()
      })
    }
    return
  }
  if (image.naturalWidth) {
    image.dispatchEvent(new Event('load'))
  } else if (!hasFailed.value) {
    image.dispatchEvent(new Event('error'))
  }
}

function stopVisibilityObserver() {
  stopObservingVisibility?.()
  stopObservingVisibility = undefined
}

function resetSource(src, isFallback = false) {
  cancelNativeRecovery()
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  sourceVersion++
  hasRetried = false
  retryPending = false
  currentSource = src
  // A replaced lazy source gets its deadline once it is seen, like the first one.
  imageIsVisible = false
  stopVisibilityObserver()
  hasLoaded.value = false
  clearTimeout(skeletonTimeoutId)
  skeletonTimeoutId = undefined
  if (!isFallback) {
    hasFailed.value = false
  }
  imageUrl.value = src
}

function startLoadingTimeout() {
  // Resolution fallbacks get their own deadline even if the skeleton stopped.
  if (hasLoaded.value || retryPending || !currentSource || currentSource === thumbnailPlaceholder || skeletonTimeoutId !== undefined) return
  // Keep the image mounted so a late success can still replace the fallback.
  skeletonTimeoutId = setTimeout(() => {
    hasFailed.value = true
    // A stalled response never fires error. Keep the original request alive
    // while trying native recovery or waiting for the browser retry.
    if (!hasRetried && /^https?:/.test(currentSource)) {
      return recoverImage()
    }
    if (hasRetried && !retryPending) emit('error', new Event('error'))
  }, SKELETON_TIMEOUT_MS)
}

/** @param {boolean} [missing] the server reported that this resolution does not exist */
function useSmallerThumbnail(missing = false) {
  const fallback = getVideoThumbnailFallbackUrl(currentSource)
  if (!fallback) return false

  // Network errors can be temporary, so only a reported placeholder is remembered.
  if (missing) rememberMissingThumbnail(currentSource, fallback)
  resetSource(fallback, true)
  return true
}

function handleImageLoad(event) {
  // YouTube can return a decodable 120x90 placeholder for missing resolutions.
  // A srcset can switch to that candidate after the smaller one loaded.
  const image = event.target
  if (isMissingThumbnailPlaceholder(image) && useSmallerThumbnail(true)) return
  if (hasLoaded.value) return
  clearTimeout(skeletonTimeoutId)
  cancelNativeRecovery()
  stopVisibilityObserver()
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  retryPending = false
  hasLoaded.value = true
  emit('load', event)
}

function addRetryParameter(src) {
  try {
    const url = new URL(src)
    url.searchParams.set('opentubex_retry', Date.now().toString())
    return url.toString()
  } catch {
    const separator = src.includes('?') ? '&' : '?'
    return `${src}${separator}opentubex_retry=${Date.now()}`
  }
}

async function retryImageLoad(event) {
  hasLoaded.value = false
  hasFailed.value = true
  clearTimeout(skeletonTimeoutId)
  if (useSmallerThumbnail()) return

  // Embedded images cannot recover through an HTTP retry or a query parameter.
  if (/^(data|blob):/.test(currentSource)) {
    hasFailed.value = true
    emit('error', event)
    return
  }

  if (hasRetried) {
    if (!retryPending) {
      hasFailed.value = true
      emit('error', event)
    }
    return
  }

  await recoverImage()
}

async function recoverImage() {
  hasRetried = true
  retryPending = true
  const failedSourceVersion = sourceVersion
  const failedSource = currentSource

  if (process.env.IS_CAPACITOR) {
    // Bound the whole recovery, including connections that keep streaming data.
    const deadline = new Promise(resolve => {
      finishNativeRecovery = resolve
      nativeRecoveryTimeoutId = setTimeout(() => resolve(null), NATIVE_RECOVERY_TIMEOUT_MS)
    })
    let dataUrl = null
    try {
      dataUrl = await Promise.race([
        (async () => {
          const { fetchCapacitorAvatarDataUrl } = await import('../helpers/api/capacitor-http')
          return fetchCapacitorAvatarDataUrl(failedSource, store.getters.getCurrentInvidiousInstanceUrl, store.getters.getCurrentInvidiousInstanceAuthorization)
        })(),
        deadline
      ])
    } catch {
      // Native recovery is optional; unexpected failures still get a delayed retry.
    }

    if (failedSourceVersion !== sourceVersion || hasLoaded.value) return
    cancelNativeRecovery()
    if (dataUrl !== null) {
      retryPending = false
      imageUrl.value = dataUrl
      return
    }
  }

  scheduleBrowserRetry()
}

function cancelNativeRecovery() {
  clearTimeout(nativeRecoveryTimeoutId)
  nativeRecoveryTimeoutId = undefined
  finishNativeRecovery?.(null)
  finishNativeRecovery = undefined
}

function scheduleBrowserRetry() {
  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = undefined
    retryPending = false
    clearTimeout(skeletonTimeoutId)
    skeletonTimeoutId = undefined
    imageUrl.value = addRetryParameter(currentSource)
  }, RETRY_DELAY_MS)
}

onBeforeUnmount(() => {
  sourceVersion++
  cancelNativeRecovery()
  stopVisibilityObserver()
  clearTimeout(retryTimeoutId)
  clearTimeout(skeletonTimeoutId)
})
</script>

<style scoped>
.retryImageShimmer {
  display: inline-block;
}

.retryImageShimmer > svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  aspect-ratio: inherit;
}

.retryImagePlaceholder[data-icon='circle-user'] {
  color: var(--tertiary-text-color);
}

.retryImagePlaceholder :deep(.ft-icon__glyph) {
  block-size: 100%;
  inline-size: 100%;
  scale: 1;
}

.retryImageSkeleton :deep(.ft-icon__glyph) {
  visibility: hidden;
}

.retryImageAvatar {
  border-radius: 50%;
}
</style>
