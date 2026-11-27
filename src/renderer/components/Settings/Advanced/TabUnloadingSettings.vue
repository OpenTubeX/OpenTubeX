<template>
  <FtSettingsSection
    :title="t('Settings.Tab Unloading.Automatically unload tabs')"
    :icon="['fas', 'memory']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Settings.Tab Unloading.Automatic unloading help')"
        :title="t('Settings.Tab Unloading.Automatically unload tabs')"
        :icon="['fas', 'memory']"
      >
        <FtToggleSwitch
          :label="t('Settings.Tab Unloading.Automatically unload tabs')"
          hide-label
          :default-value="store.getters.getAutoUnloadTabs"
          setting-key="autoUnloadTabs"
          @change="store.dispatch('updateAutoUnloadTabs', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :description="t('Settings.Tab Unloading.Memory threshold help')"
        :title="t('Settings.Tab Unloading.Memory threshold')"
        :icon="['fas', 'gauge']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Tab Unloading.Memory threshold')"
          :value="store.getters.getAutoUnloadMemoryThreshold"
          :select-values="[10, 20, 30, 40, 50, 60, 70, 80, 90]"
          :select-names="['10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%']"
          :disabled="!store.getters.getAutoUnloadTabs"
          setting-key="autoUnloadMemoryThreshold"
          @change="store.dispatch('updateAutoUnloadMemoryThreshold', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="t('Settings.Tab Unloading.Tabs to unload')"
        :icon="['fas', 'clone']"
      >
        <FtSelect
          hide-label
          :placeholder="t('Settings.Tab Unloading.Tabs to unload')"
          :value="store.getters.getAutoUnloadTabPercentage"
          :select-values="[10, 25, 50, 75, 100]"
          :select-names="['10%', '25%', '50%', '75%', '100%']"
          :disabled="!store.getters.getAutoUnloadTabs"
          setting-key="autoUnloadTabPercentage"
          @change="store.dispatch('updateAutoUnloadTabPercentage', $event)"
        />
      </FtSettingsRow>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import store from '../../../store/index'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'

const { t } = useI18n()
</script>
