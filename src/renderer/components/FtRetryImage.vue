<template>
  <!-- Keep a small box for lazy loading without expanding scroll overflow. -->
  <img
    v-bind="{ ...$attrs, ...parentScope }"
    :src="imageUrl || undefined"
    :alt="$attrs.alt ?? ''"
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
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import store from '../store/index'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl } from '../helpers/videoThumbnail.js'
import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'

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
  }
})

const emit = defineEmits(['error', 'load'])

const preferredSource = computed(() => {
  const src = typeof props.src === 'string' ? props.src.trim() : ''
  return getVideoThumbnailSource(src.startsWith('//') ? 'https:' + src : src, store.getters.getThumbnailDataSaver)
})
const imageUrl = ref(preferredSource.value)
const hasLoaded = ref(false)
const hasFailed = ref(false)
const isLoading = computed(() => !hasLoaded.value && !hasFailed.value && !!preferredSource.value && preferredSource.value !== thumbnailPlaceholder)
const fallbackIconName = computed(() => Array.isArray(props.fallbackIcon) ? props.fallbackIcon[1] : props.fallbackIcon)
const isAvatar = computed(() => fallbackIconName.value === 'circle-user')
// Keep semantic badges and action icons legible while their images load.
const useSkeleton = computed(() => !['user-check', 'link', 'search', 'magnifying-glass'].includes(fallbackIconName.value))
let currentSource = preferredSource.value
let hasRetried = false
let retryPending = false
let retryTimeoutId
let nativeRecoveryTimeoutId
let finishNativeRecovery
let skeletonTimeoutId
let visibilityObserver
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
    else if (!visibilityObserver) {
      visibilityObserver = new IntersectionObserver(entries => {
        imageIsVisible = entries.some(entry => entry.isIntersecting)
        if (imageIsVisible) startLoadingTimeout()
      })
      visibilityObserver.observe(image)
    }
    return
  }
  if (image.naturalWidth) {
    image.dispatchEvent(new Event('load'))
  } else if (!hasFailed.value) {
    image.dispatchEvent(new Event('error'))
  }
}

function resetSource(src, isFallback = false) {
  cancelNativeRecovery()
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  sourceVersion++
  hasRetried = false
  retryPending = false
  currentSource = src
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
  if (hasLoaded.value || !currentSource || currentSource === thumbnailPlaceholder || skeletonTimeoutId !== undefined) return
  // Keep the image mounted so a late success can still replace the fallback.
  skeletonTimeoutId = setTimeout(() => {
    hasFailed.value = true
    // A stalled response never fires error. Keep the original request alive
    // while trying native recovery or waiting for the browser retry.
    if (!hasRetried && /^https?:/.test(currentSource)) {
      return recoverImage()
    }
  }, SKELETON_TIMEOUT_MS)
}

function useSmallerThumbnail() {
  const fallback = getVideoThumbnailFallbackUrl(currentSource)
  if (!fallback) return false

  resetSource(fallback, true)
  return true
}

function handleImageLoad(event) {
  if (hasLoaded.value) return
  // YouTube can return a decodable 120x90 placeholder for missing resolutions.
  const image = event.target
  if (image.naturalWidth === 120 && image.naturalHeight === 90) {
    if (useSmallerThumbnail()) return
  }
  clearTimeout(skeletonTimeoutId)
  cancelNativeRecovery()
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
          return fetchCapacitorAvatarDataUrl(failedSource, store.getters.getCurrentInvidiousInstanceUrl)
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
    imageUrl.value = addRetryParameter(currentSource)
  }, RETRY_DELAY_MS)
}

onBeforeUnmount(() => {
  sourceVersion++
  cancelNativeRecovery()
  visibilityObserver?.disconnect()
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
