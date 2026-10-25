import { computed, ref } from 'vue'

import store from '../store/index'
import { exitAndroidApp } from '../helpers/androidUi'
import { hasVisibleGamepadLayer } from '../helpers/gamepadNavigation'
import { getAndroidBackPlayer, getAndroidBackSheet } from '../helpers/androidBackGesture'
import { createAndroidBackDialogPreview } from '../helpers/androidBackDialog'
import { getSettingsWindowIconButton, getUtilityWindowCloseKeyframes } from '../helpers/utilityWindowMorph'

/**
 * Android Back and its predictive previews. Back closes the topmost layer
 * (context menu, side drawer, popup, dialog, settings, phone search or tab
 * overview), then goes back in the presented tab's history, and finally leaves
 * the app, asking first when close confirmation is enabled.
 *
 * @param {{
 *   t: (key: string) => string,
 *   navigation: { back: (tabId: string) => Promise<unknown> } | null,
 *   presentedTabId: import('vue').ComputedRef<string | null>,
 *   settingsWindowOpen: import('vue').ComputedRef<boolean>,
 *   isAnyPromptOpen: import('vue').ComputedRef<boolean>,
 *   isSideNavOpen: import('vue').ComputedRef<boolean>,
 *   closeSideNav: () => void,
 *   useWatchSideNavOverlay: import('vue').ComputedRef<boolean>,
 *   isLocaleRightToLeft: import('vue').ComputedRef<boolean>,
 *   mobileContextLink: import('vue').Ref<HTMLAnchorElement | null>,
 *   mobileContextActions: import('vue').ShallowRef<object | null>,
 *   mobileLinkActionsRef: import('vue').ShallowRef<HTMLElement | null>,
 *   backMobileContextMenu: () => Promise<void>
 * }} options
 */
export function useAndroidBack({
  t,
  navigation,
  presentedTabId,
  settingsWindowOpen,
  isAnyPromptOpen,
  isSideNavOpen,
  closeSideNav,
  useWatchSideNavOverlay,
  isLocaleRightToLeft,
  mobileContextLink,
  mobileContextActions,
  mobileLinkActionsRef,
  backMobileContextMenu
}) {
  const showAndroidExitPrompt = ref(false)

  const ANDROID_EXIT_PROMPT_VALUES = ['quit', 'cancel', 'neverAskAgain']
  const androidExitPromptNames = computed(() => [
    t('Close Confirmation.Quit'),
    t('Cancel'),
    t('Close Confirmation.Never Ask Again')
  ])

  async function requestAndroidAppExit() {
    if (!store.getters.getConfirmCloseApp) {
      await exitAndroidApp()
      return
    }

    showAndroidExitPrompt.value = true
  }

  /** @param {'quit' | 'cancel' | 'neverAskAgain' | null} option */
  async function handleAndroidExitPromptAnswer(option) {
    showAndroidExitPrompt.value = false
    if (option === 'neverAskAgain') {
      await store.dispatch('updateConfirmCloseApp', false)
    }
    if (option === 'quit' || option === 'neverAskAgain') {
      await exitAndroidApp()
    }
  }

  function getAndroidBackTarget() {
    const modalDialog = [...document.querySelectorAll('dialog:modal')].at(-1)
    const settingsWindow = settingsWindowOpen.value ? document.querySelector('.settingsWindow') : null
    const openDialog = [...document.querySelectorAll('dialog[open]')].at(-1)
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : document
    const prompt = [...document.querySelectorAll('.prompt:not([inert])')].at(-1)
    const phoneSearch = document.querySelector('.topNav.phoneSearchOpen')
    const phoneTabDialog = document.querySelector('.capacitorPhoneTabDialog')
    const tabTarget = phoneTabDialog?.contains(focused) ? focused : phoneTabDialog
    const searchTarget = phoneSearch?.contains(focused) ? focused : phoneSearch
    // Color pickers in settings are teleported out of the window they belong to.
    const colorPicker = document.querySelector('.colorPickerPopover')
    const colorPickerTarget = colorPicker?.contains(focused) ? focused : colorPicker
    // Focused popups inside a prompt or settings close before their window.
    const promptTarget = prompt?.contains(focused) ? focused : prompt
    return colorPickerTarget ?? modalDialog ?? promptTarget ?? (settingsWindow?.contains(focused) ? focused : settingsWindow) ?? openDialog ?? tabTarget ?? searchTarget ?? focused
  }

  async function handleAndroidBack() {
    if (mobileContextLink.value !== null || mobileContextActions.value !== null) {
      backMobileContextMenu()
      return
    }

    const sideNavShown = isSideNavBackTarget()
    const hadOpenLayer = hasVisibleGamepadLayer() || sideNavShown
    const target = getAndroidBackTarget()
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    if (sideNavShown) {
      closeSideNav()
      return
    }
    if (!target.dispatchEvent(escapeEvent) || hadOpenLayer) {
      return
    }
    if (document.fullscreenElement !== null) {
      await document.exitFullscreen()
      return
    }

    const tabId = presentedTabId.value
    if (tabId && store.getters.getTabHistoryState(tabId).canGoBack) {
      await navigation.back(tabId)
      return
    }

    await requestAndroidAppExit()
  }

  function shouldInterceptAndroidBack() {
    const tabId = presentedTabId.value
    return Boolean(store.getters.getConfirmCloseApp ||
      (tabId && store.getters.getTabHistoryState(tabId).canGoBack) ||
      isSideNavShown() || settingsWindowOpen.value || isAnyPromptOpen.value ||
      mobileContextLink.value || mobileContextActions.value ||
      document.fullscreenElement || document.querySelector('.ftVideoPlayer.fullWindow, dialog[open], .topNav.phoneSearchOpen, .iconDropdown') ||
      hasVisibleGamepadLayer())
  }

  /** Narrow layouts show the bottom navigation bar instead of the drawer. */
  function isSideNavShown() {
    return isSideNavOpen.value && window.matchMedia('(width > 680px)').matches
  }

  /** Back closes the side nav only when no layer is open above it. */
  function isSideNavBackTarget() {
    return isSideNavShown() && !isAnyPromptOpen.value && !settingsWindowOpen.value &&
      !mobileContextLink.value && !mobileContextActions.value && !document.querySelector('dialog[open]') &&
      !getAndroidBackPopup(document.activeElement ?? document.body)
  }

  /** @param {Element} target */
  function getAndroidBackPopup(target) {
    const popup = target.closest?.('[data-settings-escape-scope], .iconDropdown, .colorPickerPopover, .contextMenu')
    if (popup) return popup
    const id = target.closest?.('[aria-expanded="true"][aria-controls]')?.getAttribute('aria-controls')
    const controlled = id ? document.getElementById(id) : null
    // Disclosure buttons also control panels, which Back does not close.
    return controlled?.matches('[role="listbox"], [role="menu"], [role="dialog"]') ? controlled : null
  }

  /**
   * Shrink the visible part of a page into a card, like Android's in-app Back.
   * Pages have no visible fixed-position children, which a transform would move.
   * @param {HTMLElement} page
   */
  function getAndroidBackPageKeyframes(page) {
    const bounds = page.getBoundingClientRect()
    const top = Math.max(0, -bounds.top)
    const left = Math.max(0, -bounds.left)
    const bottom = Math.max(0, bounds.bottom - window.innerHeight)
    const right = Math.max(0, bounds.right - window.innerWidth)
    const transformOrigin = `${window.innerWidth / 2 - bounds.left}px ${window.innerHeight / 2 - bounds.top}px`
    const visible = `${top}px ${right}px ${bottom}px ${left}px`
    return [
      { transformOrigin, transform: 'scale(1)', clipPath: `inset(${visible} round 0px)` },
      { transformOrigin, transform: 'scale(0.9)', clipPath: `inset(${visible} round 32px)` }
    ]
  }

  /** Use the first preview that can begin; the rest keep their ordinary Back. */
  function combineAndroidBackPreviews(previews) {
    let active = null
    return {
      begin() {
        active = previews.find(preview => preview?.begin()) ?? null
        return active !== null
      },
      update(progress) { active?.update(progress) },
      finish(commit) { return active?.finish(commit) },
      cancel() { active?.cancel() },
    }
  }

  function getAndroidBackPreview() {
    if (mobileContextLink.value || mobileContextActions.value) {
      return mobileLinkActionsRef.value ? getAndroidBackSheet(mobileLinkActionsRef.value) : null
    }
    if (isSideNavBackTarget()) {
      const drawer = document.querySelector('.sideNav')
      if (!drawer) return null
      const overlay = useWatchSideNavOverlay.value
      return createAndroidBackDialogPreview(drawer, handleAndroidBack, isSideNavBackTarget, () => overlay
        ? [
            { transform: 'translateX(0)' },
            { transform: `translateX(${(isLocaleRightToLeft.value ? 1 : -1) * drawer.getBoundingClientRect().width}px)` }
          ]
        // The rail pushes the page, so it collapses like the button does.
        : [{ inlineSize: getComputedStyle(drawer).inlineSize }, { inlineSize: 'var(--desktop-nav-rail-width)' }])
    }
    const target = getAndroidBackTarget()
    const sheet = getAndroidBackSheet(target) ?? getAndroidBackSheet(target.closest?.('[data-bottom-sheet]'))
    if (sheet && !target.classList.contains('compactSheet')) return sheet
    const popup = getAndroidBackPopup(target)
    if (popup) {
      return createAndroidBackDialogPreview(popup, handleAndroidBack, () =>
        popup.isConnected && getAndroidBackPopup(getAndroidBackTarget()) === popup)
    }
    const dialog = target.closest?.('.settingsWindow, .prompt, dialog[open]')
    if (dialog && !target.closest?.('[aria-expanded="true"]')) {
      const nested = dialog.hasAttribute('data-android-back-nested')
      const content = nested
        ? dialog.querySelector('.settingsContent') ?? dialog
        : dialog
      const isAvailable = () =>
        content.isConnected && dialog.hasAttribute('data-android-back-nested') === nested &&
        getAndroidBackTarget().closest?.('.settingsWindow, .prompt, dialog[open]') === dialog
      if (!nested && dialog.matches('.settingsWindow')) {
        // An opening morph owns the window. Ordinary Back closes it once the morph ends.
        if (store.getters.getSettingsWindowMorphing) return null
        // The gesture plays the morph into the header button, so closing must not replay it.
        return createAndroidBackDialogPreview(dialog, () => store.dispatch('hideSettingsWindow'), isAvailable, element =>
          getUtilityWindowCloseKeyframes(element, getSettingsWindowIconButton(store.getters.getSettingsWindowView)))
      }
      return createAndroidBackDialogPreview(content, handleAndroidBack, isAvailable)
    }
    const tabOverlay = target.closest?.('.capacitorPhoneTabOverlay')
    if (tabOverlay) {
      // Back returns from tab history to open tabs inside the switcher.
      const isClosing = () => tabOverlay.isConnected && !tabOverlay.querySelector('.capacitorPhoneTabDialog:is([inert], [data-android-back-nested])') &&
        getAndroidBackTarget().closest?.('.capacitorPhoneTabOverlay') === tabOverlay
      if (!isClosing()) return null
      return createAndroidBackDialogPreview(tabOverlay, handleAndroidBack, isClosing, () => [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.94)' }
      ])
    }
    const search = target.closest?.('.topNav.phoneSearchOpen')
    const searchContainer = search?.querySelector('.searchContainer')
    if (searchContainer) {
      return createAndroidBackDialogPreview(searchContainer, handleAndroidBack, () =>
        searchContainer.isConnected && getAndroidBackTarget().closest?.('.topNav.phoneSearchOpen') === search, () => [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translateX(${isLocaleRightToLeft.value ? -24 : 24}px)` }
      ])
    }
    const tabId = presentedTabId.value
    if (!tabId || settingsWindowOpen.value || isAnyPromptOpen.value || hasVisibleGamepadLayer() ||
      document.fullscreenElement || document.querySelector('dialog[open], .topNav.phoneSearchOpen')) return null
    const page = document.querySelector(`.tabContent[data-tab-id="${CSS.escape(tabId)}"]`)
    return combineAndroidBackPreviews([
      getAndroidBackPlayer(tabId),
      page && createAndroidBackDialogPreview(page, handleAndroidBack, () =>
        page.isConnected && presentedTabId.value === tabId && store.getters.getTabHistoryState(tabId).canGoBack,
      getAndroidBackPageKeyframes)
    ])
  }

  return {
    showAndroidExitPrompt,
    ANDROID_EXIT_PROMPT_VALUES,
    androidExitPromptNames,
    requestAndroidAppExit,
    handleAndroidExitPromptAnswer,
    handleAndroidBack,
    shouldInterceptAndroidBack,
    getAndroidBackPreview
  }
}
