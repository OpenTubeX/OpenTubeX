<template>
  <FtSettingsSection
    :title="t('Settings.Download Settings.Download Settings')"
  >
    <FtFlexBox class="downloadEnable">
      <FtToggleSwitch
        :label="t('Settings.Download Settings.Enable Downloads')"
        :default-value="enableDownloads"
        setting-key="enableDownloads"
        :compact="true"
        @change="updateEnableDownloads"
      />
    </FtFlexBox>
    <FtFlexBox
      v-if="enableDownloads"
      class="downloadActions"
    >
      <FtButton
        :label="t('Downloads.Open Downloads')"
        :icon="['fas', 'download']"
        @click="openDownloads"
      />
      <DownloadTemplateSettings />
      <AutomaticDownloadSettings v-if="!isIos" />
    </FtFlexBox>
    <FtFlexBox
      v-if="enableDownloads"
      class="downloadPathInputs settingsFlexStart460px"
    >
      <FtPathPicker
        :label="t('Settings.Download Settings.Download Folder')"
        :placeholder="downloadFolderRequired ? '' : t('Downloads.System Downloads Folder')"
        :supporting-text="downloadFolderRequired ? t('Downloads.Folder Required') : ''"
        :value="displayAndroidPath(ytDlpDownloadFolderPath)"
        :tooltip="t('Tooltips.Download Settings.Download Folder')"
        @browse="ytDlp.ytDlpChooseDownloadFolder()"
        @clear="store.dispatch('updateYtDlpDownloadFolderPath', '')"
      />
      <FtInput
        :icon="['fas', 'terminal']"
        :label="t('Settings.Download Settings.Global Additional yt-dlp Arguments')"
        :placeholder="t('Form Inputs.Global Arguments Hint')"
        :show-action-button="false"
        :show-label="true"
        :value="ytDlpDownloadCustomArgs"
        :tooltip="t('Tooltips.Download Settings.Global Additional yt-dlp Arguments')"
        @input="updateYtDlpDownloadCustomArgs"
      />
    </FtFlexBox>
    <FtFlexBox
      v-if="enableDownloads"
      class="downloadQueueInputs settingsFlexStart460px"
    >
      <FtSelect
        :placeholder="t('Settings.Download Settings.Concurrent Downloads')"
        :value="ytDlpMaxConcurrentDownloads"
        setting-key="ytDlpMaxConcurrentDownloads"
        :select-names="['1', '2', '3', '4', '5', '6', '8', '10']"
        :select-values="[1, 2, 3, 4, 5, 6, 8, 10]"
        :tooltip="t('Tooltips.Download Settings.Concurrent Downloads')"
        @change="updateYtDlpMaxConcurrentDownloads"
      />
      <FtInput
        input-type="number"
        min="0"
        :icon="['fas', 'gauge-high']"
        :label="t('Settings.Download Settings.Bandwidth Limit')"
        :placeholder="t('Form Inputs.Unlimited Hint')"
        :show-action-button="false"
        :show-label="true"
        :value="ytDlpDownloadBandwidthLimit"
        :tooltip="t('Tooltips.Download Settings.Bandwidth Limit')"
        @input="updateYtDlpDownloadBandwidthLimit"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { displayAndroidPath } from '../../../helpers/androidStorage'
import { ytDlp } from '../../../helpers/ytDlp'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtPathPicker from '../../FtPathPicker/FtPathPicker.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from '../../FtButton/FtButton.vue'
import AutomaticDownloadSettings from './AutomaticDownloadSettings.vue'
import DownloadTemplateSettings from './DownloadTemplateSettings.vue'

import store from '../../../store/index'
const isCapacitor = process.env.IS_CAPACITOR
const isIos = process.env.IS_IOS

const { t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const enableDownloads = computed(() => store.getters.getEnableDownloads)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)
const downloadFolderRequired = computed(() => (isCapacitor || window.ftElectron?.isFlatpak) && ytDlpDownloadFolderPath.value === '')

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadCustomArgs = computed(() => store.getters.getYtDlpDownloadCustomArgs)
const ytDlpMaxConcurrentDownloads = computed(() => store.getters.getYtDlpMaxConcurrentDownloads)
const ytDlpDownloadBandwidthLimit = computed(() => store.getters.getYtDlpDownloadBandwidthLimit)

/**
 * @param {boolean} value
 */
function updateEnableDownloads(value) {
  store.dispatch('updateEnableDownloads', value)
}

function openDownloads() {
  store.dispatch('showDownloadsFromSettings')
}

/**
 * @param {string} value
 */
function updateYtDlpDownloadCustomArgs(value) {
  store.dispatch('updateYtDlpDownloadCustomArgs', value)
}

function updateQueueSetting(action, value) {
  return store.dispatch(action, value)
}

function updateYtDlpMaxConcurrentDownloads(value) {
  return updateQueueSetting('updateYtDlpMaxConcurrentDownloads', value)
}

function updateYtDlpDownloadBandwidthLimit(value) {
  return updateQueueSetting('updateYtDlpDownloadBandwidthLimit', value)
}
</script>

<style scoped>
.downloadEnable :deep(.switch-ctn.compact) {
  margin-block: var(--settings-control-margin);
}

.downloadActions {
  align-items: stretch;
  gap: 10px;
  justify-content: center;
  margin-block: var(--settings-control-margin);
}

.downloadActions :deep(.btn) {
  flex: 1 1 230px;
  inline-size: 100%;
  max-inline-size: 300px;
  block-size: auto;
  margin: 0;
  white-space: normal;
}

.downloadPathInputs {
  column-gap: 12px;
}

.downloadPathInputs :deep(.ft-input-component),
.downloadQueueInputs > * {
  inline-size: 340px;
  min-inline-size: 0;
  max-inline-size: 100%;
}

.downloadQueueInputs {
  align-items: flex-end;
  column-gap: 12px;
}

.downloadQueueInputs :deep(.select) {
  inline-size: calc(340px + var(--select-indicator-space));
  margin-inline-end: calc(70px - var(--select-indicator-space));
}

</style>
