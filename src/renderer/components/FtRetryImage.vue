<template>
  <img
    :src="imageUrl"
    alt=""
    @error="retryImageLoad"
  >
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const RETRY_DELAY_MS = 3000

const props = defineProps({
  src: {
    type: String,
    required: true
  }
})

const imageUrl = ref(props.src)
let hasRetried = false
let retryTimeoutId
let sourceVersion = 0

watch(() => props.src, (src) => {
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
  sourceVersion++
  hasRetried = false
  imageUrl.value = src
})

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

async function retryImageLoad() {
  if (hasRetried) {
    return
  }

  hasRetried = true
  const failedSourceVersion = sourceVersion

  if (process.env.IS_CAPACITOR) {
    const { fetchCapacitorAvatarDataUrl } = await import('../helpers/api/capacitor-http')
    const dataUrl = await fetchCapacitorAvatarDataUrl(props.src)

    if (failedSourceVersion !== sourceVersion) return
    if (dataUrl !== null) {
      imageUrl.value = dataUrl
      return
    }
  }

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = undefined
    imageUrl.value = addRetryParameter(props.src)
  }, RETRY_DELAY_MS)
}

onBeforeUnmount(() => {
  sourceVersion++
  clearTimeout(retryTimeoutId)
})
</script>
