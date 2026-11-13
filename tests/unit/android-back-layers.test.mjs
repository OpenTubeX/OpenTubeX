import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick, ref, watch } from 'vue'
import { settleAndroidBackAnimation } from '../../src/renderer/helpers/androidBackGesture.js'

const appSource = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const sheetSource = readFileSync(new URL('../../src/renderer/composables/useBottomSheetDismiss.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')

function appFunction(name, context = {}) {
  const start = appSource.indexOf(`function ${name}(`)
  const end = appSource.indexOf('\n}\n', start) + 2
  return vm.runInNewContext(`${appSource.slice(start, end)}\n${name}`, context)
}

function animation() {
  return {
    currentTime: 0,
    playState: 'paused',
    finished: Promise.resolve(),
    pause() { this.playState = 'paused' },
    play() { this.playState = 'finished' },
    reverse() { this.playState = 'finished' },
    cancel() { this.playState = 'idle' },
  }
}

test('a declined player preview falls back to the next preview for the whole gesture', async () => {
  const combine = appFunction('combineAndroidBackPreviews')
  const calls = []
  const preview = (name, available) => ({
    begin: () => { calls.push(`${name}:begin`); return available },
    update: progress => calls.push(`${name}:${progress}`),
    finish: async commit => calls.push(`${name}:${commit}`),
    cancel: () => calls.push(`${name}:cancel`),
  })
  const combined = combine([preview('player', false), null, preview('page', true)])
  assert.equal(combined.begin(), true)
  combined.update(0.5)
  await combined.finish(true)
  assert.deepEqual(calls, ['player:begin', 'page:begin', 'page:0.5', 'page:true'])
  assert.equal(combine([preview('player', false)]).begin(), false)
})

test('only popups close on Back, not panels controlled by expanded disclosure buttons', () => {
  const elements = new Map()
  const element = (role, attributes = {}) => ({
    matches: selector => selector.split(', ').some(part => part === `[role="${role}"]`),
    closest: selector => selector.includes('aria-expanded') && attributes.controls ? { getAttribute: () => attributes.controls } : null,
  })
  elements.set('menu', element('menu'))
  elements.set('panel', element('region'))
  const getPopup = appFunction('getAndroidBackPopup', { document: { getElementById: id => elements.get(id) } })
  assert.equal(getPopup(element(null, { controls: 'menu' })), elements.get('menu'))
  assert.equal(getPopup(element(null, { controls: 'panel' })), null)
  const scoped = { closest: selector => selector.includes('data-settings-escape-scope') ? 'picker' : null }
  assert.equal(getPopup(scoped), 'picker')
})

function bottomSheet({ canDismissOnBack, onDismiss = () => {} } = {}) {
  const previews = []
  const backdrop = { style: {}, animate: () => animation() }
  const element = {
    style: {},
    parentElement: backdrop,
    animate: () => animation(),
  }
  backdrop.querySelector = () => element
  const sheet = ref(null)
  let dismissed = 0
  const useBottomSheetDismiss = vm.runInNewContext(`${sheetSource}; useBottomSheetDismiss`, {
    process: { env: { IS_CAPACITOR: true } },
    watch,
    nextTick,
    onBeforeUnmount() {},
    settleAndroidBackAnimation,
    applyAnimationSpeed: animation => animation,
    isReducedMotionEnabled: () => false,
    registerAndroidBackSheet: (_element, preview) => { previews.push(preview); return () => {} },
    getComputedStyle: () => ({ transform: 'none' }),
    window: { removeEventListener() {} },
  })
  const sheetApi = useBottomSheetDismiss(sheet, () => { dismissed++; onDismiss() }, { canDismissOnBack })
  sheet.value = element
  return { sheetApi, previews, element, backdrop, dismissed: () => dismissed }
}

test('a bottom sheet keeps its ordinary Back while it would return to a parent submenu', async () => {
  const submenu = { open: true }
  const f = bottomSheet({ canDismissOnBack: () => !submenu.open })
  await nextTick()
  assert.equal(f.previews[0].begin(), false)
  submenu.open = false
  assert.equal(f.previews[0].begin(), true)
  await f.previews[0].finish(false)
  assert.equal(f.dismissed(), 0)
})

test('Back targets a focused popup inside a prompt before the prompt itself', () => {
  const picker = {}
  const prompt = { contains: element => element === picker }
  const document = {
    activeElement: picker,
    querySelector: () => null,
    querySelectorAll: selector => selector.startsWith('.prompt') ? [prompt] : [],
  }
  const getTarget = appFunction('getAndroidBackTarget', { document, settingsWindowOpen: { value: false }, HTMLElement: Object })
  assert.equal(getTarget(), picker)
  document.activeElement = {}
  assert.equal(getTarget(), prompt)
})

test('Back targets a color picker teleported out of settings before the settings window', () => {
  const settingsWindow = { contains: () => false }
  const field = {}
  const popover = { contains: element => element === field }
  const document = {
    activeElement: field,
    querySelector: selector => selector === '.colorPickerPopover' ? popover : selector === '.settingsWindow' ? settingsWindow : null,
    querySelectorAll: () => [],
  }
  const getTarget = appFunction('getAndroidBackTarget', { document, settingsWindowOpen: { value: true }, HTMLElement: Object })
  assert.equal(getTarget(), field)
  document.activeElement = {}
  assert.equal(getTarget(), popover, 'the picker closes even when focus stayed outside it')
  const getPopup = appFunction('getAndroidBackPopup', { document })
  assert.equal(getPopup({ closest: selector => selector.includes('.colorPickerPopover') ? popover : null }), popover)
})

test('Back closes a focused context menu as a popup', () => {
  const menu = {}
  const getPopup = appFunction('getAndroidBackPopup', { document: {} })
  assert.equal(getPopup({ closest: selector => selector.split(', ').includes('.contextMenu') ? menu : null }), menu)
})
