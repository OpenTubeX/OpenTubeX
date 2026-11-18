/**
 * Scroll offset that places an item at the vertical center of its container.
 * Returns `null` when the container is not laid out yet so callers can retry.
 *
 * @param {number} itemOffsetTop
 * @param {number} itemHeight
 * @param {number} containerHeight
 * @param {number} [maxScrollTop]
 * @returns {number | null}
 */
export function getCenteredChapterScrollTop(
  itemOffsetTop,
  itemHeight,
  containerHeight,
  maxScrollTop = Infinity
) {
  if (!(containerHeight > 0) || !(itemHeight > 0)) {
    return null
  }

  const top = itemOffsetTop - containerHeight / 2 + itemHeight / 2
  return Math.min(Math.max(0, top), Math.max(0, maxScrollTop))
}
