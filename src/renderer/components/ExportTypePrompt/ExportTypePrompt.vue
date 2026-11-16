<template>
  <FtPrompt
    card-class="exportTypePrompt"
    autosize
    fixed-layout
    :label="t('Settings.Data Settings.Select Export Type')"
    @click="emit('select', null)"
  >
    <div class="exportTypeOptions">
      <FtButton
        v-for="option in options"
        :key="option.value"
        :label="option.label"
        :icon="option.icon"
        size="medium"
        @click="emit('select', option.value)"
      />
    </div>
    <template #footer>
      <FtButton
        class="exportTypeClose"
        :label="t('Close')"
        :icon="['fas', 'xmark']"
        :text-color="null"
        :background-color="null"
        size="medium"
        @click="emit('select', null)"
      />
    </template>
  </FtPrompt>
</template>

<script setup>
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

defineProps({
  /** @type {import('vue').PropType<{ label: string, value: string, icon: string[] }[]>} */
  options: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['select'])
const { t } = useI18n()
</script>

<style scoped src="./ExportTypePrompt.css" />
