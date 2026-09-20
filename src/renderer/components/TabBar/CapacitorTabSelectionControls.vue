<template>
  <div class="capacitorTabSelectionControls">
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
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

defineProps({
  count: { type: Number, required: true },
  busy: { type: Boolean, default: false },
})
defineEmits(['close', 'cancel'])
const { t } = useI18n()
</script>

<style scoped>
.capacitorTabSelectionControls {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-inline: 8px;
  background-color: var(--card-bg-color);
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
