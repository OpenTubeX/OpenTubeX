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
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { DBLibraryHandlers } from '../../../datastores/handlers/index'
import FtRetryImage from '../FtRetryImage.vue'

const props = defineProps({
  revisionId: { type: String, default: null },
  fallbackUrl: { type: String, default: null },
  alt: { type: String, default: '' }
})
const frame = useTemplateRef('frame')
const source = ref(null)
let observer
let visible = false
let generation = 0
async function load() {
  const current = ++generation
  if (!visible) { source.value = null; return }
  const data = props.revisionId ? await DBLibraryHandlers.query('metadataThumbnail', { id: props.revisionId }) : null
  if (current === generation) source.value = data || props.fallbackUrl
}
watch(() => [props.revisionId, props.fallbackUrl], () => load().catch(console.error))
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    load().catch(console.error)
  }, { rootMargin: '200px' })
  observer.observe(frame.value)
})
onBeforeUnmount(() => { ++generation; observer?.disconnect() })
</script>

<style scoped>
.metadataThumbnail {
  width: 100%;
  height: 100%;
}
</style>
