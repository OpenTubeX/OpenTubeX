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
      <DownloadTemplateSettings v-if="!isIos" />
      <AutomaticDownloadSettings v-if="!isIos" />
    </FtFlexBox>
    <FtFlexBox
      v-if="enableDownloads"
      class="downloadPathInputs settingsFlexStart460px"
    >
      <FtInput
        :label="t('Settings.Download Settings.Download Folder')"
        placeholder=""
        :supporting-text="t('Form Inputs.Download Folder Hint')"
        :show-action-button="true"
        :action-button-label="t('Settings.Download Settings.Choose Download Folder')"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="displayAndroidPath(ytDlpDownloadFolderPath)"
        :readonly="isCapacitor"
        :tooltip="t('Tooltips.Download Settings.Download Folder')"
        @input="updateYtDlpDownloadFolderPath"
        @click="chooseDownloadFolder"
      />
      <FtInput
        v-if="!isIos"
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
      v-if="enableDownloads && !isIos"
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
import { displayAndroidPath } from '../helpers/androidStorage'
import { ytDlp } from '../helpers/ytDlp'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtInput from './FtInput/FtInput.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from './FtButton/FtButton.vue'
import AutomaticDownloadSettings from './AutomaticDownloadSettings/AutomaticDownloadSettings.vue'
import DownloadTemplateSettings from './DownloadTemplateSettings/DownloadTemplateSettings.vue'

import store from '../store/index'
const isCapacitor = process.env.IS_CAPACITOR
const isIos = process.env.IS_IOS

const { t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const enableDownloads = computed(() => store.getters.getEnableDownloads)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)

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
function updateYtDlpDownloadFolderPath(value) {
  if (!isCapacitor) store.dispatch('updateYtDlpDownloadFolderPath', value)
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

async function chooseDownloadFolder() {
  const path = await ytDlp.ytDlpChooseDownloadFolder(ytDlpDownloadFolderPath.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpDownloadFolderPath', path)
  }
}
</script>

<style scoped>
.downloadEnable :deep(.switch-ctn.compact) {
  margin-block: 0;
}

.downloadActions {
  align-items: stretch;
  gap: 10px;
  justify-content: center;
  margin-block: 20px;
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
  margin-block-start: 16px;
}

.downloadQueueInputs :deep(.ft-input-component) {
  margin-block-start: 30px;
}

.downloadQueueInputs :deep(.inputWrapper) {
  margin-block-end: 0;
}

.downloadQueueInputs :deep(.ft-input) {
  margin-block-end: 0;
}

</style>
