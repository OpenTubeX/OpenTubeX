<template>
  <div
    v-bind="$attrs"
    class="capacitorTabletTabBar"
    data-tutorial="tabs"
    :style="fixedTabWidthStyle"
    :inert="$attrs.inert && !holding"
  >
    <div
      ref="tabsViewportRef"
      v-overlay-scrollbars
      class="capacitorTabletTabsViewport"
    >
      <div
        class="capacitorTabletTabs"
        role="tablist"
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
            role="tab"
            :data-tab-id="tab.id"
            :aria-selected="tab.id === activeTabId"
            :aria-label="tabAriaLabel(tab)"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :title="tabTitle(tab)"
            @click="!suppressClick && activateTab(tab.id)"
            @keydown="handleTabTargetKeydown($event, tab.id)"
          >
            <span
              v-if="showTabIcons"
              class="capacitorTabletTabIcon"
            >
              <FtRetryImage
                v-if="getTabAvatarUrl(tab)"
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
              :icon="['fas', 'times']"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
    <CapacitorTabSelectionControls
      v-if="selecting"
      :count="selectedTabIds.size"
      :busy="closingTabs"
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
    <Teleport to="body">
      <CapacitorTabActionsMenu
        :related-tab-ids="relatedTabIds"
        :tab="actionTab"
        :title="actionTab ? tabTitle(actionTab) : ''"
        :youtube-url="actionTabYoutubeUrl"
        :can-toggle-loaded="canToggleActionTabLoaded"
        mode="tablet"
        @select="selectActionTab"
        @close-related="closeRelatedTabs"
        @close="closeActionTab"
        @copy-youtube-link="copyActionTabYoutubeLink"
        @dismiss="closeTabActions"
        @duplicate="duplicateActionTab"
        @reload="reloadActionTab"
        @toggle-loaded="toggleActionTabLoaded"
        @toggle-pinned="toggleActionTabPinned"
      />
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { normalizeFixedTabWidth } from '../../constants/tabWidth'
import { clampOverlayScrollLeft } from '../../helpers/overlayScrollbars'
import store from '../../store/index'
import { getTabAvatarUrl, getTabPageIcon } from '../../tabs/tabPreview'
import FtRetryImage from '../FtRetryImage.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'
import CapacitorTabSelectionControls from './CapacitorTabSelectionControls.vue'
import CapacitorTabActionsMenu from './CapacitorTabActionsMenu.vue'
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
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const fixedTabWidthStyle = computed(() => store.getters.getUseFixedTabWidth
  ? { '--fixed-tab-width': `${normalizeFixedTabWidth(store.getters.getFixedTabWidth)}px` }
  : undefined)
const {
  selecting,
  selectedTabIds,
  closingTabs,
  clearSelection,
  toggleTabSelection,
  selectActionTab,
  relatedTabIds,
  closeRelatedTabs,
  closeSelectedTabs,
  actionTab,
  actionTabYoutubeUrl,
  activateTab,
  canToggleActionTabLoaded,
  closeActionTab,
  closeTab,
  closeTabActions,
  createTab,
  copyActionTabYoutubeLink,
  duplicateActionTab,
  handleTabTargetKeydown,
  openTabActions,
  reloadActionTab,
  tabAriaLabel,
  tabTitle,
  toggleActionTabLoaded,
  toggleActionTabPinned,
} = useCapacitorTabActions({
  tabs,
  afterSelect: tabId => {
    tabsViewportRef.value?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`)?.focus({ preventScroll: true })
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
  const activeTab = tabsViewportRef.value?.querySelector('[role="tab"][aria-selected="true"]')
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
    ?.querySelector('[role="tab"][aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})

watch(tabs, () => nextTick(clampTabsScroll), { flush: 'post' })

watch(() => actionTab.value !== null, (isOpen) => {
  if (isOpen) {
    lockBodyScroll()
    store.commit('addOpenPrompt', promptId)
  } else {
    store.commit('removeOpenPrompt', promptId)
    unlockBodyScroll()
  }
})

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
  if (!actionTab.value) return

  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
})
</script>

<style scoped src="./CapacitorTabletTabBar.css" />
