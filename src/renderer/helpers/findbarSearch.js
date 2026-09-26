/**
 * Own the document search and CSS highlight lifecycle for the active tab.
 * The root view supplies the active tab's DOM root and receives display counts.
 *
 * @param {{
 *   document: Document,
 *   view: Window,
 *   getRoot: () => Node | null,
 *   onMatchChange: (index: number, count: number) => void,
 * }} dependencies
 */
export function createFindbarSearch({ document, view, getRoot, onMatchChange }) {
  /** @type {Range[]} */
  let matches = []
  let selectedIndex = -1

  function clear() {
    view.CSS.highlights.delete('findbarmatch')
    view.CSS.highlights.delete('findbarmatchcurrent')
    matches = []
    selectedIndex = -1
    onMatchChange(0, 0)
  }

  /** @param {string} query */
  function search(query) {
    clear()
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (normalizedQuery.length === 0) return

    const walker = document.createTreeWalker(
      getRoot() ?? document.body,
      view.NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const element = node.parentElement
          if (element == null ||
            element.closest('.findbar') != null ||
            element.closest('datalist, input, option, optgroup, script, select, style, template, textarea') != null ||
            element.closest('[aria-hidden="true"]') != null) {
            return view.NodeFilter.FILTER_REJECT
          }

          const style = view.getComputedStyle(element)
          return style.display === 'none' || style.visibility === 'hidden'
            ? view.NodeFilter.FILTER_REJECT
            : view.NodeFilter.FILTER_ACCEPT
        },
      }
    )

    while (walker.nextNode()) {
      const node = walker.currentNode
      const normalizedText = (node.textContent ?? '').toLocaleLowerCase()
      let index = normalizedText.indexOf(normalizedQuery)
      while (index !== -1) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + normalizedQuery.length)
        matches.push(range)
        index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length)
      }
    }

    const highlight = new view.Highlight(...matches)
    highlight.priority = 0
    view.CSS.highlights.set('findbarmatch', highlight)
    select(matches.length > 0 ? 0 : -1)
  }

  /** @param {number} index */
  function select(index) {
    if (matches.length === 0) {
      selectedIndex = -1
      onMatchChange(0, 0)
      return
    }

    selectedIndex = (index + matches.length) % matches.length
    const currentMatch = matches[selectedIndex]
    const currentHighlight = new view.Highlight(currentMatch)
    currentHighlight.priority = 1
    view.CSS.highlights.set('findbarmatchcurrent', currentHighlight)

    const rect = currentMatch.getBoundingClientRect()
    if (rect.width !== 0 || rect.height !== 0) {
      view.scrollBy({
        top: rect.top + rect.height / 2 - view.innerHeight / 2,
        behavior: 'smooth',
      })
    }
    onMatchChange(selectedIndex + 1, matches.length)
  }

  /** @param {string} query @param {boolean | Event | null} [backwards] */
  function find(query, backwards = null) {
    if (query.trim().length === 0) {
      clear()
    } else if (typeof backwards !== 'boolean' || matches.length === 0) {
      search(query)
    } else {
      select(selectedIndex + (backwards ? -1 : 1))
    }
  }

  return { clear, search, select, find }
}
