<template>
  <div
    v-if="isElectron"
    v-bind="$attrs"
    ref="tabBarRef"
    class="tabBar"
    data-tutorial="tabs"
    :class="[`position-${tabBarPosition}`, { vertical }]"
    :style="fixedTabWidthStyle"
  >
    <div class="tabsViewport">
      <div
        ref="dropZoneRef"
        v-overlay-scrollbars
        data-scrollbar-click-scroll
        class="tabsContainer"
        @scroll="handleScroll"
        @wheel="handleWheel"
        @pointerdown="handleTabContainerPointerDown"
        @mousedown.middle="handleTabListMiddleMouseDown"
        @auxclick="handleTabListAuxClick"
      >
        <div
          ref="tabsContentRef"
          class="tabsContent"
        >
          <template
            v-for="(item, index) in stripItems"
            :key="item.id"
          >
            <SortableTab
              v-if="item.type === 'tab'"
              :tab="item.tab"
              :group="tabGroupById.get(item.tab.groupId) ?? null"
              :index="index"
              :vertical="vertical"
              :tab-bar-position="tabBarPosition"
              :offset="tabOffsets[item.id] || 0"
              :is-dragging="draggingTabIds.has(item.id)"
              :is-settling="isSettling && settlingTabIds.has(item.id)"
              :suppress-transition="suppressTransitions"
              :disable-tooltips="draggingTabIds.size > 0"
              :close-tooltips-signal="closeTooltipsSignal"
              :show-icon="showTabIcons"
              :show-preview="showTabPreviews"
              :is-selected="selectedTabIds.has(item.id)"
              :close-label="t('Close Tab')"
              @activate="handleActivate"
              @close="closeTab"
              @middle-click="handleMiddleClick"
            />
            <TabTooltip
              v-else
              :title="item.group.name"
              :tabs="item.tabs"
              :show-icon="showTabIcons"
              is-group
              :tab-bar-position="tabBarPosition"
              :disable-tooltips="draggingTabIds.size > 0"
              :close-tooltips-signal="closeTooltipsSignal"
              :show-preview="showTabPreviews"
            >
              <template #anchor="{ bindings }">
                <button
                  v-bind="bindings"
                  class="tabBarReorderItem collapsedTabGroup"
                  :class="{
                    active: item.isActive,
                    bottom: tabBarPosition === 'bottom',
                    noTransition: suppressTransitions,
                    vertical
                  }"
                  :data-reorder-id="item.id"
                  :data-group-id="item.group.id"
                  :style="collapsedGroupStyle(item)"
                  :aria-label="collapsedGroupLabel(item)"
                  :aria-expanded="false"
                  @click="expandTabGroup(item.group.id)"
                >
                  <FtIcon
                    :icon="['fas', item.group.icon || 'layer-group']"
                    aria-hidden="true"
                  />
                  <span class="collapsedTabGroupName">
                    {{ item.group.name }}
                  </span>
                </button>
              </template>
            </TabTooltip>
          </template>
        </div>
      </div>
    </div>
    <div class="tabBarActions">
      <button
        class="tabOrganizerButton"
        :aria-label="t('Tab Organizer.Title')"
        :title="tabOrganizerTooltip"
        @click="openTabOrganizer"
      >
        <FtIcon
          :icon="['fas', 'layer-group']"
          class="newTabIcon"
          aria-hidden="true"
        />
      </button>
      <button
        class="newTabButton"
        :aria-label="t('New Tab')"
        :title="newTabTooltip"
        @click="createNewTab"
      >
        <FtIcon
          :icon="['fas', 'plus']"
          class="newTabIcon"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
  <TabTooltipOverlay v-if="isElectron" />
  <div
    v-if="isElectron && vertical"
    v-bind="$attrs"
    class="tabBarResizeHandle"
    :class="`position-${tabBarPosition}`"
    role="separator"
    aria-orientation="vertical"
    :aria-label="t('Resize Tab Bar')"
    :title="t('Resize Tab Bar')"
    @pointerdown="handleResizePointerDown"
    @dblclick="resetTabBarWidth"
  />
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { normalizeFixedTabWidth } from '../../constants/tabWidth'
import { isVerticalTabBarPosition, normalizeTabBarPosition } from '../../constants/tabBarPosition'
import { getTabAvatarUrl } from '../../tabs/tabPreview'
import { getTabAccentColor } from '../../constants/tabColors'
import { removeLegacyTabAvatar } from '../../helpers/channelThumbnailStorage'
import { fetchTabAvatarBytes } from '../../helpers/tabAvatar'
import { getMissingTabAvatarTabs, loadMissingTabAvatars } from '../../helpers/loadTabAvatars'
import { clampOverlayScrollLeft, clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useRootClass } from '../../helpers/rootClasses'
import SortableTab from './SortableTab.vue'
import TabTooltip from './TabTooltip.vue'
import TabTooltipOverlay from './TabTooltipOverlay.vue'
import { provideTabTooltip } from './useTabTooltip'
import { useTabDragReorder } from './useTabDragReorder'

defineOptions({ inheritAttrs: false })

provideTabTooltip()

const { t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const isElectron = process.env.IS_ELECTRON
const OPEN_TAB_ORGANIZER_EVENT = 'opentubex:open-tab-organizer'

function openTabOrganizer() {
  window.dispatchEvent(new CustomEvent(OPEN_TAB_ORGANIZER_EVENT))
}

/** @type {import('vue').ComputedRef<Array<{id: string, url: string, title: string, isActive: boolean, isPinned?: boolean, color?: string | null}>>} */
const tabs = computed(() => store.getters.getTabs)
const tabGroupById = computed(() => new Map(
  store.getters.getTabGroups.map(group => [group.id, group])
))
const stripItems = computed(() => buildStripItems(tabs.value))

/**
 * Replace each collapsed group with one compact strip item at the position of
 * its first tab. The item retains all underlying ids so reordering nearby tabs
 * can still produce a complete, valid main-process tab order.
 * @param {Array<object>} currentTabs
 */
function buildStripItems(currentTabs) {
  const collapsedGroupTabs = new Map()
  for (const tab of currentTabs) {
    const group = tabGroupById.value.get(tab.groupId)
    if (!group?.isCollapsed) continue

    const groupTabs = collapsedGroupTabs.get(group.id) ?? []
    groupTabs.push(tab)
    collapsedGroupTabs.set(group.id, groupTabs)
  }

  const addedGroupIds = new Set()
  const items = []
  for (const tab of currentTabs) {
    const group = tabGroupById.value.get(tab.groupId)
    if (!group?.isCollapsed) {
      items.push({ id: tab.id, type: 'tab', tab, tabIds: [tab.id], isPinned: tab.isPinned })
      continue
    }
    if (addedGroupIds.has(group.id)) continue

    addedGroupIds.add(group.id)
    const groupTabs = collapsedGroupTabs.get(group.id) ?? [tab]
    items.push({
      id: `group:${group.id}`,
      type: 'group',
      group,
      tabs: groupTabs,
      tabIds: groupTabs.map(groupTab => groupTab.id),
      isPinned: tab.isPinned,
      isActive: groupTabs.some(groupTab => groupTab.isActive)
    })
  }
  return items
}

function collapsedGroupLabel(item) {
  return t(
    'Tab Organizer.Expand Group Label',
    { name: item.group.name, count: item.tabIds.length },
    item.tabIds.length
  )
}

function collapsedGroupStyle(item) {
  const offset = tabOffsets.value[item.id] || 0
  const translation = vertical.value ? `0, ${offset}px` : `${offset}px, 0`
  return {
    '--tab-group-color': getTabAccentColor(item.group.color) || 'var(--secondary-text-color)',
    transform: offset !== 0 ? `translate3d(${translation}, 0)` : undefined
  }
}

function expandTabGroup(groupId) {
  store.dispatch('updateTabGroup', {
    groupId,
    changes: { isCollapsed: false }
  })
}

const tabBarPosition = computed(() => normalizeTabBarPosition(store.getters.getTabBarPosition))
const vertical = computed(() => isVerticalTabBarPosition(tabBarPosition.value))
const showTabIcons = computed(() => store.getters.getShowTabIcons)
const showTabPreviews = computed(() => store.getters.getShowTabPreviews)
const migratingAvatarTabIds = new Set()
const attemptedAutomaticAvatarRoutes = new Map()

watch(showTabPreviews, enabled => {
  if (isElectron) {
    window.ftElectron.tabs.setPreviewsEnabled(enabled)
  }
}, { immediate: true })

watch([showTabIcons, tabs], ([enabled, currentTabs]) => {
  if (!isElectron) return

  window.ftElectron.tabs.setAvatarsEnabled(enabled)
  if (!enabled) {
    attemptedAutomaticAvatarRoutes.clear()
    return
  }

  const currentTabIds = new Set(currentTabs.map(tab => tab.id))
  for (const tabId of attemptedAutomaticAvatarRoutes.keys()) {
    if (!currentTabIds.has(tabId)) attemptedAutomaticAvatarRoutes.delete(tabId)
  }

  // Try each unloaded tab route once, including tabs opened after startup.
  // Loaded pages fetch and publish their own avatars. Record the
  // attempt before loading so state updates cannot duplicate pending requests
  // or repeatedly retry a failed icon; the settings action can retry it.
  const missingTabs = getMissingTabAvatarTabs(currentTabs).filter(tab => {
    if (!tab.isUnloaded) return false
    const routePath = tab.route.path
    if (attemptedAutomaticAvatarRoutes.get(tab.id) === routePath) return false
    attemptedAutomaticAvatarRoutes.set(tab.id, routePath)
    return true
  })
  if (missingTabs.length > 0) loadMissingTabAvatars(missingTabs)

  for (const tab of currentTabs) {
    const avatarUrl = getTabAvatarUrl(tab)
    if (!avatarUrl?.startsWith('http') || migratingAvatarTabIds.has(tab.id)) continue

    migratingAvatarTabIds.add(tab.id)
    migrateTabAvatar(tab, avatarUrl)
  }
}, { immediate: true })

async function migrateTabAvatar(tab, avatarUrl) {
  try {
    const avatarBytes = await fetchTabAvatarBytes(avatarUrl)
    if (avatarBytes == null) return

    const migrated = await window.ftElectron.tabs.updateAvatar(avatarBytes, tab.id, tab.route.path)
    if (migrated) {
      removeLegacyTabAvatar(tab.route)
    }
  } catch (error) {
    console.error('Failed to migrate tab avatar:', error)
  } finally {
    migratingAvatarTabIds.delete(tab.id)
  }
}

// Only the horizontal bar sizes tabs by their content, so the fixed width is
// applied there; vertical tabs always fill the column.
const fixedTabWidthStyle = computed(() => {
  if (vertical.value || !store.getters.getUseFixedTabWidth) {
    return null
  }

  return { '--fixed-tab-width': `${normalizeFixedTabWidth(store.getters.getFixedTabWidth)}px` }
})

const newTabTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('New Tab'),
    appKeyboardShortcuts.value.NEW_TAB
  )
})

const tabOrganizerTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Tab Organizer.Title'),
    appKeyboardShortcuts.value.OPEN_TAB_ORGANIZER
  )
})

const tabBarRef = useTemplateRef('tabBarRef')
const tabsContentRef = useTemplateRef('tabsContentRef')
const dropZoneRef = useTemplateRef('dropZoneRef')
// The app makes room for a visible horizontal scrollbar, which OverlayScrollbars
// toggles through the class of the scrollbar it adds to the container. Only
// that class and the container's own children are watched, so the tabs' class
// changes, which are frequent while loading, playing and dragging, cost nothing.
const horizontalScrollbarVisible = ref(false)
watch(dropZoneRef, (container, _previous, onCleanup) => {
  /** @type {Element | null} */
  let scrollbar = null
  const update = () => {
    horizontalScrollbarVisible.value = scrollbar?.classList.contains('os-scrollbar-visible') === true
  }
  const scrollbarObserver = new MutationObserver(update)
  const locate = () => {
    const found = container?.querySelector(':scope > .os-scrollbar-horizontal') ?? null
    if (found !== scrollbar) {
      scrollbar = found
      scrollbarObserver.disconnect()
      if (scrollbar) scrollbarObserver.observe(scrollbar, { attributes: true, attributeFilter: ['class'] })
    }
    update()
  }
  locate()
  if (!container) return
  const childrenObserver = new MutationObserver(locate)
  childrenObserver.observe(container, { childList: true })
  onCleanup(() => {
    childrenObserver.disconnect()
    scrollbarObserver.disconnect()
  })
}, { immediate: true, flush: 'sync' })
useRootClass('appTabBarScrollbar', horizontalScrollbarVisible)
const closeTooltipsSignal = ref(0)
const selectedTabIds = computed(() => new Set(store.getters.getSelectedTabIds))
/** @type {string | null} */
let selectionAnchorId = null

// ===== Drag and drop state =====
const {
  draggingTabIds,
  settlingTabIds,
  tabOffsets,
  isSettling,
  suppressTransitions,
  handleTabContainerPointerDown,
  scheduleDragPositionUpdate,
  disposeTabDrag
} = useTabDragReorder({
  vertical,
  tabs,
  stripItems,
  selectedTabIds,
  closeTooltipsSignal,
  dropZoneRef,
  buildStripItems,
  clearTabSelection,
  setTabSelection,
  setSelectionAnchor: (tabId) => { selectionAnchorId = tabId },
  cancelScrollAnimation
})

// ===== Vertical tab bar resizing =====
const MIN_VERTICAL_TAB_BAR_WIDTH = 150
const MAX_VERTICAL_TAB_BAR_WIDTH = 400
const DEFAULT_VERTICAL_TAB_BAR_WIDTH = 220

let isResizingTabBar = false

/**
 * @param {PointerEvent} event
 */
function handleResizePointerDown(event) {
  if (event.button !== 0) return

  event.preventDefault()
  isResizingTabBar = true
  document.body.classList.add('tab-bar-resizing')
  window.addEventListener('pointermove', handleResizePointerMove)
  window.addEventListener('pointerup', handleResizePointerUp)
  window.addEventListener('pointercancel', handleResizePointerUp)
}

/**
 * @param {PointerEvent} event
 */
function handleResizePointerMove(event) {
  const bar = tabBarRef.value
  if (!bar) return

  const rect = bar.getBoundingClientRect()
  const width = tabBarPosition.value === 'right'
    ? rect.right - event.clientX
    : event.clientX - rect.left
  const clampedWidth = Math.round(
    Math.max(MIN_VERTICAL_TAB_BAR_WIDTH, Math.min(MAX_VERTICAL_TAB_BAR_WIDTH, width))
  )

  // Apply live via the mutation; the pointerup handler persists the result.
  store.commit('setVerticalTabBarWidth', clampedWidth)
}

function handleResizePointerUp() {
  stopTabBarResize()
  store.dispatch('updateVerticalTabBarWidth', store.getters.getVerticalTabBarWidth)
}

function stopTabBarResize() {
  if (!isResizingTabBar) return

  isResizingTabBar = false
  document.body.classList.remove('tab-bar-resizing')
  window.removeEventListener('pointermove', handleResizePointerMove)
  window.removeEventListener('pointerup', handleResizePointerUp)
  window.removeEventListener('pointercancel', handleResizePointerUp)
}

function resetTabBarWidth() {
  store.dispatch('updateVerticalTabBarWidth', DEFAULT_VERTICAL_TAB_BAR_WIDTH)
}

// ===== Tab actions =====
/**
 * @param {MouseEvent} event
 * @param {string} tabId
 */
function handleActivate(event, tabId) {
  if (event.shiftKey) {
    const anchorId = selectionAnchorId ?? store.getters.getActiveTabId ?? tabId
    const anchorIndex = tabs.value.findIndex(tab => tab.id === anchorId)
    const targetIndex = tabs.value.findIndex(tab => tab.id === tabId)
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b)
      setTabSelection(tabs.value.slice(start, end + 1).map(tab => tab.id))
      return
    }
  }

  if (event.ctrlKey || event.metaKey) {
    const nextSelection = new Set(selectedTabIds.value)
    if (nextSelection.size === 0) {
      const activeTabId = store.getters.getActiveTabId
      if (activeTabId) nextSelection.add(activeTabId)
    }
    if (nextSelection.has(tabId)) {
      nextSelection.delete(tabId)
    } else {
      nextSelection.add(tabId)
    }
    setTabSelection([...nextSelection])
    selectionAnchorId = nextSelection.size === 1 ? [...nextSelection][0] : tabId
    return
  }

  clearTabSelection()
  selectionAnchorId = tabId
  store.dispatch('activateTab', tabId)
}

function clearTabSelection() {
  setTabSelection([])
}

/**
 * @param {string[]} tabIds
 */
function setTabSelection(tabIds) {
  store.dispatch('setTabSelection', tabIds)
}

/**
 * @param {string} tabId
 */
async function closeTab(tabId) {
  const hasRemainingTabs = await store.dispatch('closeTab', tabId)
  if (!hasRemainingTabs) {
    window.close()
  }
}

/**
 * @param {MouseEvent} event
 * @param {string} tabId
 */
function handleMiddleClick(event, tabId) {
  if (event.button === 1) {
    if (event.ctrlKey) {
      window.ftElectron.tabs.runOrganizerAction('unload', [tabId])
    } else {
      closeTab(tabId)
    }
  }
}

/**
 * @param {EventTarget | null} target
 */
function isEmptyTabListArea(target) {
  return target != null && (target === dropZoneRef.value || target === tabsContentRef.value)
}

/**
 * Prevent the browser's middle-click scrolling mode in the empty tab-list area.
 * @param {MouseEvent} event
 */
function handleTabListMiddleMouseDown(event) {
  if (isEmptyTabListArea(event.target)) {
    event.preventDefault()
  }
}

/**
 * Create a tab when the empty tab-list area is middle-clicked.
 * @param {MouseEvent} event
 */
function handleTabListAuxClick(event) {
  if (event.button === 1 && isEmptyTabListArea(event.target)) {
    event.preventDefault()
    createNewTab()
  }
}

/**
 * The custom title bar makes the empty tab-list area a drag region, whose
 * clicks reach the window instead of the page.
 * @param {{ x: number, y: number }} point
 */
function handleTitleBarMiddleClick({ x, y }) {
  if (isEmptyTabListArea(document.elementFromPoint(x, y))) {
    createNewTab()
  }
}

function createNewTab() {
  store.dispatch('createTab', { makeActive: true })
}

// ===== Context menu =====
/**
 * @param {{ tabId: string | null, selectedTabIds?: string[], surface: 'tab' | 'tabBar' | 'content' | 'subscriptionFeedTab', feedTab?: 'videos' | 'shorts' | 'live' | 'posts' | 'all' | null, isNewFeedTab?: boolean, hasNewContent?: boolean }} payload
 */
function updateContextMenuTab(payload) {
  window.ftElectron.tabs.setContextMenuTab({ ...payload, verticalLayout: vertical.value })
}

/**
 * @param {Element} target
 */
function updateContextMenuTarget(target) {
  const tabId = target.closest('.tab[data-tab-id]')?.dataset.tabId ?? null
  const contextMenuSelectedTabIds = getContextMenuSelectedTabIds(tabId)
  const newFeedTab = target.closest('[data-new-feed-tab]')
  const feedTab = target.closest('[data-subscription-feed-tab]')?.dataset.subscriptionFeedTab ??
    newFeedTab?.dataset.newFeedTab ?? null
  const isTabBar = target.closest('.tabBar') != null
  updateContextMenuTab({
    tabId,
    selectedTabIds: contextMenuSelectedTabIds,
    surface: tabId ? 'tab' : isTabBar ? 'tabBar' : feedTab ? 'subscriptionFeedTab' : 'content',
    feedTab,
    isNewFeedTab: newFeedTab != null,
    hasNewContent: newFeedTab?.dataset.hasNewContent === 'true'
  })
}

/**
 * @param {PointerEvent} event
 */
function handleContextMenuPointerDown(event) {
  if (!isElectron || event.button !== 2 || !(event.target instanceof Element)) {
    return
  }

  updateContextMenuTarget(event.target)
}

/**
 * @param {MouseEvent} event
 */
function handleContextMenuEvent(event) {
  if (!isElectron || !(event.target instanceof Element)) {
    return
  }

  updateContextMenuTarget(event.target)
}

/**
 * Preserve a multi-selection only when its context menu is opened from one of
 * the selected tabs. Right-clicking elsewhere starts a new single-tab target.
 * @param {string | null} tabId
 * @returns {string[]}
 */
function getContextMenuSelectedTabIds(tabId) {
  if (!tabId) return []
  if (selectedTabIds.value.size > 1 && selectedTabIds.value.has(tabId)) {
    return tabs.value.filter(tab => selectedTabIds.value.has(tab.id)).map(tab => tab.id)
  }
  clearTabSelection()
  selectionAnchorId = tabId
  return [tabId]
}

// ===== Lifecycle =====
onMounted(() => {
  if (isElectron) {
    document.addEventListener('pointerdown', handleContextMenuPointerDown, true)
    document.addEventListener('contextmenu', handleContextMenuEvent, true)
    removeActiveChangedListener = window.ftElectron.tabs.onActiveChanged(() => {
      closeTooltipsSignal.value++
      clearTabSelection()
    })
    removeTitleBarMiddleClickListener = window.ftElectron.onTitleBarMiddleClick(handleTitleBarMiddleClick)
  }

  nextTick(() => {
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        clampTabsScroll()
      })

      if (tabsContentRef.value) {
        resizeObserver.observe(tabsContentRef.value)
      }

      if (dropZoneRef.value) {
        resizeObserver.observe(dropZoneRef.value)
      }
    }

    clampTabsScroll()
  })
})

onUnmounted(() => {
  if (isElectron) {
    document.removeEventListener('pointerdown', handleContextMenuPointerDown, true)
    document.removeEventListener('contextmenu', handleContextMenuEvent, true)
    updateContextMenuTab({ tabId: null, surface: 'content' })
    removeActiveChangedListener?.()
    removeActiveChangedListener = null
    removeTitleBarMiddleClickListener?.()
    removeTitleBarMiddleClickListener = null
  }

  disposeTabDrag()

  stopTabBarResize()
  cancelScrollAnimation()
  resizeObserver?.disconnect()
  document.body.classList.remove('tab-bar-grabbing')
})

// ===== Scrollbar =====
const tabBarScrollPosition = computed(() => store.getters.getTabBarScrollPosition)

let scrollTarget = null
let scrollAnimationId = null
let resizeObserver = null
let removeActiveChangedListener = null
let removeTitleBarMiddleClickListener = null

function animateScroll() {
  const container = dropZoneRef.value
  if (!container || scrollTarget == null) {
    scrollAnimationId = null
    return
  }

  const diff = scrollTarget - container.scrollLeft
  if (Math.abs(diff) < 0.5) {
    container.scrollLeft = scrollTarget
    scrollTarget = null
    scrollAnimationId = null
    return
  }

  const previousScrollLeft = container.scrollLeft
  container.scrollLeft += diff * 0.25
  // Fractional UI scales can round an animation step to the current offset.
  if (container.scrollLeft === previousScrollLeft) {
    container.scrollLeft = scrollTarget
    scrollTarget = null
    scrollAnimationId = null
    return
  }
  scrollAnimationId = requestAnimationFrame(animateScroll)
}

function cancelScrollAnimation() {
  if (scrollAnimationId != null) {
    cancelAnimationFrame(scrollAnimationId)
    scrollAnimationId = null
  }

  if (dropZoneRef.value) {
    scrollTarget = dropZoneRef.value.scrollLeft
  }
}

/** @param {HTMLElement} container */
function getHorizontalScrollRange(container) {
  const maximumScroll = Math.max(0, tabsContentRef.value.scrollWidth - container.clientWidth)
  const direction = getComputedStyle(container).direction === 'rtl' ? -1 : 1
  return {
    min: Math.min(0, direction * maximumScroll),
    max: Math.max(0, direction * maximumScroll),
    direction
  }
}

/**
 * @param {WheelEvent} event
 */
function handleWheel(event) {
  // The vertical layout relies on the container's native vertical scrolling.
  if (vertical.value) return

  const container = dropZoneRef.value
  if (!container) return

  event.preventDefault()

  const { min, max, direction } = getHorizontalScrollRange(container)
  const delta = event.deltaY ? event.deltaY * direction : event.deltaX

  if (scrollTarget == null) {
    scrollTarget = container.scrollLeft
  }
  scrollTarget = Math.max(min, Math.min(max, scrollTarget + delta))

  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(scrollTarget)
  }

  if (!scrollAnimationId) {
    scrollAnimationId = requestAnimationFrame(animateScroll)
  }
}

function handleScroll() {
  if (isElectron && !vertical.value && !scrollAnimationId) {
    scrollTarget = dropZoneRef.value.scrollLeft
    window.ftElectron.tabs.setTabBarScroll(scrollTarget)
  }
  scheduleDragPositionUpdate()
}

// Apply scroll position received from main process state broadcasts.
// This keeps all tab renderers' tab bars at the same scroll offset.
watch(tabBarScrollPosition, (newPosition) => {
  if (newPosition == null || vertical.value) return

  nextTick(() => {
    const container = dropZoneRef.value
    if (!container) return

    if (scrollAnimationId) {
      scrollTarget = newPosition
    } else {
      container.scrollLeft = newPosition
      scrollTarget = newPosition
    }
  })
})

function clampTabsScroll() {
  const container = dropZoneRef.value
  const content = tabsContentRef.value
  if (!container || !content) return

  if (vertical.value) {
    clampOverlayScrollTop(container, content.lastElementChild)
  } else {
    clampOverlayScrollLeft(container, content)
    if (scrollTarget != null) {
      const { min, max } = getHorizontalScrollRange(container)
      const clampedTarget = Math.max(min, Math.min(max, scrollTarget))
      if (scrollTarget !== clampedTarget) {
        scrollTarget = clampedTarget
        if (isElectron) window.ftElectron.tabs.setTabBarScroll(scrollTarget)
      }
    }
  }
}

watch(stripItems, clampTabsScroll, { flush: 'post' })

watch(vertical, () => {
  cancelScrollAnimation()
  scrollTarget = null
  nextTick(clampTabsScroll)
})

watch(tabs, (nextTabs) => {
  const currentIds = new Set(nextTabs.map(tab => tab.id))
  const nextSelection = new Set([...selectedTabIds.value].filter(tabId => currentIds.has(tabId)))
  if (nextSelection.size !== selectedTabIds.value.size) {
    setTabSelection([...nextSelection])
  }
  if (selectionAnchorId && !currentIds.has(selectionAnchorId)) {
    selectionAnchorId = null
  }
})
</script>

<style scoped src="./TabBar.css" />

<style>
body.tab-bar-grabbing,
body.tab-bar-grabbing * {
  cursor: grabbing !important;
  user-select: none !important;
}

body.tab-bar-resizing,
body.tab-bar-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
