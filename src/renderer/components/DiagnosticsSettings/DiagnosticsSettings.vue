<template>
  <FtSettingsSection :title="t('Settings.Diagnostics.Diagnostics')">
    <p class="diagnosticsDescription">
      {{ t('Settings.Diagnostics.Description') }}
    </p>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Diagnostics.Enable Logging')"
        :default-value="store.getters.getDiagnosticLogging"
        setting-key="diagnosticLogging"
        compact
        @change="store.dispatch('updateDiagnosticLogging', $event)"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtButton
        :label="t('Settings.Diagnostics.Copy Report')"
        :icon="['fas', 'copy']"
        :disabled="busy || !store.getters.getDiagnosticLogging"
        @click="copyReport"
      />
      <FtButton
        :label="t('Settings.Diagnostics.Save Report')"
        :icon="['fas', 'file-download']"
        :disabled="busy || !store.getters.getDiagnosticLogging"
        @click="saveReport"
      />
      <FtButton
        :label="t('Settings.Diagnostics.Clear Log')"
        :icon="['fas', 'trash']"
        :disabled="busy || !store.getters.getDiagnosticLogging"
        @click="clearLog"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'
import { defaultGetterId } from '../../store/modules/settings'
import { buildDiagnosticReport, clearDiagnosticLog } from '../../helpers/diagnostics'
import { copyToClipboard, ERROR_TOAST_ICON, showToast, writeFileWithPicker } from '../../helpers/utils'

const { t, locale } = useI18n()

const busy = ref(false)

function buildReport() {
  return buildDiagnosticReport({
    getSetting: settingId => store.getters[defaultGetterId(settingId)],
    locale: locale.value,
  })
}

async function copyReport() {
  busy.value = true
  try {
    await copyToClipboard(await buildReport(), {
      messageOnSuccess: t('Settings.Diagnostics.Report Copied'),
    })
  } finally {
    busy.value = false
  }
}

async function saveReport() {
  busy.value = true
  try {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const saved = await writeFileWithPicker(
      `opentubex-diagnostics-${timestamp}.txt`,
      buildReport,
      t('Settings.Diagnostics.Report File'),
      'text/plain',
      '.txt',
      'diagnostic-report',
      'downloads'
    )
    if (saved) {
      showToast({ message: t('Settings.Diagnostics.Report Saved'), icon: ['fas', 'check'] })
    }
  } catch (error) {
    console.error('Failed to save the diagnostic report', error)
    showToast({ message: `${t('Settings.Diagnostics.Save Failed')}: ${error}`, time: 5000, icon: ERROR_TOAST_ICON })
  } finally {
    busy.value = false
  }
}

async function clearLog() {
  await clearDiagnosticLog()
  showToast({ message: t('Settings.Diagnostics.Log Cleared Message'), icon: ['fas', 'trash'] })
}
</script>

<style scoped>
.diagnosticsDescription {
  margin-inline: 4%;
  line-height: 1.5;
}
</style>
