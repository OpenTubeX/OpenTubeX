<template>
  <img
    :src="imageUrl"
    alt=""
    @error="retryImageLoad"
    @load="handleImageLoad"
  >
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import store from '../store/index'
import { getVideoThumbnailSource, getVideoThumbnailFallbackUrl } from '../helpers/videoThumbnail.js'

const RETRY_DELAY_MS = 3000

const props = defineProps({
  src: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['error'])

const preferredSource = computed(() => getVideoThumbnailSource(props.src, store.getters.getThumbnailDataSaver))
const imageUrl = ref(preferredSource.value)
let currentSource = preferredSource.value
let hasRetried = false
let retryPending = false
let retryTimeoutId
let sourceVersion = 0

watch(preferredSource, resetSource)

function resetSource(src) {
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  sourceVersion++
  hasRetried = false
  retryPending = false
  currentSource = src
  imageUrl.value = src
}

function useSmallerThumbnail() {
  const fallback = getVideoThumbnailFallbackUrl(currentSource)
  if (!fallback) return false

  resetSource(fallback)
  return true
}

function handleImageLoad(event) {
  // YouTube can return a decodable 120x90 placeholder for missing resolutions.
  const image = event.target
  if (image.naturalWidth === 120 && image.naturalHeight === 90) {
    useSmallerThumbnail()
  }
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
  if (useSmallerThumbnail()) return

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
