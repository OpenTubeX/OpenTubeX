<template>
  <div
    ref="rootRef"
    class="settingsCategory dataStorageSettings"
  >
    <div
      class="dataStorageTabs"
      role="tablist"
      :aria-label="t('Settings.Data Settings.Data And Storage')"
    >
      <button
        :id="dataTabId"
        ref="dataTabRef"
        type="button"
        class="dataStorageTab"
        :class="{ selected: activeTab === 'data' }"
        role="tab"
        :aria-controls="dataPanelId"
        :aria-selected="activeTab === 'data'"
        :tabindex="activeTab === 'data' ? 0 : -1"
        data-settings-tab="data"
        @click="activateTab('data')"
        @keydown.left.right.prevent="activateTab('storage', true)"
        @keydown.home.prevent="activateTab('data', true)"
        @keydown.end.prevent="activateTab('storage', true)"
      >
        <FtIcon
          :icon="['fas', 'layer-group']"
          aria-hidden="true"
        />
        {{ t('Settings.Data Settings.Data Settings') }}
      </button>
      <button
        :id="storageTabId"
        ref="storageTabRef"
        type="button"
        class="dataStorageTab"
        :class="{ selected: activeTab === 'storage' }"
        role="tab"
        :aria-controls="storagePanelId"
        :aria-selected="activeTab === 'storage'"
        :tabindex="activeTab === 'storage' ? 0 : -1"
        data-settings-tab="storage"
        @click="activateTab('storage')"
        @keydown.left.right.prevent="activateTab('data', true)"
        @keydown.home.prevent="activateTab('data', true)"
        @keydown.end.prevent="activateTab('storage', true)"
      >
        <FtIcon
          :icon="['fas', 'database']"
          aria-hidden="true"
        />
        {{ t('Settings.Storage Settings.Storage') }}
      </button>
    </div>

    <div
      v-if="activeTab === 'data'"
      :id="dataPanelId"
      class="dataStoragePanel"
      role="tabpanel"
      :aria-labelledby="dataTabId"
    >
      <DataSettings />
    </div>
    <div
      v-else
      :id="storagePanelId"
      class="dataStoragePanel"
      role="tabpanel"
      :aria-labelledby="storageTabId"
    >
      <StorageSettings />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { nextTick, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import DataSettings from '../DataSettings/DataSettings.vue'
import StorageSettings from '../StorageSettings/StorageSettings.vue'

import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

const { t } = useI18n()
const props = defineProps({
  initialTab: {
    type: String,
    default: 'data',
    validator: value => ['data', 'storage'].includes(value)
  }
})
const emit = defineEmits(['update:active-tab'])
const activeTab = ref(props.initialTab)
const rootRef = useTemplateRef('rootRef')
const dataTabRef = useTemplateRef('dataTabRef')
const storageTabRef = useTemplateRef('storageTabRef')
const dataTabId = useId()
const dataPanelId = useId()
const storageTabId = useId()
const storagePanelId = useId()

async function activateTab(tab, focus = false) {
  if (!['data', 'storage'].includes(tab)) return
  const changed = activeTab.value !== tab
  activeTab.value = tab
  emit('update:active-tab', tab)
  await nextTick()

  if (focus) {
    const tabElement = tab === 'data' ? dataTabRef.value : storageTabRef.value
    tabElement?.focus()
  }
  if (changed) {
    const scrollViewport = rootRef.value?.closest('.settingsContent')
    if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
  }
}

defineExpose({ activateTab })
</script>

<style scoped src="./DataStorageSettings.css" />
