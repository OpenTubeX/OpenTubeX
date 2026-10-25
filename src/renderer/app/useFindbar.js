import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { KeyboardShortcuts } from '../../constants'
import { matchesKeyboardShortcut } from '../helpers/keyboardShortcuts'
import { tabRuntimeRegistry } from '../tabs/TabRuntimeRegistry'

const isElectron = process.env.IS_ELECTRON

/**
 * Find in page for the presented tab. Matches are painted with the CSS Custom
 * Highlight API, and Electron restores each tab's find bar when it is
 * presented again.
 *
 * @param {{
 *   presentedTabId: import('vue').ComputedRef<string | null>,
 *   t: (key: string) => string
 * }} options
 */
export function useFindbar({ presentedTabId, t }) {
  const findbarVisible = ref(false)
  const findbarQuery = ref('')
  const findbarMatchIndex = ref(0)
  const findbarMatchCount = ref(0)
  const findbarInputRef = useTemplateRef('findbarInputRef')
  let findbarMatches = []
  const findbarStateByTabId = new Map()

  const findbarStatus = computed(() => {
    if (findbarQuery.value.trim().length === 0) {
      return ''
    }

    if (findbarMatchCount.value === 0) {
      return t('No matches')
    }

    return `${findbarMatchIndex.value}/${findbarMatchCount.value}`
  })

  watch(presentedTabId, async (tabId, previousTabId) => {
    if (!isElectron || tabId === previousTabId) {
      return
    }

    if (previousTabId) {
      findbarStateByTabId.set(previousTabId, {
        visible: findbarVisible.value,
        query: findbarQuery.value,
        matchIndex: Math.max(0, findbarMatchIndex.value - 1)
      })
    }

    clearFindbarHighlights()
    const state = findbarStateByTabId.get(tabId) ?? {
      visible: false,
      query: '',
      matchIndex: 0
    }
    findbarVisible.value = state.visible
    findbarQuery.value = state.query
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0

    if (state.visible && state.query.trim().length > 0) {
      await nextTick()
      highlightFindbarMatches(state.query.trim())
      selectFindbarMatch(state.matchIndex)
    }
  })

  /**
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  function handleFindbarNavigationShortcut(event) {
    const shortcuts = KeyboardShortcuts.APP.GENERAL
    const isNextShortcut = [
      shortcuts.FIND_NEXT,
      shortcuts.FIND_NEXT_ALT,
    ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
    const isPreviousShortcut = [
      shortcuts.FIND_PREVIOUS,
      shortcuts.FIND_PREVIOUS_ALT,
    ].some(shortcut => matchesKeyboardShortcut(event, shortcut))

    if (!isNextShortcut && !isPreviousShortcut) {
      return false
    }

    event.preventDefault()
    findInPage(isPreviousShortcut)
    return true
  }

  function openFindbar() {
    findbarVisible.value = true

    const selection = window.getSelection()?.toString().trim()
    if (selection) {
      findbarQuery.value = selection
    }

    nextTick(() => {
      findbarInputRef.value?.focus()
      findbarInputRef.value?.select()
      findInPage()
    })
  }

  function closeFindbar() {
    findbarVisible.value = false
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0
    clearFindbarHighlights()
  }

  /**
   * @param {boolean | Event} [backwards]
   */
  function findInPage(backwards = null) {
    const query = findbarQuery.value.trim()
    if (query.length === 0) {
      findbarMatchIndex.value = 0
      findbarMatchCount.value = 0
      clearFindbarHighlights()
      return
    }

    const input = findbarInputRef.value
    const selectionStart = input?.selectionStart ?? query.length
    const selectionEnd = input?.selectionEnd ?? query.length
    const isNavigation = typeof backwards === 'boolean'
    const direction = backwards === true ? -1 : 1

    if (!isNavigation || findbarMatches.length === 0) {
      highlightFindbarMatches(query)
    } else {
      selectFindbarMatch(findbarMatchIndex.value - 1 + direction)
    }

    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  /**
   * @param {string} query
   */
  function highlightFindbarMatches(query) {
    clearFindbarHighlights()

    const walker = document.createTreeWalker(
      tabRuntimeRegistry.getRoot(presentedTabId.value) ?? document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (
            isFindbarTextNode(node) ||
            isNonSearchableTextNode(node) ||
            isHiddenTextNode(node)
          ) {
            return NodeFilter.FILTER_REJECT
          }

          return NodeFilter.FILTER_ACCEPT
        }
      }
    )
    const normalizedQuery = query.toLocaleLowerCase()
    const ranges = []

    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent ?? ''
      const normalizedText = text.toLocaleLowerCase()
      let index = normalizedText.indexOf(normalizedQuery)

      while (index !== -1) {
        ranges.push({
          node,
          start: index,
          end: index + normalizedQuery.length
        })
        index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length)
      }
    }

    const matches = ranges.map((rangeInfo) => {
      const range = document.createRange()
      range.setStart(rangeInfo.node, rangeInfo.start)
      range.setEnd(rangeInfo.node, rangeInfo.end)
      return range
    })

    findbarMatches = matches
    findbarMatchCount.value = matches.length
    paintFindbarHighlights()
    selectFindbarMatch(matches.length > 0 ? 0 : -1)
  }

  function clearFindbarHighlights() {
    window.CSS.highlights.delete('findbarmatch')
    window.CSS.highlights.delete('findbarmatchcurrent')
    findbarMatches = []
  }

  function paintFindbarHighlights() {
    const highlight = new window.Highlight(...findbarMatches)
    highlight.priority = 0
    window.CSS.highlights.set('findbarmatch', highlight)
  }

  /**
   * @param {number} index
   */
  function selectFindbarMatch(index) {
    const matches = findbarMatches
    if (matches.length === 0) {
      findbarMatchIndex.value = 0
      findbarMatchCount.value = 0
      return
    }

    const nextIndex = (index + matches.length) % matches.length
    const currentMatch = matches[nextIndex]
    const currentHighlight = new window.Highlight(currentMatch)
    currentHighlight.priority = 1

    window.CSS.highlights.set('findbarmatchcurrent', currentHighlight)
    scrollFindbarMatchIntoView(currentMatch)

    findbarMatchIndex.value = nextIndex + 1
    findbarMatchCount.value = matches.length
  }

  /**
   * @param {Range} match
   */
  function scrollFindbarMatchIntoView(match) {
    const rect = match.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      return
    }

    const targetBlockCenter = rect.top + rect.height / 2
    const viewportBlockCenter = window.innerHeight / 2
    window.scrollBy({
      top: targetBlockCenter - viewportBlockCenter,
      behavior: 'smooth'
    })
  }

  /**
   * @param {Node} node
   * @returns {boolean}
   */
  function isFindbarTextNode(node) {
    return node.parentElement?.closest('.findbar') != null
  }

  /**
   * @param {Node} node
   * @returns {boolean}
   */
  function isNonSearchableTextNode(node) {
    return node.parentElement?.closest('datalist, input, option, optgroup, script, select, style, template, textarea') != null
  }

  /**
   * @param {Node} node
   * @returns {boolean}
   */
  function isHiddenTextNode(node) {
    const element = node.parentElement
    if (element == null) {
      return true
    }

    const style = window.getComputedStyle(element)
    return style.display === 'none' ||
      style.visibility === 'hidden' ||
      element.closest('[aria-hidden="true"]') != null
  }

  return {
    findbarVisible,
    findbarQuery,
    findbarStatus,
    openFindbar,
    closeFindbar,
    findInPage,
    handleFindbarNavigationShortcut
  }
}
