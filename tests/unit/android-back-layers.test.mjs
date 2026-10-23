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
    currentTime: 0, playState: 'paused', finished: Promise.resolve(),
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

test('the page preview shrinks only its visible part into a card', () => {
  const getKeyframes = appFunction('getAndroidBackPageKeyframes', { window: { innerWidth: 400, innerHeight: 800 } })
  const [from, to] = getKeyframes({ getBoundingClientRect: () => ({ top: -1000, left: 0, bottom: 3000, right: 400, width: 400, height: 4000 }) })
  assert.equal(from.clipPath, 'inset(1000px 0px 2200px 0px round 0px)')
  assert.equal(to.clipPath, 'inset(1000px 0px 2200px 0px round 32px)')
  assert.equal(to.transformOrigin, '200px 1400px', 'the card shrinks around the viewport center')
})

function bottomSheet({ canDismissOnBack, onDismiss = () => {} } = {}) {
  const previews = []
  const backdrop = { style: {}, animate: () => animation() }
  const element = {
    style: {}, parentElement: backdrop,
    animate: () => animation(),
  }
  backdrop.querySelector = () => element
  const sheet = ref(null)
  let dismissed = 0
  const useBottomSheetDismiss = vm.runInNewContext(`${sheetSource}; useBottomSheetDismiss`, {
    process: { env: { IS_CAPACITOR: true } }, watch, nextTick, onBeforeUnmount() {}, settleAndroidBackAnimation,
    applyAnimationSpeed: animation => animation, isReducedMotionEnabled: () => false,
    registerAndroidBackSheet: (_element, preview) => { previews.push(preview); return () => {} },
    getComputedStyle: () => ({ transform: 'none' }),
    window: { removeEventListener() {} },
  })
  const sheetApi = useBottomSheetDismiss(sheet, () => { dismissed++; onDismiss() }, { canDismissOnBack })
  sheet.value = element
  return { sheetApi, previews, element, backdrop, dismissed: () => dismissed }
}

test('a committed bottom sheet preview closes without replaying the leave animation', async () => {
  let done = false
  // Vue calls the leave hook while rendering the dismissed state.
  const f = bottomSheet({ onDismiss: () => nextTick(() => f.sheetApi.leave(f.backdrop, () => { done = true })) })
  await nextTick()
  const [preview] = f.previews
  assert.equal(preview.begin(), true)
  preview.update(0.7)
  await preview.finish(true)
  assert.equal(f.dismissed(), 1)
  assert.equal(done, true)
  assert.equal(f.element.style.transform, 'translateY(100%)')
  assert.equal(f.backdrop.style.opacity, '0')
})

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

test('the settings window preview follows its close morph and closes without replaying it', async () => {
  const morphSource = readFileSync(new URL('../../src/renderer/helpers/utilityWindowMorph.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  const button = { getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 300, top: 10, width: 40, height: 40 }) }
  const morph = vm.runInNewContext(`${morphSource}; ({ getSettingsWindowIconButton, getUtilityWindowCloseKeyframes })`, {
    document: { querySelector: selector => selector === '[data-settings-window-icon="downloads"]' ? button : null },
    getComputedStyle: () => ({ transform: 'none', opacity: '1' }),
  })
  const settingsWindow = {
    isConnected: true,
    matches: selector => selector === '.settingsWindow',
    hasAttribute: () => false,
    closest: selector => selector.includes('.settingsWindow') ? settingsWindow : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  }
  const dispatched = []
  const store = { getters: { getSettingsWindowView: 'downloads', getSettingsWindowMorphing: true }, dispatch: action => dispatched.push(action) }
  let created = null
  const getPreview = appFunction('getAndroidBackPreview', {
    ...morph,
    mobileContextLink: { value: null },
    mobileContextActions: { value: null },
    isSideNavBackTarget: () => false,
    getAndroidBackTarget: () => settingsWindow,
    getAndroidBackSheet: () => null,
    getAndroidBackPopup: () => null,
    handleAndroidBack: () => dispatched.push('Escape'),
    store,
    createAndroidBackDialogPreview: (element, back, isAvailable, getKeyframes) => {
      created = { element, back, isAvailable, getKeyframes }
      return created
    },
  })
  assert.equal(getPreview(), null, 'ordinary Back waits for an opening morph before closing')
  store.getters.getSettingsWindowMorphing = false
  assert.equal(getPreview(), created)
  assert.equal(created.element, settingsWindow)
  assert.equal(created.isAvailable(), true)
  const [from, to] = created.getKeyframes(settingsWindow)
  assert.deepEqual({ ...from }, { transform: 'none', opacity: '1' })
  assert.deepEqual({ ...to }, { transform: 'translate(120px, -370px) scale(0.1)', opacity: 0 })
  await created.back()
  assert.deepEqual(dispatched, ['hideSettingsWindow'], 'Escape would morph the window into its button again')
})
