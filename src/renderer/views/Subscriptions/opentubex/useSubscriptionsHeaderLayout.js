import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * How much inline space the children of a flex container need next to each
 * other, which isn't the same as the container's own width when it stretches or
 * its content wraps.
 * @param {HTMLElement} container
 * @param {(child: Element) => number} [childWidth]
 */
function singleLineWidth(container, childWidth = child => child.getBoundingClientRect().width) {
  const children = Array.from(container.children)
    .filter(child => getComputedStyle(child).position !== 'absolute')
  const columnGap = Number.parseFloat(getComputedStyle(container).columnGap) || 0

  return children.reduce((total, child) => total + childWidth(child), 0) +
    columnGap * Math.max(children.length - 1, 0)
}

/**
 * The inline size available to flex children. getBoundingClientRect includes
 * the padding used to extend the tabbed-view separator across the header.
 * @param {HTMLElement} element
 */
function contentBoxWidth(element) {
  const style = getComputedStyle(element)
  return element.getBoundingClientRect().width -
    (Number.parseFloat(style.paddingInlineStart) || 0) -
    (Number.parseFloat(style.paddingInlineEnd) || 0) -
    (Number.parseFloat(style.borderInlineStartWidth) || 0) -
    (Number.parseFloat(style.borderInlineEndWidth) || 0)
}

/**
 * The group chips and actions, which the group bar wraps as one row. Its tab
 * list doesn't generate a box of its own.
 * @param {HTMLElement} bar
 */
function groupBarItems(bar) {
  return Array.from(bar.children)
    .flatMap(child => getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child])
    .filter(child => child.getClientRects().length > 0 && !['absolute', 'fixed'].includes(getComputedStyle(child).position))
}

/**
 * Measures whether the Subscriptions header fits onto a single row and whether
 * the subscription groups fit beside the New feed's tabs.
 *
 * @param {{
 *   headerRef: import('vue').Ref<HTMLElement | null>,
 *   headerRowRef: import('vue').Ref<HTMLElement | null>,
 *   feedTabsControlsRowRef: import('vue').Ref<HTMLElement | null>,
 *   tabsRowRef: import('vue').Ref<HTMLElement | null>,
 *   tabsContainerRef: import('vue').Ref<{ $el: HTMLElement } | null>,
 *   newFeedTabsRef: import('vue').Ref<{ $el: HTMLElement } | null>,
 *   subscriptionGroupsRef: import('vue').Ref<{ $el: HTMLElement } | null>,
 *   layoutSources: import('vue').WatchSource[]
 * }} options `layoutSources` change which elements the header renders, so
 * they trigger observing and measuring it again.
 */
export function useSubscriptionsHeaderLayout({
  headerRef,
  headerRowRef,
  feedTabsControlsRowRef,
  tabsRowRef,
  tabsContainerRef,
  newFeedTabsRef,
  subscriptionGroupsRef,
  layoutSources
}) {
  /** @type {import('vue').Ref<boolean>} */
  const headerFitsOneRow = ref(false)
  /** @type {import('vue').Ref<boolean>} */
  const groupsBesideNewFeedTabs = ref(false)
  let headerResizeObserver = null

  /**
   * The tabs and actions sit next to the page title while all three fit onto one
   * line. Otherwise the tabs and actions move together below the title. The
   * single row layout doesn't let its children shrink and the tabs are measured
   * through their content, so the measurement is stable in both layouts.
   */
  function updateHeaderFitsOneRow() {
    const row = headerRowRef.value
    const feedTabsControlsRow = feedTabsControlsRowRef.value
    const tabsRow = tabsRowRef.value
    const tabs = tabsContainerRef.value?.$el

    if (
      !(row instanceof HTMLElement) ||
      !(feedTabsControlsRow instanceof HTMLElement) ||
      !(tabsRow instanceof HTMLElement) ||
      !(tabs instanceof HTMLElement) ||
      row.getClientRects().length === 0
    ) {
      return
    }

    const tabsRowWidth = singleLineWidth(tabsRow, child => {
      return child === tabs ? singleLineWidth(tabs) : child.getBoundingClientRect().width
    })
    const feedTabsControlsRowWidth = singleLineWidth(feedTabsControlsRow, child => {
      return child === tabsRow ? tabsRowWidth : child.getBoundingClientRect().width
    })
    const requiredWidth = singleLineWidth(row, child => {
      // The grouped row stretches across the header in the split layout
      return child === feedTabsControlsRow
        ? feedTabsControlsRowWidth
        : child.getBoundingClientRect().width
    })

    // Fractional widths throughout, as rounding the available space up would let
    // the single row layout overflow, which puts the tabs onto a second line again
    headerFitsOneRow.value = requiredWidth <= contentBoxWidth(row)
  }

  /**
   * The groups share the row of the New feed's tabs while they fit onto one line
   * beside them, without moving the tabs off the center of the header.
   */
  function updateGroupsBesideNewFeedTabs() {
    const header = headerRef.value
    const tabs = newFeedTabsRef.value?.$el
    const bar = subscriptionGroupsRef.value?.$el

    if (
      !(header instanceof HTMLElement) ||
      !(tabs instanceof HTMLElement) ||
      !(bar instanceof HTMLElement) ||
      header.getClientRects().length === 0
    ) {
      groupsBesideNewFeedTabs.value = false
      return
    }

    const items = groupBarItems(bar)
    const itemGap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0
    const groupsWidth = items.reduce((total, item) => total + item.getBoundingClientRect().width, 0) +
      itemGap * Math.max(items.length - 1, 0)
    const columnGap = Number.parseFloat(getComputedStyle(header).getPropertyValue('--new-feed-groups-gap')) || 0

    groupsBesideNewFeedTabs.value = groupsWidth + columnGap <= (contentBoxWidth(header) - singleLineWidth(tabs)) / 2
  }

  function updateHeaderLayout() {
    updateHeaderFitsOneRow()
    updateGroupsBesideNewFeedTabs()
  }

  function observeHeaderRow() {
    const row = headerRowRef.value

    if (headerResizeObserver === null || !(row instanceof HTMLElement)) {
      return
    }

    // Everything the measurement reads is observed, not just the row: text inside
    // the children (the refresh timestamps above all) changes their widths without
    // resizing the row, and the tabs row keeps its full width while it has a line
    // of its own, so its children have to be watched instead of it
    headerResizeObserver.disconnect()
    headerResizeObserver.observe(row)

    for (const child of row.children) {
      headerResizeObserver.observe(child)
    }

    for (const child of feedTabsControlsRowRef.value?.children ?? []) {
      headerResizeObserver.observe(child)
    }

    for (const child of tabsRowRef.value?.children ?? []) {
      headerResizeObserver.observe(child)
    }

    for (const child of tabsContainerRef.value?.$el?.children ?? []) {
      headerResizeObserver.observe(child)
    }

    // The header for the space beside the New feed's tabs
    if (headerRef.value instanceof HTMLElement) {
      headerResizeObserver.observe(headerRef.value)
    }

    for (const child of newFeedTabsRef.value?.$el?.children ?? []) {
      headerResizeObserver.observe(child)
    }

    const groupBar = subscriptionGroupsRef.value?.$el
    if (groupBar instanceof HTMLElement) {
      for (const item of groupBarItems(groupBar)) {
        headerResizeObserver.observe(item)
      }
    }
  }

  // Which elements exist changes with the panel (the refresh widget is only
  // rendered once it is mounted), with the Mark all as seen button, the New feed's
  // view and the groups
  watch([...layoutSources, headerFitsOneRow], () => {
    const restoreFocus = headerRowRef.value?.querySelector('.markAllSeenButton') === document.activeElement
    nextTick(() => {
      observeHeaderRow()
      updateHeaderLayout()
      // Moving the button between rows must preserve keyboard focus.
      if (restoreFocus) {
        headerRowRef.value?.querySelector('.markAllSeenButton')?.focus({ preventScroll: true })
      }
    })
  })

  onMounted(() => {
    if (typeof ResizeObserver === 'function') {
      headerResizeObserver = new ResizeObserver(() => {
        updateHeaderLayout()
      })
      observeHeaderRow()
    }

    nextTick(() => {
      updateHeaderLayout()
    })
  })

  onBeforeUnmount(() => {
    headerResizeObserver?.disconnect()
  })

  return { headerFitsOneRow, groupsBesideNewFeedTabs }
}
