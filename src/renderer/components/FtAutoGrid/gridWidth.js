export function measureStableGridWidth(
  gridWidth,
  observedScrollbarWidth,
  viewportWidth,
  documentWidth
) {
  const currentScrollbarWidth = viewportWidth - documentWidth
  const scrollbarWidth = Math.max(
    observedScrollbarWidth,
    currentScrollbarWidth
  )
  const widthAdjustment = scrollbarWidth - currentScrollbarWidth

  return {
    gridWidth: Math.max(0, gridWidth - widthAdjustment),
    scrollbarWidth
  }
}
