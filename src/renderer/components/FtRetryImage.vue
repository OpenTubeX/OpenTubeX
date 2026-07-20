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

watch(() => props.src, (src) => {
  clearTimeout(retryTimeoutId)
  retryTimeoutId = undefined
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

function retryImageLoad() {
  if (hasRetried) {
    return
  }

  hasRetried = true
  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = undefined
    imageUrl.value = addRetryParameter(props.src)
  }, RETRY_DELAY_MS)
}

onBeforeUnmount(() => clearTimeout(retryTimeoutId))
</script>
