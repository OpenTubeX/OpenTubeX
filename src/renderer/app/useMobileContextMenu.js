import { computed, nextTick, onBeforeUnmount, provide, ref, shallowRef, unref, useId, useTemplateRef, watch } from 'vue'

import store from '../store/index'
import { useBottomSheetDismiss } from '../composables/useBottomSheetDismiss'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../helpers/overlayScrollbars'
import { lockBodyScroll, unlockBodyScroll } from '../components/FtPrompt/scrollLock'
import { resolveMobileContextLinkCopyUrl } from '../helpers/mobileLinkActions'
import { getChannelLinkDetails, getChannelLinkMenuItems } from '../helpers/channel-context-menu'
import { copyToClipboard, openInternalPath, shareLink } from '../helpers/utils'

/**
 * The mobile bottom sheet for long-pressed links and for action menus that
 * components open through the injected `openMobileContextActions`. Submenus
 * open in place and Back returns to their parent menu.
 *
 * @param {{
 *   t: (key: string) => string,
 *   route: import('vue-router').RouteLocationNormalizedLoaded,
 *   router: import('vue-router').Router,
 *   getEventLink: (event: Event) => HTMLAnchorElement | null,
 *   handleYoutubeLink: (href: string, options?: { doCreateNewTab?: boolean }) => Promise<void>,
 *   handleExternalLink: (href: string) => void
 * }} options
 */
export function useMobileContextMenu({ t, route, router, getEventLink, handleYoutubeLink, handleExternalLink }) {
  const mobileContextLink = ref(null)
  const mobileContextActions = shallowRef(null)
  const mobileContextMenuTarget = shallowRef(document.fullscreenElement ?? document.body)
  function updateMobileContextMenuTarget() {
    mobileContextMenuTarget.value = document.fullscreenElement ?? document.body
  }
  document.addEventListener('fullscreenchange', updateMobileContextMenuTarget)
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', updateMobileContextMenuTarget))
  const mobileContextMenuPath = ref([])
  const mobileContextMenuStack = computed(() => {
    const stack = [{ label: mobileContextLinkLabel.value, items: unref(mobileContextActions.value?.actions) ?? [] }]
    for (const label of mobileContextMenuPath.value) {
      const action = stack.at(-1).items.find(item => item.label === label)
      if (!action?.submenu) break
      stack.push({ label: action.label, items: action.submenu })
    }
    return stack
  })
  const mobileContextMenuItems = computed(() => mobileContextMenuStack.value.at(-1).items)
  const mobileContextQuickActions = computed(() => mobileContextMenuItems.value.filter(action => action.quickAction))
  const mobileContextThumbnailActions = computed(() => mobileContextMenuStack.value.length === 1
    ? unref(mobileContextActions.value?.thumbnailActions) ?? []
    : [])
  const mobileContextMenuRows = computed(() => {
    const rows = mobileContextMenuItems.value.filter(action => !action.quickAction)
    return rows.filter((action, index) => action.type !== 'separator' || (
      index > 0 && index < rows.length - 1 && rows[index - 1].type !== 'separator'
    ))
  })
  const mobileContextMenuTitle = computed(() => mobileContextMenuStack.value.at(-1).label)
  provide('openMobileContextActions', async (menu) => {
    mobileContextMenuPath.value = []
    mobileContextLink.value = null
    mobileContextActions.value = menu
    await nextTick()
    mobileLinkActionsRef.value?.focus({ preventScroll: true })
  })
  const mobileLinkActionsPromptId = useId()
  const mobileLinkActionsRef = useTemplateRef('mobileLinkActionsRef')
  const {
    startDrag: startMobileContextDrag, moveTouch: moveMobileContextTouch, filterClick: filterMobileContextClick,
    updateScrollAction: updateMobileContextScrollAction,
    enter: enterMobileContextSheet, leave: leaveMobileContextSheet
  } = useBottomSheetDismiss(mobileLinkActionsRef, closeMobileLinkActions, {
    canDismissOnBack: () => mobileContextMenuStack.value.length === 1
  })
  const mobileLinkActionsScrollRef = useTemplateRef('mobileLinkActionsScrollRef')
  const mobileLinkActionsContentRef = useTemplateRef('mobileLinkActionsContentRef')
  watch(mobileLinkActionsContentRef, (content, _, onCleanup) => {
    if (!content) return
    const scroller = mobileLinkActionsScrollRef.value
    const observer = new ResizeObserver(() => clampOverlayScrollTop(scroller, content))
    observer.observe(content)
    observer.observe(scroller)
    onCleanup(() => observer.disconnect())
  })
  watch([mobileContextLink, mobileContextActions, mobileContextMenuPath], async () => {
    await nextTick()
    if (mobileLinkActionsScrollRef.value) restoreOverlayScrollTop(mobileLinkActionsScrollRef.value, 0)
  })
  let mobileLinkActionsLocked = false
  const mobileContextLinkLabel = computed(() => {
    if (mobileContextActions.value) return mobileContextActions.value.title
    const link = mobileContextLink.value
    if (!link) return ''

    const itemTitle = link.closest('.ft-list-item')?.querySelector('.h3Title, .playlistTitle')?.textContent
    return link.dataset.tabTitle?.trim() ||
      link.getAttribute('aria-label')?.trim() ||
      link.textContent?.trim() ||
      itemTitle?.trim() ||
      link.href
  })
  watch(() => mobileContextMenuStack.value.length, (depth) => {
    if (mobileContextMenuPath.value.length >= depth) {
      mobileContextMenuPath.value = mobileContextMenuPath.value.slice(0, depth - 1)
    }
  })
  const mobileContextLinkCanOpenInTab = computed(() => {
    if (!store.getters.getTabsEnabled) return false
    const href = mobileContextLink.value?.href ?? ''
    return href.startsWith(`${window.location.href.split('#')[0]}#`) ||
      /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//.test(href)
  })
  const mobileContextLinkCopyUrl = computed(() => {
    const href = mobileContextLink.value?.href
    return href
      ? resolveMobileContextLinkCopyUrl(href, window.location.href.split('#')[0])
      : null
  })
  watch(() => mobileContextLink.value !== null || mobileContextActions.value !== null, (isOpen) => {
    if (isOpen && !mobileLinkActionsLocked) {
      lockBodyScroll()
      store.commit('addOpenPrompt', mobileLinkActionsPromptId)
      mobileLinkActionsLocked = true
    }
  })
  function releaseMobileContextSheet() {
    if (mobileContextLink.value || mobileContextActions.value || !mobileLinkActionsLocked) return
    store.commit('removeOpenPrompt', mobileLinkActionsPromptId)
    unlockBodyScroll()
    mobileLinkActionsLocked = false
  }

  async function handleMobileLinkContextMenu(event) {
    if (event.target instanceof Element && event.target.closest('.ft-list-video') && !event.target.closest('.channelName')) return
    const link = getEventLink(event)
    if (!link) return

    event.preventDefault()
    event.stopPropagation()
    const channel = getChannelLinkDetails(link)
    mobileContextActions.value = channel
      ? { title: channel.name, actions: getChannelLinkMenuItems(channel, t) }
      : null
    mobileContextLink.value = link
    await nextTick()
    mobileLinkActionsRef.value?.focus({ preventScroll: true })
  }

  function closeOwnedMobileContextMenu(event) {
    if (mobileContextActions.value?.actions === event.detail) closeMobileLinkActions()
  }

  watch(() => route.fullPath, closeMobileLinkActions)

  function closeMobileLinkActions() {
    mobileContextMenuPath.value = []
    mobileContextLink.value = null
    mobileContextActions.value = null
  }

  async function backMobileContextMenu() {
    if (mobileContextMenuStack.value.length === 1) {
      closeMobileLinkActions()
      return
    }
    const triggerLabel = mobileContextMenuStack.value.at(-1).label
    mobileContextMenuPath.value = mobileContextMenuPath.value.slice(0, mobileContextMenuStack.value.length - 2)
    await nextTick()
    mobileLinkActionsRef.value?.querySelector(`[role="menuitem"][aria-label="${CSS.escape(triggerLabel)}"]:not(:disabled)`)?.focus({ preventScroll: true })
  }

  async function runMobileContextAction(action) {
    if (action.enabled === false) return
    if (action.submenu) {
      mobileContextMenuPath.value = [...mobileContextMenuStack.value.slice(1).map(level => level.label), action.label]
      await nextTick()
      mobileLinkActionsRef.value?.querySelector('.mobileLinkActionsBack')?.focus({ preventScroll: true })
      return
    }
    closeMobileLinkActions()
    return action.run()
  }

  async function copyMobileContextLink() {
    const url = mobileContextLinkCopyUrl.value
    if (!url) return

    closeMobileLinkActions()
    await copyToClipboard(url)
  }

  async function shareMobileContextLink() {
    const url = mobileContextLinkCopyUrl.value
    if (!url) return

    closeMobileLinkActions()
    await shareLink(url)
  }

  async function openMobileContextLink(newTab) {
    const link = mobileContextLink.value
    if (!link) return

    const href = link.href
    closeMobileLinkActions()
    const internalPrefix = `${window.location.href.split('#')[0]}#`
    if (href.startsWith(internalPrefix)) {
      const destination = router.resolve(new URL(href).hash.slice(1))
      await openInternalPath({
        path: destination.path,
        query: destination.query,
        title: link.dataset.tabTitle || undefined,
        doCreateNewTab: newTab,
        makeActive: true
      })
      return
    }

    if (/^https?:\/\/((www\.|m\.)?youtube\.com|youtu\.be)\//.test(href)) {
      await handleYoutubeLink(href, { doCreateNewTab: newTab })
      return
    }

    handleExternalLink(href)
  }

  onBeforeUnmount(() => {
    if (mobileLinkActionsLocked) {
      store.commit('removeOpenPrompt', mobileLinkActionsPromptId)
      unlockBodyScroll()
      mobileLinkActionsLocked = false
    }
  })

  return {
    mobileContextLink,
    mobileContextActions,
    mobileContextMenuTarget,
    mobileContextMenuStack,
    mobileContextQuickActions,
    mobileContextThumbnailActions,
    mobileContextMenuRows,
    mobileContextMenuTitle,
    mobileLinkActionsRef,
    startMobileContextDrag,
    moveMobileContextTouch,
    filterMobileContextClick,
    updateMobileContextScrollAction,
    enterMobileContextSheet,
    leaveMobileContextSheet,
    mobileContextLinkCanOpenInTab,
    mobileContextLinkCopyUrl,
    releaseMobileContextSheet,
    handleMobileLinkContextMenu,
    closeOwnedMobileContextMenu,
    closeMobileLinkActions,
    backMobileContextMenu,
    runMobileContextAction,
    copyMobileContextLink,
    shareMobileContextLink,
    openMobileContextLink
  }
}
