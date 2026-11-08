import { onBeforeUnmount, onMounted } from 'vue'

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
 * @param {import('vue').Ref<{ $el: HTMLElement } | null>} group
 * @param {import('vue').Ref<HTMLElement | null>} row
 */
export function useFittedButtonLabels(group, row) {
  let frame

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
    let width = labeledWidths.reduce((sum, itemWidth) => sum + itemWidth, 0) + gap * Math.max(items.length - 1, 0)

    for (let index = items.length - 1; index >= 0; index--) {
      if (!collapsible[index]) { continue }
      const collapsed = width > availableWidth
      if (collapsed) width -= labeledWidths[index] - collapsedWidths[index]
      collapse(items[index], collapsed)
    }
    // Apply the result before transitions return, so they do not animate from the measured state
    groupElement.getBoundingClientRect()
    groupElement.toggleAttribute('data-measuring-labels', false)
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
}
