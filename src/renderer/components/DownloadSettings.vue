<template>
  <FtSettingsSection
    :title="t('Settings.Download Settings.Download Settings')"
  >
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Download Settings.Enable Downloads')"
        :default-value="enableDownloads"
        setting-key="enableDownloads"
        :compact="true"
        @change="updateEnableDownloads"
      />
    </FtFlexBox>
    <FtFlexBox v-if="enableDownloads">
      <FtToggleSwitch
        :label="t('Settings.Download Settings.Move Downloads to Quick Settings')"
        :default-value="moveDownloadsToQuickSettings"
        setting-key="moveDownloadsToQuickSettings"
        :compact="true"
        @change="updateMoveDownloadsToQuickSettings"
      />
    </FtFlexBox>
    <FtFlexBox v-if="enableDownloads">
      <FtButton
        :label="t('Downloads.Open Downloads')"
        :icon="['fas', 'download']"
        @click="openDownloads"
      />
    </FtFlexBox>
    <DownloadTemplateSettings v-if="enableDownloads" />
    <AutomaticDownloadSettings v-if="enableDownloads" />
    <FtFlexBox
      v-if="enableDownloads"
      class="downloadPathInputs settingsFlexStart460px"
    >
      <FtInput
        :placeholder="t('Settings.Download Settings.Download Folder')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpDownloadFolderPath"
        :tooltip="t('Tooltips.Download Settings.Download Folder')"
        @input="updateYtDlpDownloadFolderPath"
        @click="chooseDownloadFolder"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtInput from './FtInput/FtInput.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from './FtButton/FtButton.vue'
import AutomaticDownloadSettings from './AutomaticDownloadSettings/AutomaticDownloadSettings.vue'
import DownloadTemplateSettings from './DownloadTemplateSettings/DownloadTemplateSettings.vue'

import store from '../store/index'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const enableDownloads = computed(() => store.getters.getEnableDownloads)
const moveDownloadsToQuickSettings = computed(() => store.getters.getMoveDownloadsToQuickSettings)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)

/**
 * @param {boolean} value
 */
function updateEnableDownloads(value) {
  store.dispatch('updateEnableDownloads', value)
}

function openDownloads() {
  store.dispatch('showSettingsWindow', 'downloads')
}

function updateMoveDownloadsToQuickSettings(value) {
  store.dispatch('updateMoveDownloadsToQuickSettings', value)
}

/**
 * @param {string} value
 */
function updateYtDlpDownloadFolderPath(value) {
  store.dispatch('updateYtDlpDownloadFolderPath', value)
}

async function chooseDownloadFolder() {
  const path = await window.ftElectron.ytDlpChooseDownloadFolder(ytDlpDownloadFolderPath.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpDownloadFolderPath', path)
  }
}
</script>

<style scoped>
.downloadPathInputs {
  column-gap: 12px;
}

.downloadPathInputs :deep(.ft-input-component) {
  inline-size: 340px;
  max-inline-size: 100%;
}

</style>
