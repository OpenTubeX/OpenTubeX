import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { vFirstVisible } from '../../src/renderer/helpers/firstVisible.js'

const observers = []
globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback
    this.observed = new Set()
    observers.push(this)
  }

  observe(element) { this.observed.add(element) }
  unobserve(element) { this.observed.delete(element) }
  disconnect() { this.observed.clear() }
}

test('lazy rows share one observer and stop observing after their first intersection', () => {
  const rows = Array.from({ length: 500 }, () => ({}))
  const shown = []
  rows.forEach((row, index) => vFirstVisible.mounted(row, { value: () => shown.push(index) }))

  assert.equal(observers.length, 1)
  const [observer] = observers
  assert.equal(observer.observed.size, 500)

  observer.callback([
    { target: rows[0], isIntersecting: true },
    { target: rows[1], isIntersecting: false }
  ])
  observer.callback([{ target: rows[0], isIntersecting: true }])
  assert.deepEqual(shown, [0])
  assert.equal(observer.observed.has(rows[0]), false)
  assert.equal(observer.observed.has(rows[1]), true)

  vFirstVisible.updated(rows[1], { value: false })
  vFirstVisible.unmounted(rows[2])
  assert.equal(observer.observed.size, 497)
})

test('prewarmed swipe neighbors pause their animations', () => {
  const tabContent = readFileSync(new URL('../../src/renderer/components/TabContent/TabContent.vue', import.meta.url), 'utf8')
  assert.match(tabContent, /\.pageSwipePrewarm :deep\(\*\)[^{]*\{\s*animation-play-state: paused !important;/)
})
