<template>
  <div
    class="capacitorTabletTabBar"
    data-tutorial="tabs"
    :style="fixedTabWidthStyle"
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
          :class="{ active: tab.id === activeTabId }"
          @contextmenu.prevent.stop="openTabActions(tab.id)"
        >
          <button
            type="button"
            class="capacitorTabletTabTarget"
            role="tab"
            :data-tab-id="tab.id"
            :aria-selected="tab.id === activeTabId"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :title="tabTitle(tab)"
            @click="activateTab(tab.id)"
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
          <button
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
    <button
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
        :tab="actionTab"
        :title="actionTab ? tabTitle(actionTab) : ''"
        mode="tablet"
        @close="closeActionTab"
        @dismiss="closeTabActions"
        @duplicate="duplicateActionTab"
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
import CapacitorTabActionsMenu from './CapacitorTabActionsMenu.vue'
import { useCapacitorTabActions } from './useCapacitorTabActions'

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
  actionTab,
  activateTab,
  closeActionTab,
  closeTab,
  closeTabActions,
  createTab,
  duplicateActionTab,
  handleTabTargetKeydown,
  openTabActions,
  tabTitle,
  toggleActionTabPinned,
} = useCapacitorTabActions({
  tabs,
  requestExit: () => emit('request-exit'),
  stopContextMenuPropagation: true,
})

function handleTabListKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return

  const tabIds = tabs.value.map(tab => tab.id)
  const currentIndex = Math.max(0, tabIds.indexOf(activeTabId.value))
  let targetIndex
  if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = tabIds.length - 1
  else targetIndex = (currentIndex + (event.key === 'ArrowLeft' ? -1 : 1) + tabIds.length) % tabIds.length

  const tabId = tabIds[targetIndex]
  if (!tabId) return

  event.preventDefault()
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

  tabsResizeObserver = new ResizeObserver(clampTabsScroll)
  tabsResizeObserver.observe(content)
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  if (!actionTab.value) return

  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
})
</script>

<style scoped src="./CapacitorTabletTabBar.css" />
