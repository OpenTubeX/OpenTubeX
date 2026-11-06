import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/FtInput/FtInput.vue', import.meta.url), 'utf8')
const handler = source.match(/function handleOutsideTouch\(event\) \{[\s\S]*?\n\}/)?.[0] ?? 'function handleOutsideTouch() {}'

for (const [name, type, inside, focused, dismissed] of [
  ['player tap clears focus even with stale list hover', 'touch', false, true, true],
  ['suggestion tap retains focus until selection', 'touch', true, true, false],
  ['mouse retains normal focus behavior', 'mouse', false, true, false],
  ['unfocused fields do not steal focus', 'touch', false, false, false],
]) {
  test(name, () => {
    let blurred = false
    const input = { closest: () => ({ contains: () => inside }), blur: () => { blurred = true } }
    const state = { isPointerInList: true, showOptions: true }
    const context = vm.createContext({ inputRef: { value: input }, document: { activeElement: focused ? input : null }, searchState: state })
    vm.runInContext(handler, context)
    context.handleOutsideTouch({ pointerType: type, target: {} })
    assert.equal(blurred, dismissed)
    assert.equal(state.showOptions, !dismissed)
  })
}

test('outside touch survives scrollbar focus restoration without focus events', () => {
  const listeners = new Set()
  const document = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    dispatchEvent: event => [...listeners].forEach(listener => listener(event)),
  }
  let blurred = 0
  let cleanup
  const input = {
    closest: () => ({ contains: () => false }),
    blur: () => { blurred++; document.activeElement = null },
  }
  document.activeElement = input
  const context = vm.createContext({
    document, inputRef: { value: input }, inputData: { value: '' },
    searchState: { isPointerInList: false, showOptions: true },
    process: { env: { IS_IOS: true } }, emit() {},
    onMounted: fn => fn(), onBeforeUnmount: fn => { cleanup = fn },
  })
  const focus = source.match(/function handleFocus\(\) \{[\s\S]*?\n\}/)[0]
  const blur = source.match(/function handleInputBlur\(\) \{[\s\S]*?\n\}/)[0]
  const mounted = source.match(/onMounted\(\(\) => \{\n  if \(process.env.IS_IOS\)[\s\S]*?\n\}\)/)?.[0] ?? ''
  const unmounted = source.match(/onBeforeUnmount\(\(\) => \{\n  if \(process.env.IS_IOS\)[\s\S]*?\n\}\)/)[0]
  vm.runInContext([handler, focus, blur, mounted, unmounted].join('\n'), context)
  context.handleFocus()
  // OverlayScrollbars can restore activeElement while suppressing focus events.
  context.handleInputBlur()
  document.activeElement = input
  document.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch' }))
  assert.equal(blurred, 1)
  cleanup()
  document.activeElement = input
  document.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType: 'touch' }))
  assert.equal(blurred, 1, 'unmounted inputs must remove their listener')
})
