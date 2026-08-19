<template>
  <Teleport
    v-if="open"
    :to="`#${settingsWindow.breadcrumbTargetId}`"
  >
    <slot name="breadcrumb-action" />
  </Teleport>
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
  icon: {
    type: Array,
    default: null
  },
  growWithContent: {
    type: Boolean,
    default: false
  },
  persistOnDeactivate: {
    type: Boolean,
    default: false
  },
  flush: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])
const settingsWindow = inject(settingsSubpageKey)

function close() {
  emit('close')
}

watch(
  () => [props.open, props.title, props.icon, props.persistOnDeactivate, props.flush],
  ([open, title, icon, persist, flush]) => {
    if (open) {
      settingsWindow.open(title, close, persist, icon, flush)
    } else {
      settingsWindow.close(close)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => settingsWindow.close(close))
</script>

<style scoped>
.settingsSubpageContent {
  container-type: inline-size;
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
