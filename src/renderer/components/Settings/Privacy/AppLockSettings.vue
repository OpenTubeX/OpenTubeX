<template>
  <FtSettingsSection :title="t('App Lock.Title')">
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('App Lock.Enable')"
        :tooltip="t('App Lock.Enable Tooltip')"
        :default-value="enabled"
        :disabled="!loaded || busy"
        controlled
        @change="updateEnabled"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtSelect
        :placeholder="t('App Lock.Lock After')"
        :value="timeoutSeconds"
        :select-names="timeoutNames"
        :select-values="TIMEOUT_VALUES"
        :icon="['fas', 'clock']"
        :disabled="!enabled || busy"
        @change="updateTimeout"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { registerPlugin } from '@capacitor/core'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import { ERROR_TOAST_ICON, showToast } from '../../../helpers/utils'

const AppLock = registerPlugin('AppLock')
const { t } = useI18n()

const TIMEOUT_VALUES = [0, 60, 300, 900, 3600]
const timeoutNames = computed(() => [
  t('App Lock.Immediately'),
  t('App Lock.1 Minute'),
  t('App Lock.5 Minutes'),
  t('App Lock.15 Minutes'),
  t('App Lock.1 Hour')
])

const loaded = ref(false)
const busy = ref(false)
const enabled = ref(false)
const timeoutSeconds = ref(0)

onMounted(async () => {
  try {
    const state = await AppLock.getState()
    enabled.value = state.enabled
    timeoutSeconds.value = state.timeoutSeconds
    loaded.value = true
  } catch (error) {
    console.error('Unable to read app lock', error)
  }
})

/** @param {boolean} value */
async function updateEnabled(value) {
  busy.value = true
  try {
    await AppLock.setEnabled({ enabled: value })
    enabled.value = value
  } catch (error) {
    showToast({
      message: error?.code === 'UNAVAILABLE' ? t('App Lock.Unavailable') : t('App Lock.Error'),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    busy.value = false
  }
}

/** @param {number | string} value */
async function updateTimeout(value) {
  const seconds = Number(value)
  busy.value = true
  try {
    await AppLock.setTimeout({ seconds })
    timeoutSeconds.value = seconds
  } catch (error) {
    console.error('Unable to change the app lock timeout', error)
    showToast({ message: t('App Lock.Error'), icon: ERROR_TOAST_ICON })
  } finally {
    busy.value = false
  }
}
</script>
