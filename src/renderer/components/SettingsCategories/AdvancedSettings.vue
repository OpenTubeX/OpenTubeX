<template>
  <div class="settingsCategory">
    <GeneralSettings mode="providers" />
    <ExternalPlayerSettings v-if="USING_ELECTRON" />
    <ExternalSoftwareSettings v-if="USING_ELECTRON" />
    <ProxySettings v-if="USING_ELECTRON" />
    <ExperimentalSettings v-if="USING_ELECTRON" />
  </div>
</template>

<script setup>
import ExperimentalSettings from '../ExperimentalSettings/ExperimentalSettings.vue'
import ExternalPlayerSettings from '../ExternalPlayerSettings.vue'
import ExternalSoftwareSettings from '../ExternalSoftwareSettings.vue'
import GeneralSettings from '../GeneralSettings/GeneralSettings.vue'
import ProxySettings from '../ProxySettings/ProxySettings.vue'

const USING_ELECTRON = !!process.env.IS_ELECTRON
</script>
