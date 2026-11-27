<template>
  <FtSettingsSection
    :title="$t('Settings.Experimental Settings.Experimental Settings')"
    :icon="['fas', 'flask']"
  >
    <p class="experimental-warning">
      {{ $t('Settings.Experimental Settings.Warning') }}
    </p>
    <div class="settingsRows">
      <FtSettingsRow
        :description="$t('Tooltips.Experimental Settings.Replace HTTP Cache')"
        :title="$t('Settings.Experimental Settings.Replace HTTP Cache')"
        :icon="['fas', 'database']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Experimental Settings.Replace HTTP Cache')"
          hide-label
          :default-value="replaceHttpCache"
          :disabled="replaceHttpCacheLoading"
          performance-impact-key="replaceHttpCache"
          @change="handleToggleReplaceHttpCache"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="$t('Tooltips.Experimental Settings.Disable Hardware Acceleration')"
        :title="$t('Settings.Experimental Settings.Disable Hardware Acceleration')"
        :icon="['fas', 'gauge-high']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Experimental Settings.Disable Hardware Acceleration')"
          hide-label
          :default-value="disableHardwareAcceleration"
          :disabled="disableHardwareAccelerationLoading"
          performance-impact-key="disableHardwareAcceleration"
          @change="handleToggleDisableHardwareAcceleration"
        />
      </FtSettingsRow>
    </div>
    <FtPrompt
      v-if="showRestartPrompt"
      autosize
      :label="$t('Settings.Restart Required')"
      :extra-labels="[$t('Settings[\'The app needs to restart for changes to take effect. Restart and apply change?\']')]"
      :option-names="[$t('Yes, Restart'), $t('Cancel')]"
      :option-values="['restart', 'cancel']"
      :option-icons="[['fas', 'arrows-rotate'], ['fas', 'xmark']]"
      @click="handleRestartPrompt"
    />
  </FtSettingsSection>
</template>

<script setup>
import { onMounted, ref } from 'vue'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'

const replaceHttpCacheLoading = ref(true)
const replaceHttpCache = ref(false)
let replaceHttpCacheRunningState = null

const disableHardwareAccelerationLoading = ref(true)
const disableHardwareAcceleration = ref(false)
let disableHardwareAccelerationRunningState = null

const showRestartPrompt = ref(false)

onMounted(async () => {
  if (process.env.IS_ELECTRON) {
    [replaceHttpCache.value, disableHardwareAcceleration.value] =
      [replaceHttpCacheRunningState, disableHardwareAccelerationRunningState] =
        await Promise.all([window.ftElectron.getReplaceHttpCache(), window.ftElectron.getDisableHardwareAcceleration()])
  }

  replaceHttpCacheLoading.value = false
  disableHardwareAccelerationLoading.value = false
})

/**
 * @param {boolean} value
 */
function handleToggleReplaceHttpCache(value) {
  replaceHttpCache.value = value
  showRestartPrompt.value = true
}

/**
 * @param {boolean} value
 */
function handleToggleDisableHardwareAcceleration(value) {
  disableHardwareAcceleration.value = value
  showRestartPrompt.value = true
}

/**
 * @param {'restart' | 'cancel' | null} value
 */
function handleRestartPrompt(value) {
  showRestartPrompt.value = false

  if (value === null || value === 'cancel') {
    replaceHttpCache.value = replaceHttpCacheRunningState
    disableHardwareAcceleration.value = disableHardwareAccelerationRunningState
    return
  }

  if (process.env.IS_ELECTRON) {
    if (replaceHttpCache.value !== replaceHttpCacheRunningState) {
      window.ftElectron.toggleReplaceHttpCache()
    } else if (disableHardwareAcceleration.value !== disableHardwareAccelerationRunningState) {
      window.ftElectron.toggleDisableHardwareAcceleration()
    }
  }
}
</script>

<style scoped src="./ExperimentalSettings.css" />
