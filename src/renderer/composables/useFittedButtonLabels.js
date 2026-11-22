import { computed, nextTick, onBeforeUnmount, onMounted, ref, toValue } from 'vue'

// Fallback width of an icon-only button, used for actions in the More menu
const ICON_BUTTON_SIZE = 48

/**
 * @param {Element} element
 */
function getOuterWidth(element) {
  const style = getComputedStyle(element)
  return element.getBoundingClientRect().width + parseFloat(style.marginInlineStart) + parseFloat(style.marginInlineEnd)
}

/**
 * Keeps a button group on one line of its row by collapsing button labels to
 * their icons, starting with the last button. Labels are the buttons' direct
 * `.buttonLabel` children and stay in the accessible name. CSS cannot measure
 * the labeled width of a collapsed group, so both widths are measured within
 * the same frame.
 *
 * When even the icons do not fit, the buttons with a `data-overflow-key` move
 * to the group's menu in the order of `overflowOrder`. Like the watch page's
 * toolbar, the moved buttons are budgeted at an icon button's width each, so
 * the freed space does not bring them back.
 * @param {import('vue').Ref<{ $el: HTMLElement } | null>} group
 * @param {import('vue').Ref<HTMLElement | null>} row
 * @param {import('vue').MaybeRefOrGetter<string[]>} [overflowOrder] Keys of the shown
 *   buttons that may move to the menu, the first one first
 * @returns {{ overflowed: import('vue').ComputedRef<string[]> }} Keys of the moved buttons
 */
export function useFittedButtonLabels(group, row, overflowOrder = []) {
  let frame
  const overflowCount = ref(0)
  const overflowed = computed(() => toValue(overflowOrder).slice(0, overflowCount.value))

  function update() {
    const groupElement = group.value?.$el
    const rowElement = row.value
    if (!groupElement || !rowElement || rowElement.clientWidth === 0) { return }

    const items = [...groupElement.children].filter(item => item.getClientRects().length > 0)
    const collapsible = items.map(item => item.querySelector(':scope > .buttonLabel') !== null)
    const collapse = (item, collapsed) => item.toggleAttribute('data-label-collapsed', collapsed)

    groupElement.toggleAttribute('data-measuring-labels', true)
    items.forEach((item, index) => collapsible[index] && collapse(item, false))
    const labeledWidths = items.map(getOuterWidth)
    items.forEach((item, index) => collapsible[index] && collapse(item, true))
    const collapsedWidths = items.map(getOuterWidth)

    const gap = parseFloat(getComputedStyle(groupElement).columnGap) || 0
    const rowStyle = getComputedStyle(rowElement)
    const availableWidth = rowElement.clientWidth - parseFloat(rowStyle.paddingInlineStart) -
      parseFloat(rowStyle.paddingInlineEnd) + 0.5
    const sumWidths = widths => widths.reduce((sum, itemWidth) => sum + itemWidth, 0) + gap * Math.max(widths.length - 1, 0)

    const order = toValue(overflowOrder)
    const hiddenCount = overflowed.value.length
    const iconWidth = collapsedWidths.find((_, index) => collapsible[index]) ?? ICON_BUTTON_SIZE
    // Moved buttons come back as icons, so they are budgeted in the collapsed width
    const hiddenWidth = hiddenCount * (iconWidth + gap)
    let collapsedWidth = sumWidths(collapsedWidths) + hiddenWidth
    let count = 0
    while (collapsedWidth > availableWidth && count < order.length) {
      const item = groupElement.querySelector(`:scope > [data-overflow-key="${order[count]}"]`)
      const index = items.indexOf(item)
      collapsedWidth -= (index === -1 ? iconWidth : collapsedWidths[index]) + gap
      count++
    }

    let width = sumWidths(labeledWidths) + hiddenWidth
    for (let index = items.length - 1; index >= 0; index--) {
      if (!collapsible[index]) { continue }
      const collapsed = count > 0 || width > availableWidth
      if (collapsed) width -= labeledWidths[index] - collapsedWidths[index]
      collapse(items[index], collapsed)
    }
    // Apply the result before transitions return, so they do not animate from the measured state
    groupElement.getBoundingClientRect()
    groupElement.toggleAttribute('data-measuring-labels', false)

    if (count !== overflowCount.value) {
      overflowCount.value = count
      // Fit the buttons that come back before the next paint
      nextTick(update)
    }
  }

  function schedule() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  }

  const resizeObserver = new ResizeObserver(schedule)
  // Catches buttons that appear or change their label, such as in edit mode or after a locale change
  const mutationObserver = new MutationObserver(schedule)

  onMounted(() => {
    resizeObserver.observe(row.value)
    mutationObserver.observe(group.value.$el, { childList: true, subtree: true, characterData: true })
    update()
  })

  onBeforeUnmount(() => {
    resizeObserver.disconnect()
    mutationObserver.disconnect()
    cancelAnimationFrame(frame)
  })

  return { overflowed }
}
