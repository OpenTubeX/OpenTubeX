// @ts-check

/** @param {string} value */
function px(value) {
  return Number.parseFloat(value) || 0
}

/**
 * Width the subscribe button would take with its label shown. The compact button keeps
 * its label measurable but has its own minimum, so this rebuilds the width from its parts.
 * @param {HTMLElement} button the `.subscribeButton` element
 */
export function labeledSubscribeButtonWidth(button) {
  const label = button.querySelector('.subscribeLabel')
  const width = button.getBoundingClientRect().width
  if (!label || !button.classList.contains('compact')) return width

  const style = getComputedStyle(button)
  const icon = button.querySelector('.ft-icon')?.getBoundingClientRect().width ?? 0
  return Math.max(px(style.getPropertyValue('--subscribe-button-min-size')),
    px(style.paddingInlineStart) + px(style.paddingInlineEnd) + px(style.borderInlineStartWidth) +
    px(style.borderInlineEndWidth) + icon + px(style.columnGap) + label.getBoundingClientRect().width)
}
