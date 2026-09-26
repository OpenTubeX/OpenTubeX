<template>
  <div class="capacitorTabSelectionControls">
    <button
      type="button"
      :disabled="busy || count === 0"
      :aria-expanded="showActions"
      aria-haspopup="true"
      @click="showActions = !showActions"
    >
      <FtIcon
        :icon="['fas', 'ellipsis-h']"
        aria-hidden="true"
      />
      {{ t('More') }}
    </button>
    <button
      type="button"
      :disabled="busy || count === 0"
      @click="$emit('close')"
    >
      <FtIcon
        :icon="['fas', 'rectangle-xmark']"
        aria-hidden="true"
      />
      {{ count === 1 ? t('Close Tab') : t('Context Menu.Close Multiple Tabs', { count }, count) }}
    </button>
    <button
      type="button"
      :disabled="busy"
      @click="$emit('cancel')"
    >
      <FtIcon
        :icon="['fas', 'xmark']"
        aria-hidden="true"
      />
      {{ t('Cancel') }}
    </button>
    <div
      v-if="showActions"
      v-overlay-scrollbars
      class="capacitorTabSelectionMenu"
      role="group"
      :aria-label="t('More')"
      @keydown.esc.stop.prevent="showActions = false"
    >
      <button
        v-for="action in actions"
        :key="action.name"
        type="button"
        :disabled="busy || !action.enabled"
        @click="run(action.name)"
      >
        <FtIcon
          :icon="['fas', action.icon]"
          aria-hidden="true"
        />
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  count: { type: Number, required: true },
  busy: { type: Boolean, default: false },
  canPin: { type: Boolean, default: false },
  canUnpin: { type: Boolean, default: false },
  canLoad: { type: Boolean, default: false },
  canUnload: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'cancel', 'action'])
const { t } = useI18n()
const showActions = ref(false)
const actions = computed(() => [
  { name: 'pin', label: t('Context Menu.Pin Tabs'), icon: 'thumbtack', enabled: props.canPin },
  { name: 'unpin', label: t('Context Menu.Unpin Tabs'), icon: 'thumbtack-slash', enabled: props.canUnpin },
  { name: 'load', label: t('Context Menu.Load Tabs'), icon: 'download', enabled: props.canLoad },
  { name: 'unload', label: t('Context Menu.Unload Tabs'), icon: 'right-from-bracket', enabled: props.canUnload },
  { name: 'reload', label: t('Context Menu.Reload Tabs'), icon: 'sync', enabled: props.count > 0 },
])

function run(action) {
  showActions.value = false
  emit('action', action)
}
</script>

<style scoped>
.capacitorTabSelectionControls {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-inline: 8px;
  background-color: var(--card-bg-color);
}

.capacitorTabSelectionMenu {
  position: absolute;
  z-index: 10;
  inset-block-start: 100%;
  inset-inline-start: 8px;
  display: flex;
  flex-direction: column;
  inline-size: min(280px, calc(100vw - 16px));
  max-block-size: min(360px, 60vh);
  overflow-y: auto;
  padding: 8px;
  border-radius: calc(8px * var(--ui-roundness));
  background-color: var(--card-bg-color);
  box-shadow: 0 4px 16px var(--primary-shadow-color);
}

.capacitorTabSelectionMenu button {
  justify-content: flex-start;
  flex: 0 0 auto;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-block-size: 48px;
  padding-inline: 8px;
  border: 0;
  border-radius: calc(8px * var(--ui-roundness));
  color: var(--primary-text-color);
  background-color: transparent;
  font: inherit;
  cursor: pointer;
}

button:not(:disabled):is(:hover, :active, :focus-visible) {
  background-color: var(--side-nav-hover-color);
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
