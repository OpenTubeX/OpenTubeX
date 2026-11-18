<template>
  <button
    type="button"
    class="phonePanelButton phonePanelCard phoneQueueButton"
    @click="emit('open')"
    @keydown.space.stop
    @keyup.space.stop
  >
    <FtIcon
      :icon="['fas', 'queue']"
      aria-hidden="true"
    />
    <span class="phoneQueueLabel">
      <span>{{ t('Video.Queue') }}</span>
      <span
        class="phoneQueuePreview"
        dir="auto"
      >{{ nextTitle }}</span>
    </span>
    <FtIcon
      :icon="['fas', 'angle-down']"
      aria-hidden="true"
    />
  </button>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

defineProps({
  nextTitle: { type: String, default: '' }
})
const emit = defineEmits(['open'])
const { t } = useI18n()
</script>

<style scoped src="./PhoneQueueButton.css" />
<style scoped src="../phonePanelCard.css" />
