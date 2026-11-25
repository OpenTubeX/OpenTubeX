import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const app = readFileSync(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
const start = app.indexOf('function getAndroidBackTarget() {')
const source = app.slice(start, app.indexOf('\nasync function handleAndroidBack()', start))

for (const focusedInsideOverview of [false, true]) {
  test(`Android Back prioritizes the tab overview and preserves ${focusedInsideOverview ? 'nested action focus' : 'background search'}`, () => {
    class Element {}
    const focused = new Element()
    const overview = new Element()
    overview.contains = element => focusedInsideOverview && element === focused
    const search = new Element()
    search.contains = element => !focusedInsideOverview && element === focused
    const getTarget = vm.runInNewContext(`${source}\ngetAndroidBackTarget`, {
      HTMLElement: Element,
      settingsWindowOpen: { value: false },
      document: {
        activeElement: focused,
        querySelectorAll: () => [],
        querySelector: selector => ({
          '.capacitorPhoneTabDialog': overview,
          '.topNav.phoneSearchOpen': search,
        })[selector] ?? null,
      },
    })
    assert.equal(getTarget(), focusedInsideOverview ? focused : overview)
  })
}
