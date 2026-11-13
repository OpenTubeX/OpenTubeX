<template>
  <FtInput
    class="ftPathPicker"
    :class="{ hasPath: value !== '' }"
    :icon="icon"
    :label="label"
    :placeholder="placeholder"
    :supporting-text="supportingText"
    :tooltip="tooltip"
    :value="value"
    :show-label="true"
    :readonly="true"
    :show-action-button="true"
    :allow-action-button-when-empty="true"
    :force-action-button-icon-name="['fas', 'folder-open']"
    :action-button-label="t('Form Inputs.Browse')"
    @click="emit('browse')"
  >
    <template #extraAction>
      <button
        v-if="value !== ''"
        type="button"
        class="clearPathButton"
        :aria-label="t('Form Inputs.Use Default Path')"
        :title="t('Form Inputs.Use Default Path')"
        @click="emit('clear')"
      >
        <FtIcon
          :icon="['fas', 'xmark']"
          aria-hidden="true"
        />
      </button>
    </template>
  </FtInput>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

import FtInput from '../FtInput/FtInput.vue'

/**
 * A read-only path that changes only through a native picker, so that typed
 * or pasted paths never reach the setting.
 */
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  icon: { type: Array, default: () => ['fas', 'folder-open'] },
  placeholder: { type: String, default: '' },
  supportingText: { type: String, default: '' },
  tooltip: { type: String, default: '' }
})

const emit = defineEmits(['browse', 'clear'])

const { t } = useI18n()
</script>

<style scoped>
.ftPathPicker.hasPath :deep(.ft-input) {
  padding-inline-end: calc(72px + 6px);
}

.clearPathButton {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 39px;
  transform: translateY(-50%);
  margin: 0;
  padding: 10px;
  border-style: none;
  border-radius: 100%;
  background-color: transparent;
  color: var(--primary-text-color);
  cursor: pointer;
  font-size: 1em;
  line-height: 1em;
  transition: background-color var(--motion-fast-effects), border-radius var(--motion-fast-spatial);
}

.clearPathButton:hover {
  background-color: var(--side-nav-hover-color);
  color: var(--side-nav-hover-text-color);
}

.clearPathButton:active {
  border-radius: var(--shape-corner-medium);
  background-color: var(--side-nav-active-color);
  color: var(--side-nav-active-text-color);
}

.clearPathButton:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: -2px;
}
</style>
