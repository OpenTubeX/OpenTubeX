<template>
  <FtSettingsSection
    :title="$t('Settings.Experimental Settings.Experimental Settings')"
  >
    <p class="experimental-warning">
      {{ $t('Settings.Experimental Settings.Warning') }}
    </p>
    <FtFlexBox v-if="USING_ELECTRON">
      <FtSelect
        class="playbackEngineSelect"
        :placeholder="$t('Settings.Experimental Settings.Playback Engine.Playback Engine')"
        :value="videoPlaybackEngine"
        setting-key="videoPlaybackEngine"
        :select-names="playbackEngineNames"
        :select-values="PLAYBACK_ENGINE_VALUES"
        :tooltip="$t('Tooltips.Experimental Settings.Playback Engine')"
        :icon="['fas', 'circle-play']"
        @change="updateVideoPlaybackEngine"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtToggleSwitch
        tooltip-position="top"
        :label="$t('Settings.Experimental Settings.Replace HTTP Cache')"
        compact
        :default-value="replaceHttpCache"
        :disabled="replaceHttpCacheLoading"
        :tooltip="$t('Tooltips.Experimental Settings.Replace HTTP Cache')"
        @change="handleRestartPrompt"
      />
    </FtFlexBox>
    <br>
    <FtIconPackSwitcher />
    <FtPrompt
      v-if="showRestartPrompt"
      :label="$t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')"
      :option-names="[$t('Yes, Restart'), $t('Cancel')]"
      :option-values="['restart', 'cancel']"
      @click="handleReplaceHttpCache"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtIconPackSwitcher from '../FtIconPackSwitcher/FtIconPackSwitcher.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'

const { t } = useI18n()

const USING_ELECTRON = !!process.env.IS_ELECTRON
const PLAYBACK_ENGINE_VALUES = ['yt-dlp', 'built-in']

const playbackEngineNames = computed(() => [
  t('Settings.Experimental Settings.Playback Engine.yt-dlp'),
  t('Settings.Experimental Settings.Playback Engine.Built-in')
])

/** @type {import('vue').ComputedRef<'yt-dlp' | 'built-in'>} */
const videoPlaybackEngine = computed(() => store.getters.getVideoPlaybackEngine)

/**
 * @param {'yt-dlp' | 'built-in'} value
 */
function updateVideoPlaybackEngine(value) {
  store.dispatch('updateVideoPlaybackEngine', value)
}

const replaceHttpCacheLoading = ref(true)
const replaceHttpCache = ref(false)
const showRestartPrompt = ref(false)

onMounted(async () => {
  if (process.env.IS_ELECTRON) {
    replaceHttpCache.value = await window.ftElectron.getReplaceHttpCache()
  }

  replaceHttpCacheLoading.value = false
})

/**
 * @param {boolean} value
 */
function handleRestartPrompt(value) {
  replaceHttpCache.value = value
  showRestartPrompt.value = true
}

/**
 * @param {'restart' | 'cancel' | null} value
 */
function handleReplaceHttpCache(value) {
  showRestartPrompt.value = false

  if (value === null || value === 'cancel') {
    replaceHttpCache.value = !replaceHttpCache.value
    return
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.toggleReplaceHttpCache()
  }
}
</script>

<style scoped src="./ExperimentalSettings.css" />
