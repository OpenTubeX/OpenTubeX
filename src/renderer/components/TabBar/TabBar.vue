<template>
  <div
    v-if="isElectron"
    class="tabBar"
  >
    <div
      ref="dropZoneRef"
      class="tabsContainer"
      @wheel.prevent="handleWheel"
    >
      <SortableTab
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :tab="tab"
        :index="index"
        :close-label="t('Close Tab')"
        @activate="activateTab"
        @close="closeTab"
        @middle-click="handleMiddleClick"
      />
    </div>
    <button
      class="newTabButton"
      :aria-label="t('New Tab')"
      :title="newTabTooltip"
      @click="createNewTab"
    >
      <FontAwesomeIcon
        :icon="['fas', 'plus']"
        class="newTabIcon"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onMounted, watch, onUnmounted, nextTick } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'
import { useDroppable, useDnDStore } from '@vue-dnd-kit/core'

import store from '../../store/index'
import { KeyboardShortcuts } from '../../../constants'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import SortableTab from './SortableTab.vue'

const { t } = useI18n()

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<Array<{id: string, url: string, title: string, isActive: boolean}>>} */
const tabs = computed(() => store.getters.getTabs)

const newTabTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('New Tab'),
    KeyboardShortcuts.APP.GENERAL.NEW_TAB
  )
})

// Set up droppable zone for tab reordering - bind elementRef directly to template
const {
  elementRef: dropZoneRef
} = useDroppable({
  events: {
    onDrop: handleDrop
  }
})

// Watch global drag state to add body class for global cursor styling
const dndStore = useDnDStore()
watch(
  () => dndStore.isDragging.value,
  (dragging) => {
    if (dragging) {
      document.body.classList.add('vue-dnd-dragging')
    } else {
      document.body.classList.remove('vue-dnd-dragging')
    }
  }
)

onMounted(() => {
  if (isElectron) {
    store.dispatch('initializeTabs')
  }
})

onUnmounted(() => {
  document.body.classList.remove('vue-dnd-dragging')
})

/**
 * Handle drop event for tab reordering
 * @param {import('@vue-dnd-kit/core').IDnDStore} dndStoreInstance
 * @param {import('@vue-dnd-kit/core').IDnDPayload} payload
 */
function handleDrop(dndStoreInstance, payload) {
  if (!payload.items || payload.items.length === 0) return

  const draggedItem = payload.items[0]
  if (!draggedItem.data) return

  const draggedTabId = draggedItem.data.tabId
  if (!draggedTabId) return

  // Get the current pointer position to determine drop target
  const pointerPos = dndStoreInstance.pointerPosition.current.value
  if (!pointerPos) return

  // Find the drop target index by checking which tab the pointer is over
  const tabElements = dropZoneRef.value?.querySelectorAll('.tab')
  if (!tabElements) return

  let targetIndex = -1
  const tabsArray = tabs.value

  for (let i = 0; i < tabElements.length; i++) {
    const tabEl = tabElements[i]
    const rect = tabEl.getBoundingClientRect()

    // Check if pointer is within this tab's horizontal bounds
    if (pointerPos.x >= rect.left && pointerPos.x <= rect.right) {
      // Determine if we should insert before or after based on which half the pointer is in
      const midPoint = rect.left + rect.width / 2
      if (pointerPos.x < midPoint) {
        targetIndex = i
      } else {
        targetIndex = i + 1
      }
      break
    }
  }

  // If pointer is to the right of all tabs, append at end
  if (targetIndex === -1 && tabElements.length > 0) {
    const lastRect = tabElements[tabElements.length - 1].getBoundingClientRect()
    if (pointerPos.x > lastRect.right) {
      targetIndex = tabsArray.length
    }
  }

  // If we still don't have a target, bail
  if (targetIndex === -1) return

  // Find source index
  const sourceIndex = tabsArray.findIndex(tab => tab.id === draggedTabId)
  if (sourceIndex === -1) return

  // Adjust target index if moving to a later position
  if (sourceIndex < targetIndex) {
    targetIndex--
  }

  // Only dispatch if position actually changed
  if (sourceIndex !== targetIndex) {
    store.dispatch('moveTab', { tabId: draggedTabId, toIndex: targetIndex })
  }
}

/**
 * @param {string} tabId
 */
function activateTab(tabId) {
  store.dispatch('activateTab', tabId)
}

/**
 * @param {string} tabId
 */
async function closeTab(tabId) {
  const hasRemainingTabs = await store.dispatch('closeTab', tabId)
  if (!hasRemainingTabs) {
    // Close window if no tabs left
    window.close()
  }
}

/**
 * @param {MouseEvent} event
 * @param {string} tabId
 */
function handleMiddleClick(event, tabId) {
  // Middle click to close tab
  if (event.button === 1) {
    closeTab(tabId)
  }
}

function createNewTab() {
  store.dispatch('createTab', { makeActive: true })
}

const tabBarScrollPosition = computed(() => store.getters.getTabBarScrollPosition)

let scrollTarget = null
let scrollAnimationId = null

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

  container.scrollLeft += diff * 0.25
  scrollAnimationId = requestAnimationFrame(animateScroll)
}

/**
 * @param {WheelEvent} event
 */
function handleWheel(event) {
  const container = dropZoneRef.value
  if (!container) return

  const delta = event.deltaY || event.deltaX
  const maxScroll = container.scrollWidth - container.clientWidth

  if (scrollTarget == null) {
    scrollTarget = container.scrollLeft
  }
  scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget + delta))

  if (isElectron) {
    window.ftElectron.tabs.setTabBarScroll(scrollTarget)
  }

  if (!scrollAnimationId) {
    scrollAnimationId = requestAnimationFrame(animateScroll)
  }
}

// Apply scroll position received from main process state broadcasts.
// This keeps all tab renderers' tab bars at the same scroll offset.
watch(tabBarScrollPosition, (newPosition) => {
  if (newPosition == null) return

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
</script>

<style scoped src="./TabBar.css" />
