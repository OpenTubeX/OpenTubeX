/**
 * Moves an item relative to its visible neighbors while preserving entries
 * that are unavailable in the current environment.
 *
 * @param {string[]} items
 * @param {string[]} visibleItems
 * @param {string} itemId
 * @param {number} offset
 * @returns {string[]}
 */
export function moveItemByVisibleOffset(items, visibleItems, itemId, offset) {
  const visibleIndex = visibleItems.indexOf(itemId)
  const targetId = visibleItems[visibleIndex + offset]
  if (visibleIndex === -1 || targetId == null) return items

  const reordered = items.slice()
  const sourceIndex = reordered.indexOf(itemId)
  if (sourceIndex === -1) return items

  reordered.splice(sourceIndex, 1)
  const targetIndex = reordered.indexOf(targetId)
  reordered.splice(targetIndex + (offset > 0 ? 1 : 0), 0, itemId)
  return reordered
}
