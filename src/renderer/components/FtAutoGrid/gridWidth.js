export function measureStableGridWidth(
  gridWidth,
  observedScrollbarWidth,
  viewportWidth,
  documentWidth
) {
  const scrollbarWidth = Math.max(
    observedScrollbarWidth,
    viewportWidth - documentWidth
  )

  return {
    gridWidth: Math.max(0, gridWidth - scrollbarWidth),
    scrollbarWidth
  }
}
