<template>
  <FtSettingsSection
    :title="$t('Settings.Privacy Settings.Cache Video Metadata')"
    hide-title
  >
    <FtFlexBox>
      <FtToggleSwitch
        :label="$t('Settings.Privacy Settings.Cache Video Metadata')"
        :tooltip="$t('Settings.Privacy Settings.Cache Video Metadata Tooltip')"
        compact
        :default-value="enableVideoMetadataCache"
        setting-key="enableVideoMetadataCache"
        @change="updateEnableVideoMetadataCache"
      />
    </FtFlexBox>
    <div
      class="metadataCacheManagement"
      :class="{ disabled: !enableVideoMetadataCache }"
      :aria-disabled="!enableVideoMetadataCache"
    >
      <span>{{ $t('Settings.Privacy Settings.Video Metadata Cache Size', {
        size: formatBytes(videoMetadataCacheSize)
      }) }}</span>
      <FtButton
        :label="$t('Settings.Privacy Settings.Clear Video Metadata Cache')"
        theme="destructive"
        :icon="['fas', 'trash']"
        :disabled="!enableVideoMetadataCache"
        @click="showClearMetadataCachePrompt = true"
      />
    </div>
    <FtPrompt
      v-if="showClearMetadataCachePrompt"
      autosize
      :label="$t('Settings.Privacy Settings.Are you sure you want to clear the video metadata cache?')"
      :option-names="promptNames"
      :option-values="PROMPT_VALUES"
      is-first-option-destructive
      @click="handleClearMetadataCache"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtPrompt from './FtPrompt/FtPrompt.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'

import { formatBytes } from '../helpers/fileSize'
import { showToast } from '../helpers/utils'
import store from '../store/index'

const { t } = useI18n()
const videoMetadataCacheSize = ref(0)
const showClearMetadataCachePrompt = ref(false)
let removeVideoMetadataCacheClearedListener = null

const PROMPT_VALUES = ['delete', 'cancel']
const promptNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

/** @type {import('vue').ComputedRef<boolean>} */
const enableVideoMetadataCache = computed(() => store.getters.getEnableVideoMetadataCache)

/** @param {boolean} value */
function updateEnableVideoMetadataCache(value) {
  store.dispatch('updateEnableVideoMetadataCache', value)
}

async function refreshVideoMetadataCacheSize() {
  try {
    videoMetadataCacheSize.value = await window.ftElectron.videoMetadataCache.getSize()
  } catch (error) {
    console.error('Failed to read the video metadata cache size', error)
  }
}

function refreshVideoMetadataCacheSizeWhenVisible() {
  if (!document.hidden) refreshVideoMetadataCacheSize()
}

onMounted(() => {
  refreshVideoMetadataCacheSize()
  removeVideoMetadataCacheClearedListener = window.ftElectron?.videoMetadataCache?.onCleared?.(
    refreshVideoMetadataCacheSize
  ) ?? null
  document.addEventListener('visibilitychange', refreshVideoMetadataCacheSizeWhenVisible)
})

onBeforeUnmount(() => {
  removeVideoMetadataCacheClearedListener?.()
  document.removeEventListener('visibilitychange', refreshVideoMetadataCacheSizeWhenVisible)
})

/** @param {'delete' | 'cancel' | null} option */
async function handleClearMetadataCache(option) {
  showClearMetadataCachePrompt.value = false

  if (option !== 'delete') return

  try {
    await window.ftElectron.videoMetadataCache.clear()
  } catch (error) {
    console.error('Failed to clear the video metadata cache', error)
    showToast({
      message: t('Settings.Privacy Settings.Failed to clear video metadata cache'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  await refreshVideoMetadataCacheSize()
  showToast({
    message: t('Settings.Privacy Settings.Video metadata cache has been cleared'),
    icon: ['fas', 'trash'],
  })
}
</script>

<style scoped>
.metadataCacheManagement {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  justify-content: center;
}

.metadataCacheManagement.disabled > span {
  opacity: 0.4;
}
</style>
