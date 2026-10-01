import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url), 'utf8')
const row = source.match(/<div\s+v-for="tab in tabs"[\s\S]*?<\/div>/)[0]
const render = compile(row)

for (const [name, historyLength, presented, selecting, visible] of [
  ['empty history', 0, true, false, false],
  ['only the current page', 1, true, false, false],
  ['navigation history', 2, true, false, true],
  ['background tab', 2, false, false, false],
  ['tab selection', 2, true, true, false],
]) {
  test(`mobile tab history button: ${name}`, async () => {
    const app = createSSRApp({
      render,
      data: () => ({
        tabs: [{ id: 'tab', history: Array.from({ length: historyLength }, () => ({})) }],
        activeTabId: 'tab', presentedTabId: presented ? 'tab' : 'other', selecting,
        selectedTabIds: new Set(),
        drag: {}, swipe: {}, dragSettling: false, suppressDragTransition: false,
        tabCardStyle: () => ({}), tabAriaLabel: () => 'Tab', tabTitle: () => 'Tab', t: key => key,
        startTabGesture() {}, moveTabGesture() {}, finishTabGesture() {}, cancelTabGesture() {},
        preventHoldScroll() {}, handleTabContextMenu() {}, activateTab() {}, handleTabTargetKeydown() {},
        toggleTabSelection() {}, closeTab() {}, openTabHistory() {},
      }),
    })
    app.component('FtIcon', { render: () => null })
    app.component('CapacitorTabPreview', { render: () => null })
    const html = await renderToString(app)
    assert.equal(html.includes('class="capacitorPhoneTabHistoryButton"'), visible)
    assert.equal(/class="[^"]*\bwithHistory\b/.test(html), visible, 'the close button only reserves space when history is shown')
  })
}
