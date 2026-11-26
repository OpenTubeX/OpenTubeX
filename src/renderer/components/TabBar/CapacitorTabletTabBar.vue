<template>
  <div
    v-bind="$attrs"
    class="capacitorTabletTabBar"
    data-tutorial="tabs"
    :style="tabWidthStyle"
    :inert="$attrs.inert && !holding"
  >
    <div
      ref="tabsViewportRef"
      v-overlay-scrollbars
      class="capacitorTabletTabsViewport"
    >
      <div
        class="capacitorTabletTabs"
        role="group"
        tabindex="-1"
        :aria-label="t('Tab Organizer.Title')"
        @keydown="handleTabListKeydown"
      >
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="capacitorTabletTab"
          :class="{
            active: tab.id === activeTabId,
            unloaded: tab.isUnloaded,
            holding: heldTabId === tab.id,
            dragging: heldTabId === tab.id && dragging,
            settling: heldTabId === tab.id && settling,
            noTransition: suppressTransitions,
          }"
          :style="dragStyle(tab.id)"
          @pointerdown="!selecting && startDrag($event, tab.id)"
          @pointermove="moveDrag"
          @pointerup="finishDrag"
          @pointercancel="cancelDrag"
          @touchmove="preventHoldScroll"
          @contextmenu.prevent.stop="handleContextMenu($event, tab.id)"
        >
          <button
            type="button"
            class="capacitorTabletTabTarget"
            :data-tab-id="tab.id"
            :aria-pressed="tab.id === activeTabId"
            :aria-label="tabAriaLabel(tab)"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :title="tabTitle(tab)"
            @click="!suppressClick && activateTab(tab.id)"
            @keydown="handleTabTargetKeydown($event, tab.id)"
          >
            <span
              v-if="tab.isLoading || showTabIcons"
              class="capacitorTabletTabIcon"
            >
              <span
                v-if="tab.isLoading"
                class="tabLoadingDot"
                aria-hidden="true"
              />
              <FtRetryImage
                v-else-if="getTabAvatarUrl(tab)"
                :fallback-icon="getTabPageIcon(tab) || ['fas', 'display']"
                :src="getTabAvatarUrl(tab)"
                class="capacitorTabletTabAvatar"
                alt=""
                draggable="false"
              />
              <FtIcon
                v-else-if="getTabPageIcon(tab)"
                :icon="getTabPageIcon(tab)"
                aria-hidden="true"
              />
            </span>
            <FtIcon
              v-if="tab.isPinned"
              :icon="['fas', 'thumbtack']"
              class="capacitorTabletTabStateIcon"
              aria-hidden="true"
            />
            <FtIcon
              v-if="tab.isIncognito"
              :icon="['fas', 'user-secret']"
              class="capacitorTabletTabStateIcon"
              aria-hidden="true"
            />
            <FtIcon
              v-if="isTabPlaying(tab)"
              :icon="['fas', 'play']"
              class="capacitorTabletTabStateIcon"
              aria-hidden="true"
            />
            <FtIcon
              v-else-if="tab.isUnloaded && tab.automaticallyUnloaded"
              :icon="['fas', 'memory']"
              class="capacitorTabletTabStateIcon"
              aria-hidden="true"
            />
            <span
              class="capacitorTabletTabTitle"
              dir="auto"
            >{{ tabTitle(tab) }}</span>
          </button>
          <label
            v-if="selecting"
            class="capacitorTabletTabSelection"
            @pointerdown.stop
          >
            <input
              type="checkbox"
              :checked="selectedTabIds.has(tab.id)"
              :aria-label="t('Tab Organizer.Select Tab', { title: tabTitle(tab) })"
              @change="toggleTabSelection(tab.id)"
            >
          </label>
          <button
            v-else
            type="button"
            class="capacitorTabletTabClose"
            :aria-label="t('Tab Organizer.Close Tab', { title: tabTitle(tab) })"
            :title="t('Close Tab')"
            @click="closeTab(tab.id)"
          >
            <FtIcon
              :icon="['fas', 'xmark']"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
    <CapacitorTabSelectionControls
      v-if="selecting"
      :count="selectedTabIds.size"
      :busy="closingTabs || runningSelectionAction"
      :can-pin="canPinSelectedTabs"
      :can-unpin="canUnpinSelectedTabs"
      :can-load="canLoadSelectedTabs"
      :can-unload="canUnloadSelectedTabs"
      :can-copy-links="canCopySelectedTabLinks"
      :all-youtube-links="selectedTabLinks.every(link => link?.isYouTube)"
      :can-select-all="tabs.some(tab => !selectedTabIds.has(tab.id))"
      @action="runSelectedTabAction"
      @select-all="selectAllTabs(tabs.map(tab => tab.id))"
      @close="closeSelectedTabs"
      @cancel="clearSelection"
    />
    <button
      v-if="!selecting"
      type="button"
      class="capacitorTabletNewTab"
      :aria-label="t('New Tab')"
      :title="t('New Tab')"
      @click="createTab"
    >
      <FtIcon
        :icon="['fas', 'plus']"
        aria-hidden="true"
      />
    </button>
    <button
      v-if="!selecting"
      type="button"
      class="capacitorTabletNewTab capacitorTabletNewIncognitoTab"
      :aria-label="t('New Incognito Tab')"
      :title="t('New Incognito Tab')"
      @click="createIncognitoTab"
    >
      <FtIcon
        :icon="['fas', 'user-secret']"
        aria-hidden="true"
      />
    </button>
    <button
      v-if="!selecting && closedTabs.length > 0"
      type="button"
      class="capacitorTabletNewTab"
      :aria-label="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
      :aria-description="t('Tab Organizer.Recently Closed Hint')"
      :title="t('KeyboardShortcutPrompt.Reopen Closed Tab')"
      @pointerdown="reopenHold.start"
      @pointerup="reopenHold.cancel"
      @pointercancel="reopenHold.cancel"
      @pointerleave="reopenHold.cancel"
      @contextmenu.prevent.stop="reopenHold.contextMenu"
      @keydown="reopenHold.keydown"
      @click="reopenHold.click(() => restoreClosedTab())"
    >
      <FtIcon
        :icon="['fas', 'clock-rotate-left']"
        aria-hidden="true"
      />
    </button>
    <Teleport to="body">
      <CapacitorTabActionsMenu
        :related-tab-ids="relatedTabIds"
        :tab="actionTab"
        :title="actionTab ? tabTitle(actionTab) : ''"
        :share-link="actionTabShareLink"
        :can-toggle-loaded="canToggleActionTabLoaded"
        mode="tablet"
        @select="selectActionTab"
        @close-related="closeRelatedTabs"
        @close="closeActionTab"
        @copy-link="copyActionTabLink"
        @dismiss="closeTabActions"
        @closed="releaseTabActions"
        @duplicate="duplicateActionTab"
        @reload="reloadActionTab"
        @toggle-loaded="toggleActionTabLoaded"
        @toggle-pinned="toggleActionTabPinned"
      />
      <CapacitorClosedTabsMenu
        :open="closedTabsMenuOpen"
        @dismiss="closedTabsMenuOpen = false"
        @closed="releaseTabActions"
        @restore="restoreClosedTab"
        @clear="clearClosedTabs"
      />
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { fixedTabWidthStyle } from '../../constants/tabWidth'
import { clampOverlayScrollLeft } from '../../helpers/overlayScrollbars'
import store from '../../store/index'
import { getTabAvatarUrl, getTabPageIcon } from '../../tabs/tabPreview'
import FtRetryImage from '../FtRetryImage.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'
import CapacitorTabSelectionControls from './CapacitorTabSelectionControls.vue'
import CapacitorTabActionsMenu from './CapacitorTabActionsMenu.vue'
import CapacitorClosedTabsMenu from './CapacitorClosedTabsMenu.vue'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { useHoldAction } from './useHoldAction'
import { useCapacitorTabActions } from './useCapacitorTabActions'
import { useTabletTabReorder } from './useTabletTabReorder'

// Keep the captured gesture alive while its own actions menu is open.
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const emit = defineEmits(['request-exit'])
const promptId = useId()
const tabsViewportRef = useTemplateRef('tabsViewportRef')
const tabs = computed(() => store.getters.getTabs)
const activeTabId = computed(() => store.getters.getActiveTabId)
const presentedTabId = computed(() => store.getters.getPresentedTabId)
const closedTabs = computed(() => store.getters.getClosedTabs)
const closedTabsMenuOpen = ref(false)
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const tabWidthStyle = computed(() => fixedTabWidthStyle(store.getters.getFixedTabWidth))
const {
  selecting,
  selectedTabIds,
  closingTabs,
  runningSelectionAction,
  canPinSelectedTabs,
  canUnpinSelectedTabs,
  canLoadSelectedTabs,
  canUnloadSelectedTabs,
  canCopySelectedTabLinks,
  selectedTabLinks,
  clearSelection,
  selectAllTabs,
  toggleTabSelection,
  selectActionTab,
  relatedTabIds,
  closeRelatedTabs,
  closeSelectedTabs,
  runSelectedTabAction,
  actionTab,
  actionTabShareLink,
  activateTab,
  canToggleActionTabLoaded,
  closeActionTab,
  closeTab,
  closeTabActions,
  createTab,
  createIncognitoTab,
  copyActionTabLink,
  duplicateActionTab,
  handleTabTargetKeydown,
  isTabPlaying,
  openTabActions,
  reloadActionTab,
  tabAriaLabel,
  tabTitle,
  toggleActionTabLoaded,
  toggleActionTabPinned,
} = useCapacitorTabActions({
  tabs,
  presentedTabId,
  afterSelect: tabId => {
    // The tab bar stays inert until its actions menu has closed.
    if (tabActionsLocked) tabToFocus = tabId
    else focusTab(tabId)
  },
  requestExit: () => emit('request-exit'),
  stopContextMenuPropagation: true,
})

const {
  heldTabId, holding, dragging, settling, suppressTransitions, suppressClick,
  start: startDrag, move: moveDrag, finish: finishDrag, cancel: cancelDrag,
  preventHoldScroll, contextMenu: handleContextMenu, style: dragStyle,
} = useTabletTabReorder({
  tabs,
  viewport: tabsViewportRef,
  openActions: openTabActions,
  closeActions: closeTabActions,
  clampScroll: clampTabsScroll,
})

function handleTabListKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  const tabIds = tabs.value.map(tab => tab.id)
  const focusedTabId = event.target.closest('.capacitorTabletTab')
    ?.querySelector('[data-tab-id]')?.dataset.tabId
  const currentIndex = Math.max(0, tabIds.indexOf(selecting.value ? focusedTabId : activeTabId.value))
  let targetIndex
  if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = tabIds.length - 1
  else targetIndex = (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + tabIds.length) % tabIds.length

  const tabId = tabIds[targetIndex]
  if (!tabId) return

  event.preventDefault()
  if (selecting.value) {
    const targets = tabsViewportRef.value?.querySelectorAll('.capacitorTabletTabTarget')
    Array.from(targets ?? []).find(target => target.dataset.tabId === tabId)?.focus()
    return
  }
  activateTab(tabId).then(() => focusActiveTab())
}

async function focusActiveTab() {
  await nextTick()
  const activeTab = tabsViewportRef.value?.querySelector('.capacitorTabletTabTarget[aria-pressed="true"]')
  activeTab?.focus({ preventScroll: true })
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function clampTabsScroll() {
  const viewport = tabsViewportRef.value
  const content = viewport?.querySelector('.capacitorTabletTabs')
  if (viewport && content) clampOverlayScrollLeft(viewport, content)
}

watch(activeTabId, async () => {
  await nextTick()
  tabsViewportRef.value
    ?.querySelector('.capacitorTabletTabTarget[aria-pressed="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})

watch(tabs, () => nextTick(clampTabsScroll), { flush: 'post' })

// A tap reopens the last closed tab; holding it, or its context menu, lists them all.
const reopenHold = useHoldAction(() => {
  closeTabActions()
  closedTabsMenuOpen.value = true
}, () => closedTabsMenuOpen.value)

/**
 * @param {string | null} [closedTabId] the most recently closed tab if omitted
 */
async function restoreClosedTab(closedTabId = null) {
  closedTabsMenuOpen.value = false
  await getCapacitorTabService().restoreClosedTab(closedTabId)
}

async function clearClosedTabs() {
  closedTabsMenuOpen.value = false
  await store.dispatch('clearClosedTabs')
}

let tabActionsLocked = false
let tabToFocus = null
watch(() => actionTab.value !== null || closedTabsMenuOpen.value, (isOpen) => {
  if (isOpen && !tabActionsLocked) {
    lockBodyScroll()
    store.commit('addOpenPrompt', promptId)
    tabActionsLocked = true
  }
})

function releaseTabActions() {
  if (actionTab.value || closedTabsMenuOpen.value || !tabActionsLocked) return
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  tabActionsLocked = false
  const tabId = tabToFocus
  tabToFocus = null
  // Focus once the tab bar renders without inert, before the menu refocuses its opener.
  if (tabId) nextTick(() => focusTab(tabId))
}

function focusTab(tabId) {
  tabsViewportRef.value?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus({ preventScroll: true })
}

let tabsResizeObserver = null

onMounted(() => {
  const content = tabsViewportRef.value?.querySelector('.capacitorTabletTabs')
  if (!content || typeof ResizeObserver !== 'function') return

  tabsResizeObserver = new ResizeObserver(() => {
    cancelDrag()
    clampTabsScroll()
  })
  tabsResizeObserver.observe(content)
  tabsResizeObserver.observe(tabsViewportRef.value)
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  reopenHold.cancel()
  closedTabsMenuOpen.value = false
  closeTabActions()
  releaseTabActions()
})
</script>

<style scoped src="./CapacitorTabletTabBar.css" />

<style scoped src="./TabLoadingDot.css" />
