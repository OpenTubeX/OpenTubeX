<template>
  <FtSettingsSection :title="t('Settings.Tab Unloading.Automatically unload tabs')">
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Tab Unloading.Automatically unload tabs')"
        :tooltip="t('Settings.Tab Unloading.Automatic unloading help')"
        :default-value="store.getters.getAutoUnloadTabs"
        setting-key="autoUnloadTabs"
        compact
        @change="store.dispatch('updateAutoUnloadTabs', $event)"
      />
    </FtFlexBox>
    <div class="switchGrid generalSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Tab Unloading.Memory threshold')"
        :tooltip="t('Settings.Tab Unloading.Memory threshold help')"
        :value="store.getters.getAutoUnloadMemoryThreshold"
        :select-values="[10, 20, 30, 40, 50, 60, 70, 80, 90]"
        :select-names="['10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%']"
        :disabled="!store.getters.getAutoUnloadTabs"
        :icon="['fas', 'memory']"
        setting-key="autoUnloadMemoryThreshold"
        @change="store.dispatch('updateAutoUnloadMemoryThreshold', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Tab Unloading.Tabs to unload')"
        :value="store.getters.getAutoUnloadTabPercentage"
        :select-values="[10, 25, 50, 75, 100]"
        :select-names="['10%', '25%', '50%', '75%', '100%']"
        :disabled="!store.getters.getAutoUnloadTabs"
        :icon="['fas', 'memory']"
        setting-key="autoUnloadTabPercentage"
        @change="store.dispatch('updateAutoUnloadTabPercentage', $event)"
      />
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import store from '../../../store/index'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'

const { t } = useI18n()
</script>

<style scoped src="../generalSelectGrid.css" />
