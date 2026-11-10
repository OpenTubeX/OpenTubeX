/**
 * Calculate transforms that visually place items in a proposed order.
 * @param {Array<{id: string, start: number, size: number}>} rects
 * @param {string[]} reorderedIds
 * @param {number} gap
 * @param {Set<string>} freelyMovingIds
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
export function computeReorderOffsets(
  rects,
  reorderedIds,
  gap,
  freelyMovingIds = new Set(),
  draggedOffset = 0
) {
  const offsets = {}
  const rectById = new Map(rects.map(rect => [rect.id, rect]))
  let cursor = rects[0]?.start ?? 0

  for (const itemId of reorderedIds) {
    const rect = rectById.get(itemId)
    if (!rect) continue

    const offset = freelyMovingIds.has(itemId)
      ? draggedOffset
      : cursor - rect.start
    if (offset !== 0) {
      offsets[itemId] = offset
    }
    cursor += rect.size + gap
  }

  return offsets
}
