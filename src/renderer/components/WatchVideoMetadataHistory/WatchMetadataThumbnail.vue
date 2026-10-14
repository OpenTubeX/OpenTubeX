<template>
  <div
    ref="frame"
    class="metadataThumbnail"
  >
    <FtRetryImage
      v-if="source"
      :src="source"
      :alt="alt"
    />
    <FtButton
      v-else-if="failed"
      :label="$t('Storage Startup Error.Retry')"
      :icon="['fas', 'sync']"
      :disabled="busy"
      @click="load"
    />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { DBLibraryHandlers } from '../../../datastores/handlers/index'
import FtRetryImage from '../FtRetryImage.vue'
import FtButton from '../FtButton/FtButton.vue'

const props = defineProps({
  revisionId: { type: String, default: null },
  fallbackUrl: { type: String, default: null },
  alt: { type: String, default: '' }
})
const frame = useTemplateRef('frame')
const source = ref(null)
const failed = ref(false)
const busy = ref(false)
let observer
let visible = false
let generation = 0
async function load() {
  if (!visible || source.value || busy.value) return
  const current = ++generation
  failed.value = false
  busy.value = true
  try {
    const data = props.revisionId ? await DBLibraryHandlers.query('metadataThumbnail', { id: props.revisionId }) : null
    if (current === generation) source.value = data || props.fallbackUrl
  } catch (error) {
    if (current !== generation) return
    source.value = props.fallbackUrl
    failed.value = !source.value
    console.error(error)
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(() => [props.revisionId, props.fallbackUrl], () => {
  ++generation
  source.value = null
  busy.value = false
  failed.value = false
  load()
})
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    const next = entries.some(entry => entry.isIntersecting)
    if (next === visible) return
    visible = next
    if (visible && !failed.value) load()
  }, { rootMargin: '200px' })
  observer.observe(frame.value)
})
onBeforeUnmount(() => { ++generation; observer?.disconnect() })
</script>

<style scoped>
.metadataThumbnail {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
</style>
