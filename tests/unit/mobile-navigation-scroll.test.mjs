import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { createMobileNavigationScroll } from '../../src/renderer/helpers/mobileNavigationScroll.js'

test('hides downward and reveals upward after a small accumulated movement', () => {
  const nav = createMobileNavigationScroll()
  nav.reset(0)
  assert.equal(nav.update(4, 1000), false)
  assert.equal(nav.update(9, 1000), true)
  assert.equal(nav.update(200, 1000), true)
  assert.equal(nav.update(197.5, 1000), true)
  assert.equal(nav.update(191.5, 1000), false)
})

test('clamps overscroll, reveals at the top and resets after navigation', () => {
  const nav = createMobileNavigationScroll()
  nav.reset(0)
  assert.equal(nav.update(100, 100), true)
  assert.equal(nav.update(120, 100), true)
  assert.equal(nav.update(100, 100), true)
  assert.equal(nav.update(-10, 100), false)
  assert.equal(nav.update(0, 100), false)
  nav.update(80, 100)
  nav.reset(80)
  assert.equal(nav.update(80, 100), false)
  assert.equal(nav.update(90, 100), true)
  assert.equal(nav.update(0, 0), false)
})

test('a longer reveal threshold accumulates upward movement while retaining quick hiding and top reveal', () => {
  const header = createMobileNavigationScroll({ revealThreshold: 64 })
  header.reset(0)
  assert.equal(header.update(9, 1000), true)
  assert.equal(header.update(600, 1000), true)
  assert.equal(header.update(580, 1000), true)
  assert.equal(header.update(540, 1000), true)
  assert.equal(header.update(536, 1000), false)
  assert.equal(header.update(545, 1000), true)
  assert.equal(header.update(8, 1000), false)
  header.reset(600)
  assert.equal(header.update(600, 1000), false)
})

for (const hidden of [false, true]) {
  test(`minimize holds ${hidden ? 'hidden' : 'visible'} navigation through history scroll restoration`, async t => {
    const source = await readFile(new URL('../../src/renderer/components/SideNav/SideNav.vue', import.meta.url), 'utf8')
    const layout = source.slice(source.indexOf('const route = useRoute()'), source.indexOf('/** @type {import(\'vue\').Ref<Record'))
    const watchers = source.slice(source.indexOf('watch(() => route.fullPath'), source.indexOf('watch([\n  () => activeProfile'))
    const route = reactive({ fullPath: '/watch/video' })
    const preview = ref(null)
    const viewport = { scrollY: 0 }
    const nav = { querySelector: () => null }
    const frames = new Map()
    const scope = effectScope()
    t.after(() => scope.stop())
    const api = scope.run(() => vm.runInNewContext(`${layout}\n${watchers}\n;({ updateScrollLayout, updateScrollVisibility, scrollHidden })`, {
      requestAnimationFrame: callback => { frames.set(1, callback); return 1 },
      cancelAnimationFrame: id => frames.delete(id),
      computed, ref, watch, nextTick, useRoute: () => route,
      useTemplateRef: () => ref({ closest: () => nav }),
      store: { getters: { getAlwaysShowNavigationBar: false } },
      createMobileNavigationScroll, mobileNavigationMinimizePreview: preview,
      window: viewport, document: { scrollingElement: { scrollHeight: 3000, clientHeight: 800 } },
      getComputedStyle: () => ({ getPropertyValue: () => '1' }), updateIndicator() {}
    }))
    api.updateScrollLayout()
    if (hidden) { viewport.scrollY = 40; api.updateScrollVisibility() }
    preview.value = 'watch-tab'
    route.fullPath = '/subscriptions'
    await nextTick()
    assert.equal(api.scrollHidden.value, hidden, 'route handoff must preserve Watch visibility')
    viewport.scrollY = 1000
    api.updateScrollVisibility()
    assert.equal(api.scrollHidden.value, hidden, 'restored scroll must not change navigation')
    preview.value = null
    // Settling the bar can add its bottom padding and move the scroll anchor.
    viewport.scrollY = 1108
    await nextTick()
    viewport.scrollY = hidden ? 1000 : 1108
    api.updateScrollVisibility()
    frames.get(1)()
    api.updateScrollVisibility()
    assert.equal(api.scrollHidden.value, hidden, 'queued scroll event after handoff must not change navigation')
    viewport.scrollY += hidden ? -20 : 20
    api.updateScrollVisibility()
    assert.equal(api.scrollHidden.value, !hidden, 'user scrolling works again after handoff')
  })
}
