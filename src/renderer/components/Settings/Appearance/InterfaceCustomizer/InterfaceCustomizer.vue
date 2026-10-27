<template>
  <FtSettingsSection :title="t('Settings.Navigation and Controls')">
    <div class="customizerLauncher">
      <FtButton
        data-settings-subpage="customize-interface"
        :label="t('Settings.Interface Customizer.Customize Interface')"
        :icon="['fas', 'sliders-h']"
        @click="open = true"
      />
    </div>
  </FtSettingsSection>

  <FtSettingsSubpage
    :open="open"
    :title="t('Settings.Interface Customizer.Customize Interface')"
    :icon="['fas', 'sliders-h']"
    flush
    @close="open = false"
  >
    <template #breadcrumb-action>
      <FtSyncedSettingIndicator
        v-if="activeTab.syncKey"
        :setting-key="activeTab.syncKey"
      />
    </template>
    <div class="interfaceCustomizer">
      <div class="customizerHeader">
        <FtTabs
          class="customizerTabs"
          :aria-label="t('Settings.Interface Customizer.Customize Interface')"
          @keydown="handleTabKeydown($event, tabs, activeTabId, selectTab)"
        >
          <button
            v-for="tab in tabs"
            :id="`${idPrefix}-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="tab.id === activeTabId"
            :aria-controls="`${idPrefix}-panel`"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :data-settings-subpage-tab="tab.id"
            :title="tab.label"
            @click="selectTab(tab.id)"
          >
            <FtIcon
              :icon="tab.icon"
              aria-hidden="true"
            />
            <span class="tabLabel">{{ tab.label }}</span>
          </button>
        </FtTabs>
      </div>
      <div
        :id="`${idPrefix}-panel`"
        class="customizerPanel"
        role="tabpanel"
        :aria-labelledby="`${idPrefix}-tab-${activeTabId}`"
      >
        <section
          class="customizerPreview"
          :aria-label="t('Settings.Interface Customizer.Preview')"
        >
          <FtTabs
            v-if="activeTab.previewModes.length > 1"
            class="previewModes"
            variant="segmented"
            :aria-label="t('Settings.Interface Customizer.Preview')"
            @keydown="handleTabKeydown($event, activeTab.previewModes, activePreviewMode, selectPreviewMode)"
          >
            <button
              v-for="mode in activeTab.previewModes"
              :id="`${idPrefix}-preview-mode-${mode.id}`"
              :key="mode.id"
              type="button"
              role="tab"
              :aria-selected="mode.id === activePreviewMode"
              :aria-controls="`${idPrefix}-preview`"
              :tabindex="mode.id === activePreviewMode ? 0 : -1"
              :data-preview-mode="mode.id"
              :title="mode.label"
              @click="selectPreviewMode(mode.id)"
            >
              <FtIcon
                :icon="mode.icon"
                aria-hidden="true"
              />
              <span class="tabLabel">{{ mode.label }}</span>
            </button>
          </FtTabs>
          <div
            :id="`${idPrefix}-preview`"
            class="previewStage"
            :role="activeTab.previewModes.length > 1 ? 'tabpanel' : null"
            :aria-labelledby="activeTab.previewModes.length > 1 ? `${idPrefix}-preview-mode-${activePreviewMode}` : null"
          >
            <NavigationPreview
              v-if="activeTabId === 'navigation'"
              :layout="activePreviewMode"
            />
            <div
              v-else-if="activeTabId === 'quickSettings'"
              class="quickSettingsStage"
            >
              <FtQuickSettingsMenu preview />
            </div>
            <PlayerPreview
              v-else
              :state="activePreviewMode"
            />
          </div>
        </section>
        <div
          :key="activeTabId"
          ref="editorScrollRef"
          v-overlay-scrollbars
          class="customizerEditorScroll"
        >
          <div class="customizerEditor">
            <NavigationCustomizer v-if="activeTabId === 'navigation'" />
            <QuickSettingsCustomizer v-else-if="activeTabId === 'quickSettings'" />
            <PlayerAppearanceEditor v-else-if="activeTabId === 'player'" />
            <ActionListCustomizer
              v-else-if="activeTabId === 'controlBar'"
              :definitions="controlBarButtonDefinitions"
              :items="store.getters.getControlBarButtons"
              :default-items="DEFAULT_CONTROL_BAR_BUTTONS"
              :update-items="items => store.dispatch('updateControlBarButtons', items)"
              item-id-attribute="data-control-bar-button-id"
              :add-label="t('Settings.Control Bar.Add Button')"
            />
            <ActionListCustomizer
              v-else
              :definitions="FULLSCREEN_ACTION_DEFINITIONS"
              :items="store.getters.getFullscreenActions"
              :default-items="DEFAULT_FULLSCREEN_ACTIONS"
              :update-items="items => store.dispatch('updateFullscreenActions', items)"
              item-id-attribute="data-fullscreen-action-id"
              :add-label="t('Settings.Fullscreen Actions.Add Action')"
              :empty-label="t('Settings.Fullscreen Actions.Empty')"
            />
          </div>
        </div>
      </div>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ActionListCustomizer from '../../../ActionListCustomizer/ActionListCustomizer.vue'
import FtButton from '../../../FtButton/FtButton.vue'
import FtQuickSettingsMenu from '../../../FtQuickSettingsMenu/FtQuickSettingsMenu.vue'
import FtSettingsSection from '../../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsSubpage from '../../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSyncedSettingIndicator from '../../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtTabs from '../../../FtTabs/FtTabs.vue'
import NavigationCustomizer from '../../../NavigationCustomizer/NavigationCustomizer.vue'
import QuickSettingsCustomizer from './QuickSettingsCustomizer.vue'
import NavigationPreview from './NavigationPreview.vue'
import PlayerAppearanceEditor from './PlayerAppearanceEditor.vue'
import PlayerPreview from './PlayerPreview.vue'

import store from '../../../../store/index'
import { getControlBarButtonDefinitions, DEFAULT_CONTROL_BAR_BUTTONS } from '../../../../helpers/controlBarButtons'
import { DEFAULT_FULLSCREEN_ACTIONS, FULLSCREEN_ACTION_DEFINITIONS } from '../../../../helpers/fullscreenActions'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../../../helpers/overlayScrollbars'
import { usePhoneLayout } from '../../../../composables/usePhoneLayout'

const { t } = useI18n()
const idPrefix = `interface-customizer-${useId().replaceAll(':', '')}`
const open = ref(false)
const activeTabId = ref('navigation')
const controlBarButtonDefinitions = getControlBarButtonDefinitions()
const usesPhoneLayout = usePhoneLayout()

// The side navigation switches to the bottom bar at this width.
const mobileNavigationLayout = window.matchMedia('(max-width: 680px)')
const usesMobileNavigation = ref(mobileNavigationLayout.matches)

function handleMobileNavigationLayoutChange(event) {
  usesMobileNavigation.value = event.matches
}

onMounted(() => mobileNavigationLayout.addEventListener('change', handleMobileNavigationLayoutChange))
onBeforeUnmount(() => mobileNavigationLayout.removeEventListener('change', handleMobileNavigationLayoutChange))

const tabs = computed(() => {
  // Outside the phone layout, the playing preview shows the player menu open.
  const playingModes = [
    { id: 'window', icon: ['fas', 'play'], label: t('Settings.Interface Customizer.Playing') },
    ...(usesPhoneLayout.value ? [{ id: 'menu', icon: ['fas', 'gear'], label: t('Settings.Interface Customizer.Player Menu') }] : []),
  ]
  const fullscreenMode = { id: 'fullscreen', icon: ['fas', 'expand'], label: t('Settings.Interface Customizer.Fullscreen') }
  const pausedMode = { id: 'paused', icon: ['fas', 'pause'], label: t('Settings.Interface Customizer.Paused') }
  return [
    {
      id: 'navigation',
      icon: ['fas', 'bars'],
      label: t('Settings.General Settings.Navigation.Navigation'),
      syncKey: 'navigationItems',
      previewModes: [
        { id: 'desktop', icon: ['fas', 'display'], label: t('Settings.Interface Customizer.Desktop') },
        { id: 'mobile', icon: ['fas', 'smartphone'], label: t('Settings.Interface Customizer.Mobile') },
      ],
      // Start with the layout the app is currently using.
      defaultPreviewMode: usesMobileNavigation.value ? 'mobile' : 'desktop',
    },
    {
      id: 'quickSettings',
      icon: ['fas', 'sliders-h'],
      label: t('Settings.Quick Settings.Quick Settings'),
      syncKey: 'quickSettings',
      previewModes: [],
    },
    {
      id: 'player',
      icon: ['fas', 'circle-play'],
      label: t('Settings.Interface Customizer.Player'),
      syncKey: null,
      previewModes: [...playingModes, fullscreenMode, pausedMode],
    },
    {
      id: 'controlBar',
      icon: ['fas', 'control-bar'],
      label: t('Settings.Control Bar.Title'),
      // Each device keeps its own control bar, so this tab offers no sync toggle.
      syncKey: null,
      // Buttons removed from the control bar move into the player menu.
      previewModes: playingModes,
    },
    {
      id: 'fullscreenActions',
      icon: ['fas', 'expand'],
      label: t('Settings.Fullscreen Actions.Title'),
      syncKey: 'fullscreenActions',
      previewModes: [fullscreenMode],
    },
  ]
})

const activeTab = computed(() => tabs.value.find(tab => tab.id === activeTabId.value))

// Each tab remembers the preview state last chosen for it.
const previewModes = reactive({})
// The player menu state only exists in the phone layout.
const activePreviewMode = computed(() => {
  const modes = activeTab.value.previewModes
  const remembered = previewModes[activeTabId.value]
  return modes.some(mode => mode.id === remembered)
    ? remembered
    : activeTab.value.defaultPreviewMode ?? modes[0]?.id
})

const editorScrollRef = useTemplateRef('editorScrollRef')
// Each tab returns to the editor position it was left at.
const editorScrollTops = {}

async function selectTab(tabId) {
  if (tabId === activeTabId.value) return
  if (editorScrollRef.value) editorScrollTops[activeTabId.value] = editorScrollRef.value.scrollTop
  activeTabId.value = tabId
  await nextTick()
  const scroller = editorScrollRef.value
  if (!scroller) return
  restoreOverlayScrollTop(scroller, editorScrollTops[tabId] ?? 0)
  // The tab's content may have become shorter while it was hidden.
  clampOverlayScrollTop(scroller, scroller.querySelector('.customizerEditor'))
}

function selectPreviewMode(modeId) {
  previewModes[activeTabId.value] = modeId
}

async function handleTabKeydown(event, items, selectedId, select) {
  const index = items.findIndex(item => item.id === selectedId)
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
  const offsets = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }
  let nextIndex
  if (event.key in offsets) {
    nextIndex = (index + offsets[event.key] + items.length) % items.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = items.length - 1
  } else {
    return
  }

  event.preventDefault()
  const tablist = event.currentTarget
  select(items[nextIndex].id)
  await nextTick()
  tablist.querySelector('[role="tab"][aria-selected="true"]')?.focus()
}
</script>

<style scoped src="./InterfaceCustomizer.css" />
