<template>
  <!-- Keep a small box for lazy loading without expanding scroll overflow. -->
  <img
    ref="image"
    v-bind="{ ...$attrs, ...parentScope }"
    :src="imageUrl"
    :alt="$attrs.alt ?? ''"
    :style="hasLoaded ? null : {
      position: 'absolute', visibility: 'hidden', pointerEvents: 'none', inlineSize: '1px', blockSize: '1px'
    }"
    @error="retryImageLoad"
    @load="handleImageLoad"
  >
  <FtIcon
    v-if="!hasLoaded && fallbackIcon"
    v-bind="{ ...$attrs, ...parentScope }"
    class="retryImagePlaceholder"
    :icon="fallbackIcon"
    aria-hidden="true"
  />
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
import { computed, getCurrentInstance, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import store from '../store/index'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl } from '../helpers/videoThumbnail.js'
import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'

defineOptions({ inheritAttrs: false })

// Multiple roots need the caller's scoped styles on both the image and placeholder.
const parentScopeId = getCurrentInstance().vnode.scopeId
const parentScope = parentScopeId ? { [parentScopeId]: '' } : {}

const RETRY_DELAY_MS = 3000

const props = defineProps({
  src: {
    type: String,
    required: true
  },
  fallbackIcon: {
    type: [Array, String, Object],
    default: null
  }
})

const emit = defineEmits(['error', 'load'])

const preferredSource = computed(() => getVideoThumbnailSource(props.src, store.getters.getThumbnailDataSaver))
const imageUrl = ref(preferredSource.value)
const image = useTemplateRef('image')
const hasLoaded = ref(false)
let currentSource = preferredSource.value
let hasRetried = false
let retryPending = false
let retryTimeoutId
let sourceVersion = 0

watch(preferredSource, resetSource)
// Cached images can already be usable before the browser delivers their load
// event. Check after mounting and after patching src, before the next paint.
watch([image, imageUrl], checkCachedImage, { flush: 'post' })

function checkCachedImage() {
  if (!hasLoaded.value && image.value?.complete && image.value.naturalWidth) {
    image.value.dispatchEvent(new Event('load'))
  }
}

function resetSource(src) {
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  sourceVersion++
  hasRetried = false
  retryPending = false
  currentSource = src
  hasLoaded.value = false
  imageUrl.value = src
}

function useSmallerThumbnail() {
  const fallback = getVideoThumbnailFallbackUrl(currentSource)
  if (!fallback) return false

  resetSource(fallback)
  return true
}

function handleImageLoad(event) {
  if (hasLoaded.value) return
  // YouTube can return a decodable 120x90 placeholder for missing resolutions.
  const image = event.target
  if (image.naturalWidth === 120 && image.naturalHeight === 90) {
    if (useSmallerThumbnail()) return
  }
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
  if (useSmallerThumbnail()) return

  // Embedded images cannot recover through an HTTP retry or a query parameter.
  if (/^(data|blob):/.test(currentSource)) {
    emit('error', event)
    return
  }

  if (hasRetried) {
    if (!retryPending) emit('error', event)
    return
  }

  hasRetried = true
  retryPending = true
  const failedSourceVersion = sourceVersion

  if (process.env.IS_CAPACITOR) {
    let dataUrl = null
    try {
      const { fetchCapacitorAvatarDataUrl } = await import('../helpers/api/capacitor-http')
      dataUrl = await fetchCapacitorAvatarDataUrl(currentSource)
    } catch {
      // Native recovery is optional; unexpected failures still get a delayed retry.
    }

    if (failedSourceVersion !== sourceVersion) return
    if (dataUrl !== null) {
      retryPending = false
      imageUrl.value = dataUrl
      return
    }
  }

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = undefined
    retryPending = false
    imageUrl.value = addRetryParameter(currentSource)
  }, RETRY_DELAY_MS)
}

onBeforeUnmount(() => {
  sourceVersion++
  clearTimeout(retryTimeoutId)
})
</script>

<style scoped>
.retryImagePlaceholder :deep(.ft-icon__glyph) {
  block-size: 100%;
  inline-size: 100%;
  scale: 1;
}
</style>
