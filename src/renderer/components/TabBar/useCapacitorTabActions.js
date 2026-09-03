import { computed, ref } from 'vue'
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
  const { t } = useI18n()
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
