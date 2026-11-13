/**
 * @typedef {{ fullPath: string, path: string }} TabPageRoute
 * @typedef {{ key: number, index: number, route: TabPageRoute }} TabPage
 */

/**
 * Lists the page instances a tab keeps mounted after showing a history entry.
 * Pages are ordered by history index with the shown page last, so a retained
 * page never moves in the DOM and always paints below the shown page.
 *
 * Replacing the shown entry keeps its instance. Leaving an entry for a later
 * one retains its instance (up to `limit`) so Back can show it without reloading.
 *
 * @param {TabPage[]} pages
 * @param {{ index: number, route: TabPageRoute }} target the entry to show; -1 when it is not in history
 * @param {(index: number) => string | undefined} getEntryPath full path of the history entry at an index
 * @param {() => number} createKey
 * @param {number} limit how many earlier pages to keep
 * @returns {TabPage[]}
 */
export function showTabPage(pages, target, getEntryPath, createKey, limit) {
  const current = pages.at(-1)
  if (current?.index === target.index) {
    if (current.route.fullPath === target.route.fullPath) return pages
    return [...pages.slice(0, -1), { ...current, route: target.route }]
  }

  const reused = pages.find(page => page !== current && page.index === target.index &&
    page.route.fullPath === target.route.fullPath)
  const kept = limit > 0
    ? pages.filter(page => page !== reused && page.index >= 0 && page.index < target.index &&
      getEntryPath(page.index) === page.route.fullPath).slice(-limit)
    : []
  return [...kept, reused ? { ...reused, route: target.route } : { key: createKey(), index: target.index, route: target.route }]
}
