import { computed, ref } from 'vue'

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
  afterClose = noop,
  afterDuplicate = noop,
  beforeOpenActions = noop,
  afterCloseActions = noop,
  stopContextMenuPropagation = false,
}) {
  const actionTabId = ref(null)
  const actionTab = computed(() => (
    tabs.value.find(tab => tab.id === actionTabId.value) ?? null
  ))

  function tabTitle(tab) {
    return formatTabTitle(tab.contentTitle || tab.title || tab.route.fullPath)
  }

  async function createTab() {
    await getCapacitorTabService().createTab()
    await afterCreate()
  }

  async function activateTab(tabId) {
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

  async function closeActionTab() {
    if (!actionTab.value) return

    const tabId = actionTab.value.id
    closeTabActions()
    await closeTab(tabId)
  }

  return {
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
  }
}
