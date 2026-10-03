import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { compile, createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const menuSource = await readFile(new URL('../../src/renderer/components/TabBar/CapacitorTabActionsMenu.vue', import.meta.url), 'utf8')
const row = source.match(/<div\s+v-for="tab in tabs"[\s\S]*?<\/div>/)[0]
const menu = source.match(/<CapacitorTabActionsMenu[\s\S]*?\/>/)[0]
const historyButton = menuSource.match(/<button\s+v-if="showHistory"[\s\S]*?<\/button>/)[0]
const render = compile(`<div>${row}${menu}</div>`)

for (const [name, historyLength, presented, selecting, visible] of [
  ['empty history', 0, true, false, false],
  ['only the current page', 1, true, false, false],
  ['navigation history', 2, true, false, true],
  ['background tab', 2, false, false, false],
  ['tab selection', 2, true, true, false],
]) {
  test(`mobile tab history menu action: ${name}`, async () => {
    const tab = { id: 'tab', history: Array.from({ length: historyLength }, () => ({})) }
    const app = createSSRApp({
      render,
      data: () => ({
        tabs: [tab], actionTab: tab,
        actionTabYoutubeUrl: null, canToggleActionTabLoaded: true,
        relatedTabIds: { before: [], after: [], other: [] },
        activeTabId: 'tab', presentedTabId: presented ? 'tab' : 'other', selecting,
        selectedTabIds: new Set(),
        drag: {}, swipe: {}, dragSettling: false, suppressDragTransition: false,
        tabCardStyle: () => ({}), tabAriaLabel: () => 'Tab', tabTitle: () => 'Tab', t: key => key,
        startTabGesture() {}, moveTabGesture() {}, finishTabGesture() {}, cancelTabGesture() {},
        preventHoldScroll() {}, handleTabContextMenu() {}, activateTab() {}, handleTabTargetKeydown() {},
        toggleTabSelection() {}, closeTab() {}, openTabHistory() {},
        selectActionTab() {}, closeRelatedTabs() {}, closeActionTab() {}, copyActionTabYoutubeLink() {},
        closeTabActions() {}, duplicateActionTab() {}, reloadActionTab() {},
        toggleActionTabLoaded() {}, toggleActionTabPinned() {},
      }),
    })
    app.component('FtIcon', { render: () => null })
    app.component('CapacitorTabPreview', { render: () => null })
    app.component('CapacitorTabActionsMenu', {
      props: ['showHistory'],
      render: compile(historyButton),
      data: () => ({ t: key => key, emit() {} }),
    })
    const html = await renderToString(app)
    assert.equal(html.includes('capacitorPhoneTabHistoryButton'), false, 'cards have no history control')
    assert.equal(/class="[^"]*\bwithHistory\b/.test(html), false, 'history does not reserve a footer row')
    assert.equal(html.includes('Tab Organizer.Tab History'), visible)
    if (visible) assert.match(html, /role="menuitem"/)
  })
}

test('returning from tab history restores focus to the active card without scrolling', async () => {
  const start = source.indexOf('async function selectView(')
  let focused = false
  const context = vm.createContext({
    clearSelection() {},
    activeView: { value: 'history' },
    activeScrollRef: () => ({ scrollTop: 0 }),
    viewScrollTop: { open: 120, history: 0 },
    stopObservingContent() {},
    nextTick: async () => {},
    restoreOverlayScrollTop(_element, offset) { assert.equal(offset, 120) },
    observeActiveContent() {},
    showSyncedTabsView: { value: true },
    dialogRef: { value: { querySelector: selector => selector === '.capacitorPhoneTabTarget[aria-selected="true"]'
      ? { focus(options) { assert.equal(options.preventScroll, true); focused = true } }
      : { focus() { assert.fail('Focus must return to the card rather than the Open tabs header') } } } },
  })
  vm.runInContext(source.slice(start, source.indexOf('function activeScrollRef()', start)), context)
  const focusStart = source.indexOf('function focusActiveTab()')
  vm.runInContext(source.slice(focusStart, source.indexOf('function handleDialogKeydown(', focusStart)), context)
  await context.selectView('open', true)
  assert.equal(focused, true)
})
