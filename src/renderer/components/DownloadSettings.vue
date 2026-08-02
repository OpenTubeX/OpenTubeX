<template>
  <FtSettingsSection
    :title="t('Settings.Download Settings.Download Settings')"
  >
    <FtFlexBox class="downloadPathInputs settingsFlexStart460px">
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
    <FtFlexBox>
      <p class="templatesHint">
        {{ t('Settings.Download Settings.Templates Hint') }}
      </p>
    </FtFlexBox>
    <FtFlexBox>
      <p class="templatesHint">
        {{ t('Settings.Download Settings.External Software Hint') }}
      </p>
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtInput from './FtInput/FtInput.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'

import store from '../store/index'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)

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

.templatesHint {
  margin-block: 0;
}
</style>
