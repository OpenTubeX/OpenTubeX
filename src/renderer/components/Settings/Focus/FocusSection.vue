<template>
  <div
    ref="rootRef"
    class="settingsCategory"
  >
    <Teleport :to="`#${settingsWindow.contentHeaderTargetId}`">
      <FtTabs
        class="focusTabs"
        variant="segmented"
        role="tablist"
        :aria-label="t('Settings.Distraction Free Settings.Distraction Free Settings')"
      >
        <button
          v-for="(tab, index) in tabs"
          :id="`${idPrefix}-${tab.id}-tab`"
          :key="tab.id"
          ref="tabRefs"
          type="button"
          class="focusTab"
          :class="{ selected: activeTab === tab.id }"
          role="tab"
          :aria-controls="`${idPrefix}-${tab.id}-panel`"
          :aria-selected="activeTab === tab.id"
          :tabindex="activeTab === tab.id ? 0 : -1"
          :data-settings-tab="tab.id"
          @click="activateTab(tab.id)"
          @keydown.left.prevent="activateTab(tabs.at(index - 1).id, true)"
          @keydown.right.prevent="activateTab(tabs[(index + 1) % tabs.length].id, true)"
          @keydown.home.prevent="activateTab(tabs[0].id, true)"
          @keydown.end.prevent="activateTab(tabs.at(-1).id, true)"
        >
          <FtIcon
            :icon="tab.icon"
            aria-hidden="true"
          />
          {{ tab.label }}
        </button>
      </FtTabs>
    </Teleport>

    <div
      :id="`${idPrefix}-${activeTab}-panel`"
      class="focusPanel"
      role="tabpanel"
      :aria-labelledby="`${idPrefix}-${activeTab}-tab`"
    >
      <DistractionSettings v-if="activeTab === 'distraction'" />
      <DigitalWellbeingSettings v-else-if="activeTab === 'wellbeing'" />
      <ParentalControlSettings v-else />
    </div>
  </div>
</template>

<script setup>
import FtTabs from '../../FtTabs/FtTabs.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import DistractionSettings from './DistractionSettings.vue'
import DigitalWellbeingSettings from './DigitalWellbeingSettings.vue'
import ParentalControlSettings from './ParentalControlSettings.vue'

import { settingsSubpageKey } from '../../FtSettingsSubpage/settingsSubpage'

import { restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'

const TAB_IDS = ['distraction', 'wellbeing', 'parental']

const { t } = useI18n()
const settingsWindow = inject(settingsSubpageKey)
const props = defineProps({
  initialTab: {
    type: String,
    default: 'distraction',
    validator: value => ['distraction', 'wellbeing', 'parental'].includes(value)
  }
})
const emit = defineEmits(['update:active-tab'])
const tabs = computed(() => [
  {
    id: 'distraction',
    label: t('Settings.Distraction Free Settings.Distraction Free Settings'),
    icon: ['fas', 'eye-slash'],
  },
  {
    id: 'wellbeing',
    label: t('Settings.Distraction Free Settings.Sections.Digital Wellbeing'),
    icon: ['fas', 'heart'],
  },
  {
    id: 'parental',
    label: t('Settings.Parental Control Settings.Parental Control Settings'),
    icon: ['fas', 'shield-halved'],
  },
])
const activeTab = ref(props.initialTab)
const rootRef = useTemplateRef('rootRef')
const tabRefs = useTemplateRef('tabRefs')
const idPrefix = useId()

async function activateTab(tab, focus = false) {
  if (!TAB_IDS.includes(tab)) return
  const changed = activeTab.value !== tab
  activeTab.value = tab
  emit('update:active-tab', tab)
  await nextTick()

  if (focus) {
    tabRefs.value?.find(element => element.dataset.settingsTab === tab)?.focus()
  }
  if (changed) {
    const scrollViewport = rootRef.value?.closest('.settingsContent')
    if (scrollViewport) restoreOverlayScrollTop(scrollViewport, 0)
  }
}

defineExpose({ activateTab })
</script>

<style scoped src="./FocusSection.css" />
