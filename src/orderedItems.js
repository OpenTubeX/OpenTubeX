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

/**
 * Where a dropped item goes in the full list, which can hold items the list
 * does not render: right after the item rendered before it, or right before
 * the one rendered after it when it was dropped first.
 * @param {string[]} ids The full list's order
 * @param {string} id
 * @param {string[]} order The rendered items' new order
 * @returns {number} The item's new index, or -1 when its neighbors are missing
 */
export function droppedIndex(ids, id, order) {
  const rest = ids.filter(other => other !== id)
  const position = order.indexOf(id)
  const index = position > 0 ? rest.indexOf(order[position - 1]) + 1 : rest.indexOf(order[1])
  return position > 0 && index === 0 ? -1 : index
}

/**
 * Moves an item next to its new rendered neighbors in the full list, which can
 * hold items the list does not render. Returns the same list when the item or
 * its neighbors are missing, such as after another window removed them.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} getId
 * @param {string} id
 * @param {string[]} order The rendered items' new order
 * @returns {T[]}
 */
export function moveItemToRenderedOrder(items, getId, id, order) {
  const ids = items.map(getId)
  const from = ids.indexOf(id)
  const to = droppedIndex(ids, id, order)
  if (from === -1 || to === -1 || to === from) return items
  const moved = items.toSpliced(from, 1)
  moved.splice(to, 0, items[from])
  return moved
}
