/**
 * Read a leaving batch before transition hooks write positioning styles.
 * Interleaving reads and writes forces a layout for every removed card.
 * @param {HTMLElement} grid
 */
export function measureLeavingItemLayouts(grid) {
  const gridRect = grid.getBoundingClientRect()
  return new Map(Array.from(grid.children, element => {
    const rect = element.getBoundingClientRect()
    return [element, {
      width: rect.width,
      height: rect.height,
      left: rect.left - gridRect.left,
      top: rect.top - gridRect.top,
    }]
  }))
}
