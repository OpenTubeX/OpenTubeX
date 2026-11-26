<template>
  <div class="customizerLauncher">
    <FtButton
      data-settings-subpage="customize-interface"
      :label="t('Settings.Interface Customizer.Customize Interface')"
      :icon="['fas', 'sliders-h']"
      @click="open = true"
    />
  </div>

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
            <SubscriptionTabsPreview v-else-if="activeTabId === 'subscriptionTabs'" />
            <PlayerPreview
              v-else
              :state="activePreviewMode"
              :menu="activeTabId === 'controlBar'"
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
            <template v-else-if="activeTabId === 'subscriptionTabs'">
              <p class="customizerHint">
                {{ t('Settings.Subscription Tabs.Hint') }}
              </p>
              <ActionListCustomizer
                :definitions="subscriptionTabDefinitions"
                :items="store.getters.getSubscriptionTabs"
                :default-items="DEFAULT_SUBSCRIPTION_TABS"
                :update-items="items => store.dispatch('updateSubscriptionTabs', items)"
                item-id-attribute="data-subscription-tab-id"
                reorder-only
                :disabled-items="hiddenSubscriptionTabs"
                :disabled-label="t('Settings.Subscription Tabs.Hidden')"
              />
            </template>
            <ControlPlacementCustomizer v-else-if="activeTabId === 'controlBar'" />
            <template v-else>
              <p class="customizerHint">
                {{ t('Settings.Fullscreen Actions.Availability Hint') }}
              </p>
              <ActionListCustomizer
                :definitions="FULLSCREEN_ACTION_DEFINITIONS"
                :items="store.getters.getFullscreenActions"
                :default-items="DEFAULT_FULLSCREEN_ACTIONS"
                :update-items="items => store.dispatch('updateFullscreenActions', items)"
                item-id-attribute="data-fullscreen-action-id"
                :add-label="t('Settings.Fullscreen Actions.Add Action')"
                :empty-label="t('Settings.Fullscreen Actions.Empty')"
                :disabled-items="disabledFullscreenActions"
                :disabled-label="t('Settings.Fullscreen Actions.Disabled')"
              />
            </template>
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
import FtSettingsSubpage from '../../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtSyncedSettingIndicator from '../../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtTabs from '../../../FtTabs/FtTabs.vue'
import NavigationCustomizer from '../../../NavigationCustomizer/NavigationCustomizer.vue'
import QuickSettingsCustomizer from './QuickSettingsCustomizer.vue'
import SubscriptionTabsPreview from './SubscriptionTabsPreview.vue'
import NavigationPreview from './NavigationPreview.vue'
import ControlPlacementCustomizer from './ControlPlacementCustomizer.vue'
import PlayerPreview from './PlayerPreview.vue'

import store from '../../../../store/index'
import { DEFAULT_FULLSCREEN_ACTIONS, FULLSCREEN_ACTION_DEFINITIONS, getDisabledFullscreenActions } from '../../../../helpers/fullscreenActions'
import { DEFAULT_SUBSCRIPTION_TABS, SUBSCRIPTION_TAB_DEFINITIONS } from '../../../../helpers/subscriptionTabs'
import { supportsYtDlp } from '../../../../helpers/ytDlpCapabilities'
import { supportsPlatformFollows } from '../../../../helpers/platformFeed'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../../../helpers/overlayScrollbars'
import { usePhoneLayout } from '../../../../composables/usePhoneLayout'
import { useVisibleSubscriptionTabs } from '../../../../composables/useVisibleSubscriptionTabs'

const { t } = useI18n()
const idPrefix = `interface-customizer-${useId().replaceAll(':', '')}`
const open = ref(false)
const activeTabId = ref('navigation')
const usesPhoneLayout = usePhoneLayout()

// The side navigation switches to the bottom bar at this width.
const mobileNavigationLayout = window.matchMedia('(max-width: 680px)')
const usesMobileNavigation = ref(mobileNavigationLayout.matches)

function handleMobileNavigationLayoutChange(event) {
  usesMobileNavigation.value = event.matches
}

onMounted(() => mobileNavigationLayout.addEventListener('change', handleMobileNavigationLayoutChange))
onBeforeUnmount(() => mobileNavigationLayout.removeEventListener('change', handleMobileNavigationLayoutChange))

const disabledFullscreenActions = computed(() => [...getDisabledFullscreenActions(store.getters, supportsYtDlp)])

// Builds without yt-dlp have neither RSS feeds nor channels on other platforms.
const subscriptionTabDefinitions = SUBSCRIPTION_TAB_DEFINITIONS.filter(tab => (
  (tab.id !== 'feeds' || supportsYtDlp) && (tab.id !== 'platforms' || supportsPlatformFollows)
))
const visibleSubscriptionTabs = useVisibleSubscriptionTabs()
const hiddenSubscriptionTabs = computed(() => subscriptionTabDefinitions
  .map(tab => tab.id)
  .filter(id => !visibleSubscriptionTabs.value.includes(id)))

const tabs = computed(() => {
  const playingMode = { id: 'window', icon: ['fas', 'play'], label: t('Settings.Interface Customizer.Playing') }
  // Outside the phone layout, the playing preview of the controls shows the player menu open.
  const playingModes = [
    playingMode,
    ...(usesPhoneLayout.value ? [{ id: 'menu', icon: ['fas', 'gear'], label: t('Settings.Interface Customizer.Player Menu') }] : []),
  ]
  const fullscreenMode = { id: 'fullscreen', icon: ['fas', 'expand'], label: t('Settings.Interface Customizer.Fullscreen') }
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
      id: 'subscriptionTabs',
      icon: ['fas', 'subscriptions'],
      // The short page name keeps the narrow tab row on one line.
      label: t('Subscriptions.Subscriptions'),
      syncKey: 'subscriptionTabs',
      previewModes: [],
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
