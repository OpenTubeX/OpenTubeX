<template>
  <div class="settingsCategory">
    <TabUnloadingSettings v-if="USING_ELECTRON" />
    <GeneralSettings mode="providers" />
    <ExternalPlayerSettings v-if="USING_ELECTRON" />
    <ExternalSoftwareSettings v-if="USING_ELECTRON || (IS_CAPACITOR && supportsYtDlp)" />
    <ProxySettings v-if="USING_ELECTRON || IS_CAPACITOR" />
    <ExperimentalSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import TabUnloadingSettings from '../TabUnloadingSettings.vue'
import ExperimentalSettings from '../ExperimentalSettings/ExperimentalSettings.vue'
import ExternalPlayerSettings from '../ExternalPlayerSettings.vue'
import ExternalSoftwareSettings from '../ExternalSoftwareSettings.vue'
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'
import ProxySettings from '../ProxySettings/ProxySettings.vue'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'

const IS_CAPACITOR = !!process.env.IS_CAPACITOR && !process.env.IS_IOS
const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
