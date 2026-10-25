import { computed, nextTick, ref, useTemplateRef } from 'vue'

import store from '../store/index'
import { getTabAccentColor } from '../constants/tabColors'
import { getTabAvatarUrl, getTabPreviewFallbackUrl } from '../tabs/tabPreview'

/**
 * The Ctrl+Tab switcher for Electron tabs. A quick press switches tabs without
 * rendering the menu; holding Control opens it with cached tab previews and
 * releasing Control activates the selected tab.
 */
export function useTabSwitcher() {
  const tabSwitcherVisible = ref(false)
  const tabSwitcherSelectedIndex = ref(-1)
  const tabSwitcherPreviewUrls = ref({})
  const tabSwitcherPreviewPending = ref({})
  const tabSwitcherFailedAvatarUrls = ref({})
  const tabSwitcherFailedPreviewUrls = ref({})
  const tabSwitcherPointerActive = ref(false)
  const tabSwitcherRef = useTemplateRef('tabSwitcherRef')
  let tabSwitcherPreviewRequestId = 0
  let tabSwitcherOpenTimer = null
  let tabSwitcherScrollPending = false
  const TAB_SWITCHER_HOLD_DELAY_MS = 150

  const tabSwitcherTabs = computed(() => store.getters.getTabs)
  const showTabIcons = computed(() => store.getters.getShowTabIcons)
  const showTabPreviews = computed(() => store.getters.getShowTabPreviews)
  const tabSwitcherSelectedTabId = computed(() => {
    const tab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
    return tab ? `tab-switcher-option-${tab.id}` : undefined
  })

  /**
   * @param {KeyboardEvent} event
   */
  function handleKeyboardShortcutKeyup(event) {
    if (!isTabSwitcherActive()) {
      return
    }

    if (event.key === 'Control' || !event.ctrlKey) {
      event.preventDefault()
      commitTabSwitcherSelection()
    }
  }

  /**
   * @param {number} direction
   */
  function cycleTabSwitcher(direction) {
    const tabs = tabSwitcherTabs.value
    if (tabs.length <= 1) {
      return
    }

    if (!isTabSwitcherActive()) {
      const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === store.getters.getActiveTabId))
      tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(activeIndex + direction, tabs.length)
      // A quick release commits the selection without mounting the menu,
      // measuring its scrollbar, or requesting/decoding previews.
      tabSwitcherOpenTimer = setTimeout(() => {
        tabSwitcherOpenTimer = null
        if (showTabPreviews.value) {
          window.ftElectron.tabs.setPreviewCapturePaused(true)
        }
        tabSwitcherVisible.value = true
        scrollTabSwitcherSelectionIntoView()
        loadTabSwitcherPreviews()
      }, TAB_SWITCHER_HOLD_DELAY_MS)
      return
    }

    tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(
      tabSwitcherSelectedIndex.value + direction,
      tabs.length
    )
    scrollTabSwitcherSelectionIntoView()
  }

  /**
   * @param {number} index
   * @param {number} length
   * @returns {number}
   */
  function wrapTabSwitcherIndex(index, length) {
    return (index + length) % length
  }

  function isTabSwitcherActive() {
    return tabSwitcherOpenTimer != null || tabSwitcherVisible.value
  }

  function loadTabSwitcherPreviews() {
    if (
      !showTabPreviews.value ||
      !process.env.IS_ELECTRON ||
      typeof window.ftElectron?.tabs?.getCachedPreviews !== 'function'
    ) {
      return
    }

    const requestId = ++tabSwitcherPreviewRequestId
    const tabIds = tabSwitcherTabs.value.map(tab => tab.id)
    tabSwitcherPreviewPending.value = Object.fromEntries(tabIds.map(tabId => [tabId, true]))

    window.ftElectron.tabs.getCachedPreviews(tabIds).then((previews) => {
      if (requestId !== tabSwitcherPreviewRequestId || !tabSwitcherVisible.value) {
        return
      }

      tabSwitcherPreviewUrls.value = Object.fromEntries(
        Object.entries(previews).filter(([, dataUrl]) => typeof dataUrl === 'string' && dataUrl.length > 0)
      )
    }).catch(() => {}).finally(() => {
      if (requestId === tabSwitcherPreviewRequestId && tabSwitcherVisible.value) {
        tabSwitcherPreviewPending.value = {}
      }
    })
  }

  function getUsableTabSwitcherAvatarUrl(tab) {
    const avatarUrl = getTabAvatarUrl(tab) || getTabPreviewFallbackUrl(tab)
    return avatarUrl !== tabSwitcherFailedAvatarUrls.value[tab.id] ? avatarUrl : null
  }

  function getUsableTabSwitcherPreviewUrl(tab) {
    const previewUrl = tabSwitcherPreviewUrls.value[tab.id]
    return previewUrl !== tabSwitcherFailedPreviewUrls.value[tab.id] ? previewUrl : null
  }

  function handleTabSwitcherAvatarError(tab) {
    tabSwitcherFailedAvatarUrls.value = {
      ...tabSwitcherFailedAvatarUrls.value,
      [tab.id]: getUsableTabSwitcherAvatarUrl(tab)
    }
  }

  function handleTabSwitcherPreviewError(tab) {
    tabSwitcherFailedPreviewUrls.value = {
      ...tabSwitcherFailedPreviewUrls.value,
      [tab.id]: getUsableTabSwitcherPreviewUrl(tab)
    }
  }

  /**
   * @param {number} index
   */
  function setTabSwitcherSelectedIndex(index) {
    tabSwitcherSelectedIndex.value = index
  }

  function activateTabSwitcherPointer() {
    tabSwitcherPointerActive.value = true
  }

  function clearTabSwitcherSelection() {
    tabSwitcherSelectedIndex.value = -1
    tabSwitcherPointerActive.value = false
  }

  /**
   * @param {WheelEvent} event
   */
  function handleTabSwitcherWheel(event) {
    const switcher = tabSwitcherRef.value
    if (!(switcher instanceof HTMLElement)) {
      return
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY

    if (delta === 0) {
      return
    }

    // Prefer vertical scrolling when the switcher wraps into multiple rows;
    // fall back to horizontal when that is the only overflow axis.
    if (switcher.scrollHeight > switcher.clientHeight) {
      switcher.scrollTop += delta
    } else {
      switcher.scrollLeft += delta
    }
  }

  function scrollTabSwitcherSelectionIntoView() {
    if (!tabSwitcherVisible.value || tabSwitcherScrollPending) return
    tabSwitcherScrollPending = true
    nextTick(() => {
      tabSwitcherScrollPending = false
      if (!tabSwitcherVisible.value) return
      const selectedTabId = tabSwitcherSelectedTabId.value
      if (selectedTabId == null) {
        return
      }

      document.getElementById(selectedTabId)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
      })
    })
  }

  /**
   * @param {number} [index]
   */
  function commitTabSwitcherSelection(index) {
    if (typeof index === 'number') {
      tabSwitcherSelectedIndex.value = index
    }

    const selectedTab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
    cancelTabSwitcher()

    if (selectedTab && selectedTab.id !== store.getters.getActiveTabId) {
      store.dispatch('activateTab', selectedTab.id)
    }
  }

  function cancelTabSwitcher() {
    clearTimeout(tabSwitcherOpenTimer)
    tabSwitcherOpenTimer = null
    tabSwitcherSelectedIndex.value = -1
    if (!tabSwitcherVisible.value) {
      return
    }

    tabSwitcherVisible.value = false
    tabSwitcherPreviewUrls.value = {}
    tabSwitcherPreviewPending.value = {}
    tabSwitcherFailedAvatarUrls.value = {}
    tabSwitcherFailedPreviewUrls.value = {}
    tabSwitcherPointerActive.value = false
    tabSwitcherPreviewRequestId++
    window.ftElectron.tabs.setPreviewCapturePaused(false)
  }

  /**
   * @param {{color?: string | null}} tab
   * @returns {Record<string, string | undefined>}
   */
  function getTabSwitcherItemStyle(tab) {
    return {
      '--tab-switcher-accent-color': getTabAccentColor(tab.color) || undefined
    }
  }

  return {
    tabSwitcherVisible,
    tabSwitcherTabs,
    tabSwitcherSelectedIndex,
    tabSwitcherSelectedTabId,
    tabSwitcherPreviewUrls,
    tabSwitcherPreviewPending,
    tabSwitcherPointerActive,
    showTabIcons,
    showTabPreviews,
    handleKeyboardShortcutKeyup,
    cycleTabSwitcher,
    isTabSwitcherActive,
    getUsableTabSwitcherAvatarUrl,
    getUsableTabSwitcherPreviewUrl,
    handleTabSwitcherAvatarError,
    handleTabSwitcherPreviewError,
    setTabSwitcherSelectedIndex,
    activateTabSwitcherPointer,
    clearTabSwitcherSelection,
    handleTabSwitcherWheel,
    commitTabSwitcherSelection,
    cancelTabSwitcher,
    getTabSwitcherItemStyle
  }
}
