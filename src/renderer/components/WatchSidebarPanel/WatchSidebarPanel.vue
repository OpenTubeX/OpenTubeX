<template>
  <Teleport
    :to="dockTarget || 'body'"
    :disabled="!dockTarget"
  >
    <FtPhonePanel
      :enabled="phoneEnabled"
      :open="phoneOpen"
      :title="title"
      :custom-header="customHeader"
      fill
      @close="emit('close', $event)"
    >
      <!-- The page's layout styles define the transition classes. -->
      <Transition
        :name="transition"
        @before-leave="emit('leaving', true)"
        @after-leave="emit('leaving', false)"
        @leave-cancelled="emit('leaving', false)"
      >
        <slot />
      </Transition>
    </FtPhonePanel>
  </Teleport>
</template>

<script setup>
import FtPhonePanel from '../FtPhonePanel/FtPhonePanel.vue'

defineProps({
  title: { type: String, required: true },
  /** Docks the panel into the fullscreen player while set. */
  dockTarget: { type: Object, default: null },
  phoneEnabled: { type: Boolean, default: false },
  phoneOpen: { type: Boolean, default: false },
  customHeader: { type: Boolean, default: false },
  transition: { type: String, default: 'sidebar-panel' }
})
const emit = defineEmits(['close', 'leaving'])
</script>
