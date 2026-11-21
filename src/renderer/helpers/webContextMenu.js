import { usesInvidiousInstance } from '../../apiBackends'
import { SEARCH_CHAR_LIMIT } from '../../constants'
import { buildSearchUrl, parseSearchEngines } from '../../searchEngines'
import store from '../store/index'
import { collapseSeparators } from './menuSeparators'
import { truncateSelectionForLabel } from './selectionLabel'
import { isShareableOpenTubeXRoute, transformOpenTubeXRouteUrl } from './share'
import { copyToClipboard } from './utils'

// Email and number inputs hide their selection from scripts, so they keep the browser's menu
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password'])
const TIMESTAMP_PATTERN = /(\d{1,2}:)*\d{1,2}:\d{2}/

/**
 * @param {Element} target
 * @returns {HTMLInputElement | HTMLTextAreaElement | HTMLElement | null}
 */
function getEditable(target) {
  const editable = target.closest('input, textarea, [contenteditable]')
  if (editable instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(editable.type) ? editable : null
  if (editable instanceof HTMLTextAreaElement) return editable
  return editable instanceof HTMLElement && editable.isContentEditable ? editable : null
}

/**
 * @param {HTMLElement | null} editable
 */
function getSelectionText(editable) {
  if ((editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) && editable.selectionStart !== null) {
    return editable.value.slice(editable.selectionStart, editable.selectionEnd ?? editable.selectionStart)
  }

  return window.getSelection()?.toString() ?? ''
}

/**
 * Whatever identifies the editable's selection, to tell whether it changed
 * @param {HTMLElement} editable
 */
function getSelectionState(editable) {
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    return [editable.value, editable.selectionStart, editable.selectionEnd]
  }

  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  return [editable.textContent, range?.startContainer, range?.startOffset, range?.endContainer, range?.endOffset]
}

/**
 * @param {string} key
 * @param {string} fallback
 * @param {() => unknown} run
 * @param {{ labelParameters?: Record<string, string | number>, enabled?: boolean }} [options]
 */
function menuItem(key, fallback, run, { labelParameters, enabled = true } = {}) {
  return { type: 'normal', label: fallback, labelKey: key, labelParameters, enabled, run }
}

/** @param {string} url */
function openInNewTab(url) {
  window.open(url, '_blank', 'noopener')
}

/**
 * @param {string} selection
 */
function createExternalSearchItem(selection) {
  const engines = parseSearchEngines(store.getters.getContextMenuSearchEngines).filter(engine => engine.enabled)
  const search = engine => () => openInNewTab(buildSearchUrl(engine.url, selection))
  if (engines.length === 1) {
    return {
      ...menuItem('Context Menu.Search With', `Search with ${engines[0].name}`, search(engines[0]), { labelParameters: { engine: engines[0].name } }),
      faviconSource: engines[0].url
    }
  }

  return engines.length > 1 && {
    type: 'normal',
    label: 'Search with...',
    labelKey: 'Context Menu.Search With Multiple',
    enabled: true,
    submenu: engines.map(engine => ({ type: 'normal', label: engine.name, enabled: true, faviconSource: engine.url, run: search(engine) }))
  }
}

/**
 * Builds the web version's context menu, which replaces the browser's menu.
 * Electron builds the same entries in the main process.
 * @param {Element} target
 * @param {{ ignoreLinks?: boolean }} [options] `ignoreLinks` leaves link
 *   commands to menus that provide their own
 */
export function getWebContextMenuItems(target, { ignoreLinks = false } = {}) {
  const appUrl = window.location.href.split('#')[0]
  const editable = getEditable(target)
  const isEditable = editable !== null && !editable.matches(':disabled, [readonly]')
  const link = ignoreLinks ? null : target.closest('a[href]')
  const linkUrl = link instanceof HTMLAnchorElement ? link.href : ''
  const linkText = link?.textContent?.trim() ?? ''
  const [linkBase, linkRoute] = linkUrl.split('#')
  const isInAppUrl = linkUrl !== '' && linkBase === appUrl && linkRoute?.startsWith('/') === true
  // Like browsers, never copy or search a password
  const selectionText = editable instanceof HTMLInputElement && editable.type === 'password' ? '' : getSelectionText(editable)
  const trimmedSelection = selectionText.trim()
  const hasSelection = selectionText.length > 0
  const searchable = trimmedSelection.length <= SEARCH_CHAR_LIMIT
  const selectionLabel = truncateSelectionForLabel(trimmedSelection)
  const selectionState = isEditable ? getSelectionState(editable) : []

  const items = [
    isInAppUrl && menuItem('Context Menu.Open in a New Tab', 'Open in a New Tab', () => openInNewTab(linkUrl)),
    isEditable && menuItem('Context Menu.Select All', 'Select All', () => {
      if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
        editable.select()
      } else {
        window.getSelection()?.selectAllChildren(editable)
      }
    }),
    isEditable && menuItem('Cut', 'Cut', async () => {
      if (!await copyToClipboard(selectionText)) return
      // Skip the deletion if the text or selection changed while copying
      if (getSelectionState(editable).every((value, index) => value === selectionState[index])) {
        editable.focus()
        // Unlike changing the value, this keeps the undo history and fires input events
        document.execCommand('delete')
      }
    }, { enabled: hasSelection }),
    (isEditable || hasSelection) && menuItem('Copy', 'Copy', () => copyToClipboard(selectionText), { enabled: hasSelection }),
    isEditable && menuItem('Paste', 'Paste', async () => {
      try {
        const text = await navigator.clipboard.readText()
        editable.focus()
        document.execCommand('insertText', false, text)
      } catch (error) {
        console.error('Failed to paste from the clipboard:', error)
      }
    }, { enabled: window.isSecureContext && typeof navigator.clipboard?.readText === 'function' }),
    { type: 'separator' },
    linkUrl !== '' && !isInAppUrl && menuItem('Context Menu.Copy Link', 'Copy Link', () => copyToClipboard(linkUrl)),
    isInAppUrl && isShareableOpenTubeXRoute(linkRoute) &&
      menuItem('Context Menu.Copy YouTube Link', 'Copy YouTube Link', () => copyToClipboard(transformOpenTubeXRouteUrl(linkRoute, true))),
    isInAppUrl && isShareableOpenTubeXRoute(linkRoute) &&
      usesInvidiousInstance(store.getters.getBackendPreference, store.getters.getBackendFallback) &&
      menuItem('Context Menu.Copy Invidious Link', 'Copy Invidious Link', () => copyToClipboard(transformOpenTubeXRouteUrl(linkRoute, false))),
    trimmedSelection.length > 0 && !isInAppUrl && !isEditable && !linkUrl.includes(selectionText) && !TIMESTAMP_PATTERN.test(linkText) && (searchable
      ? menuItem(
          'Context Menu.Search Selection in New Tab',
          `Search "${selectionLabel}" in a New Tab`,
          () => openInNewTab(`${appUrl}#/search/${encodeURIComponent(trimmedSelection)}`),
          { labelParameters: { selection: selectionLabel } }
        )
      : menuItem(
          'Context Menu.Selection Too Long',
          `"${selectionLabel}" is too long for search (> ${SEARCH_CHAR_LIMIT} chars)`,
          () => {},
          { labelParameters: { count: SEARCH_CHAR_LIMIT }, enabled: false }
        )),
    trimmedSelection.length > 0 && createExternalSearchItem(trimmedSelection)
  ].filter(Boolean)

  return collapseSeparators(items)
}
