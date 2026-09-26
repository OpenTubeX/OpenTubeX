import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from '../../helpers/share'
import { copyToClipboard } from '../../helpers/utils'
import { getCapacitorTabService } from '../../tabs/CapacitorTabService'
import { formatTabTitle } from '../../tabs/tabTitle'

const noop = () => {}

/**
 * Shared phone and tablet tab actions.
 *
 * @param {object} options
 * @param {import('vue').ComputedRef<Array<object>>} options.tabs
 * @param {() => void} options.requestExit
 * @param {() => void | Promise<void>} [options.afterCreate]
 * @param {() => void | Promise<void>} [options.afterActivate]
 * @param {(tabId: string) => void | Promise<void>} [options.afterSelect]
 * @param {() => void | Promise<void>} [options.afterClose]
 * @param {() => void | Promise<void>} [options.afterDuplicate]
 * @param {() => void} [options.beforeOpenActions]
 * @param {() => void} [options.afterCloseActions]
 * @param {boolean} [options.stopContextMenuPropagation]
 */
export function useCapacitorTabActions({
  tabs,
  requestExit,
  afterCreate = noop,
  afterActivate = noop,
  afterSelect = noop,
  afterClose = noop,
  afterDuplicate = noop,
  beforeOpenActions = noop,
  afterCloseActions = noop,
  stopContextMenuPropagation = false,
}) {
  const { t } = useI18n()
  const selecting = ref(false)
  const selectedTabIds = ref(new Set())
  const closingTabs = ref(false)
  const runningSelectionAction = ref(false)
  watch(tabs, () => {
    selectedTabIds.value = new Set([...selectedTabIds.value].filter(id => tabs.value.some(tab => tab.id === id)))
  })
  const actionTabId = ref(null)
  const actionTab = computed(() => (
    tabs.value.find(tab => tab.id === actionTabId.value) ?? null
  ))
  const actionTabYoutubeUrl = computed(() => {
    const route = actionTab.value?.route?.fullPath
    return isShareableOpenTubeXRoute(route)
      ? transformOpenTubeXRouteUrl(route, true)
      : null
  })
  const canToggleActionTabLoaded = computed(() => {
    const tab = actionTab.value
    if (!tab || tab.loadState === 'mounting' || tab.loadState === 'unloading') return false
    return tab.loadState === 'unloaded' || tabs.value.length > 1
  })

  function tabTitle(tab) {
    return formatTabTitle(tab.contentTitle || tab.title || tab.route.fullPath)
  }

  function tabAriaLabel(tab) {
    const title = tabTitle(tab)
    return tab.isUnloaded ? `${title}, ${t('Tab Organizer.Unloaded')}` : title
  }

  async function createTab() {
    await getCapacitorTabService().createTab()
    await afterCreate()
  }

  function clearSelection() {
    selecting.value = false
    selectedTabIds.value = new Set()
  }

  function toggleTabSelection(tabId) {
    const ids = new Set(selectedTabIds.value)
    if (ids.has(tabId)) ids.delete(tabId)
    else ids.add(tabId)
    selectedTabIds.value = ids
  }

  async function selectActionTab() {
    if (!actionTab.value) return
    const tabId = actionTab.value.id
    selecting.value = true
    selectedTabIds.value = new Set([...selectedTabIds.value, tabId])
    closeTabActions()
    await nextTick()
    await afterSelect(tabId)
  }

  const relatedTabIds = computed(() => {
    const index = tabs.value.findIndex(tab => tab.id === actionTab.value?.id)
    const ids = list => list.filter(tab => !tab.isPinned).map(tab => tab.id)
    return index < 0
      ? { before: [], after: [], other: [] }
      : {
          before: ids(tabs.value.slice(0, index)),
          after: ids(tabs.value.slice(index + 1)),
          other: ids(tabs.value.filter(tab => tab.id !== actionTab.value.id)),
        }
  })

  async function closeTabIds(ids) {
    if (closingTabs.value || ids.length === 0) return
    closingTabs.value = true
    closeTabActions()
    try {
      // Keep a landing tab so every selected tab enters the closed-tab history.
      if (tabs.value.every(tab => ids.includes(tab.id))) {
        if (!await getCapacitorTabService().createTab()) return
      }
      for (const id of ids) {
        if (tabs.value.some(tab => tab.id === id)) {
          if (!await getCapacitorTabService().closeTab(id)) return
        }
      }
      clearSelection()
      await afterClose()
    } finally {
      closingTabs.value = false
    }
  }

  async function closeRelatedTabs(position) {
    await closeTabIds(relatedTabIds.value[position])
  }

  async function closeSelectedTabs() {
    await closeTabIds([...selectedTabIds.value])
  }

  const selectedTabs = computed(() => tabs.value.filter(tab => selectedTabIds.value.has(tab.id)))
  const canPinSelectedTabs = computed(() => selectedTabs.value.some(tab => !tab.isPinned))
  const canUnpinSelectedTabs = computed(() => selectedTabs.value.some(tab => tab.isPinned))
  const canLoadSelectedTabs = computed(() => selectedTabs.value.some(tab => tab.loadState === 'unloaded'))
  const canUnloadSelectedTabs = computed(() => selectedTabs.value.some(tab =>
    !['unloaded', 'unloading', 'mounting'].includes(tab.loadState) && tabs.value.length > 1
  ))

  async function runSelectedTabAction(action) {
    if (runningSelectionAction.value || closingTabs.value) return
    runningSelectionAction.value = true
    try {
      const service = getCapacitorTabService()
      const ids = selectedTabs.value.map(tab => tab.id)
      for (const id of ids) {
        const tab = tabs.value.find(candidate => candidate.id === id)
        if (!tab) continue
        if (action === 'pin' && !tab.isPinned) service.setPinned(id, true)
        if (action === 'unpin' && tab.isPinned) service.setPinned(id, false)
        if (action === 'load' && tab.loadState === 'unloaded') service.loadTab(id)
        if (action === 'unload' && !['unloaded', 'unloading', 'mounting'].includes(tab.loadState)) {
          await service.unloadTab(id)
        }
        if (action === 'reload') await service.reloadTab(id)
      }
    } finally {
      runningSelectionAction.value = false
    }
  }

  async function activateTab(tabId) {
    if (selecting.value) {
      toggleTabSelection(tabId)
      return
    }
    await getCapacitorTabService().activateTab(tabId)
    await afterActivate()
  }

  async function closeTab(tabId) {
    if (tabs.value.length === 1) {
      closeTabActions()
      requestExit()
      return false
    }

    await getCapacitorTabService().closeTab(tabId)
    await afterClose()
    return true
  }

  function openTabActions(tabId) {
    beforeOpenActions()
    actionTabId.value = tabId
  }

  function closeTabActions() {
    actionTabId.value = null
    afterCloseActions()
  }

  function handleTabTargetKeydown(event, tabId) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return

    event.preventDefault()
    if (stopContextMenuPropagation) event.stopPropagation()
    openTabActions(tabId)
  }

  function toggleActionTabPinned() {
    if (!actionTab.value) return

    getCapacitorTabService().setPinned(actionTab.value.id, !actionTab.value.isPinned)
    closeTabActions()
  }

  async function duplicateActionTab() {
    if (!actionTab.value) return

    await getCapacitorTabService().duplicateTab(actionTab.value.id)
    closeTabActions()
    await afterDuplicate()
  }

  async function copyActionTabYoutubeLink() {
    const url = actionTabYoutubeUrl.value
    if (!url) return

    closeTabActions()
    await copyToClipboard(url, {
      messageOnSuccess: t('Share.YouTube URL copied to clipboard')
    })
  }

  async function reloadActionTab() {
    if (!actionTab.value) return

    const tabId = actionTab.value.id
    closeTabActions()
    await getCapacitorTabService().reloadTab(tabId)
  }

  async function toggleActionTabLoaded() {
    if (!actionTab.value || !canToggleActionTabLoaded.value) return

    const tab = actionTab.value
    closeTabActions()
    if (tab.loadState === 'unloaded') {
      getCapacitorTabService().loadTab(tab.id)
    } else {
      await getCapacitorTabService().unloadTab(tab.id)
    }
  }

  async function closeActionTab() {
    if (!actionTab.value) return

    const tabId = actionTab.value.id
    closeTabActions()
    await closeTab(tabId)
  }

  return {
    selecting,
    selectedTabIds,
    closingTabs,
    runningSelectionAction,
    canPinSelectedTabs,
    canUnpinSelectedTabs,
    canLoadSelectedTabs,
    canUnloadSelectedTabs,
    clearSelection,
    toggleTabSelection,
    selectActionTab,
    relatedTabIds,
    closeRelatedTabs,
    closeSelectedTabs,
    runSelectedTabAction,
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
  }
}
