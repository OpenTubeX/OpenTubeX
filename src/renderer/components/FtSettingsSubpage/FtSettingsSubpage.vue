<template>
  <Teleport
    v-if="open"
    :to="`#${settingsWindow.targetId}`"
  >
    <div
      class="settingsSubpageContent"
      :class="{ growWithContent }"
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup>
import { inject, onBeforeUnmount, watch } from 'vue'

import { settingsSubpageKey } from './settingsSubpage'

const props = defineProps({
  open: {
    type: Boolean,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  growWithContent: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])
const settingsWindow = inject(settingsSubpageKey)

function close() {
  emit('close')
}

watch(() => [props.open, props.title], ([open, title]) => {
  if (open) {
    settingsWindow.open(title, close)
  } else {
    settingsWindow.close(close)
  }
}, { immediate: true })

onBeforeUnmount(() => settingsWindow.close(close))
</script>

<style scoped>
.settingsSubpageContent {
  min-block-size: 100%;
  block-size: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.settingsSubpageContent.growWithContent {
  block-size: auto;
}
</style>
