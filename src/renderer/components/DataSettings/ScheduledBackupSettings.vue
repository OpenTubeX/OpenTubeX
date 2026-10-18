<template>
  <FtSettingsSection
    class="scheduledBackups"
    :title="t('Settings.Data Settings.Scheduled backups')"
  >
    <p>{{ t('Settings.Data Settings.Scheduled backup description') }}</p>
    <FtFlexBox class="backupFolderChoice">
      <FtButton
        :label="t('Settings.Data Settings.Choose backup folder')"
        :icon="['fas', 'folder-open']"
        :disabled="choosingFolder"
        @click="chooseFolder"
      />
    </FtFlexBox>
    <p class="backupFolder">
      {{ directory || t('Settings.Data Settings.No backup folder selected') }}
    </p>
    <div class="backupControls">
      <FtToggleSwitch
        :label="t('Settings.Data Settings.Enable scheduled backups')"
        :default-value="enabled"
        controlled
        :disabled="!directory"
        @change="update('scheduledBackupEnabled', $event)"
      />
      <FtSelect
        :placeholder="t('Settings.Data Settings.Backup frequency')"
        :icon="['fas', 'clock']"
        :value="String(interval)"
        :select-names="[t('Settings.Data Settings.Daily'), t('Settings.Data Settings.Weekly'), t('Settings.Data Settings.Every 30 days')]"
        :select-values="['1', '7', '30']"
        @change="update('scheduledBackupInterval', Number($event))"
      />
      <FtSelect
        :placeholder="t('Settings.Data Settings.Backups to keep')"
        :icon="['fas', 'layer-group']"
        :value="String(keepCount)"
        :select-names="['1', '3', '5', '10', '20']"
        :select-values="['1', '3', '5', '10', '20']"
        @change="update('scheduledBackupKeepCount', Number($event))"
      />
    </div>
    <div role="status">
      <p>{{ lastBackup }}</p>
      <p v-if="status.error">
        {{ t('Settings.Data Settings.Scheduled backup failed') }}
      </p>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'

const { t, locale } = useI18n()
const choosingFolder = ref(false)
const directory = computed(() => store.getters.getScheduledBackupFolderPath)
const enabled = computed(() => store.getters.getScheduledBackupEnabled)
const interval = computed(() => store.getters.getScheduledBackupInterval)
const keepCount = computed(() => store.getters.getScheduledBackupKeepCount)
const status = computed(() => {
  const value = store.getters.getScheduledBackupStatus
  return value?.directory === directory.value ? value : {}
})
const lastBackup = computed(() => status.value.lastBackupAt
  ? t('Settings.Data Settings.Last scheduled backup', { date: new Date(status.value.lastBackupAt).toLocaleString(locale.value) })
  : t('Settings.Data Settings.No scheduled backup yet'))

async function update(key, value) {
  try {
    await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
  } catch {
    showToast({ message: t('Settings.Data Settings.Unable to write file'), icon: ['fas', 'circle-exclamation'] })
  }
}

async function chooseFolder() {
  choosingFolder.value = true
  try {
    await window.ftElectron.chooseScheduledBackupFolder()
  } catch (error) {
    showToast({ message: `${t('Settings.Data Settings.Unable to write file')}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  } finally {
    choosingFolder.value = false
  }
}
</script>

<style scoped src="./ScheduledBackupSettings.css" />
