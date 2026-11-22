export function measureStableGridWidth(
  gridWidth,
  observedScrollbarWidth,
  observedViewportWidth,
  viewportWidth,
  documentWidth,
  scrollbarCompensated = false
) {
  const currentScrollbarWidth = Math.max(0, viewportWidth - documentWidth)
  const viewportChanged = observedViewportWidth !== viewportWidth
  const scrollbarWidth = currentScrollbarWidth > 0
    ? currentScrollbarWidth
    : viewportChanged ? 0 : observedScrollbarWidth
  const widthAdjustment = scrollbarCompensated
    ? 0
    : scrollbarWidth - currentScrollbarWidth

  return {
    gridWidth: Math.max(0, gridWidth - widthAdjustment),
    scrollbarWidth,
    viewportWidth
  }
}
