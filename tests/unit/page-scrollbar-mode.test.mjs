import assert from 'node:assert/strict'
import test from 'node:test'

import { observePageScrollbarHeaders } from '../../src/renderer/helpers/pageScrollbar.js'

function harness() {
  const events = new EventTarget()
  let resize
  let frame
  let observed = new Set()
  const insets = []
  const pageWindow = {
    innerHeight: 660.25,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    getComputedStyle: element => ({ visibility: element.visibility ?? 'visible' }),
    requestAnimationFrame: callback => { frame = callback; return 1 },
    cancelAnimationFrame: () => { frame = null },
    ResizeObserver: class {
      constructor(callback) { resize = callback }
      observe(element) { observed.add(element) }
      unobserve(element) { observed.delete(element) }
      disconnect() { observed.clear() }
    }
  }
  const observer = observePageScrollbarHeaders(inset => insets.push(inset), pageWindow)
  return {
    observer, insets, pageWindow,
    flush() { const callback = frame; frame = null; callback?.() },
    resize: () => resize(),
    scroll: () => events.dispatchEvent(new Event('scroll')),
    observed: () => observed.size
  }
}

function header(bottom, height = 60) {
  return {
    bottom, height, isConnected: true,
    getBoundingClientRect() { return { bottom: this.bottom, height: this.height } }
  }
}

test('page track starts below all visible headers, preserving fractional zoom geometry', () => {
  const h = harness()
  const navigation = header(60.25)
  const feed = header(297.375, 237.125)
  h.observer.observe(navigation)
  h.observer.observe(feed)
  h.flush()
  assert.deepEqual(h.insets, [297.375])

  // A sticky header moves to its inset when the document scrolls.
  feed.bottom = 294.125
  h.scroll()
  h.flush()
  assert.equal(h.insets.at(-1), 294.125)
  h.scroll()
  h.flush()
  assert.equal(h.insets.length, 2, 'stable scrolls do not rewrite scrollbar styles')
  h.observer.destroy()
})

test('wrapped, collapsed and hidden headers resize the available track', () => {
  const h = harness()
  const navigation = header(60)
  const feed = header(400, 340)
  h.observer.observe(navigation)
  h.observer.observe(feed)
  h.flush()
  feed.bottom = 200.5
  h.resize()
  h.flush()
  assert.equal(h.insets.at(-1), 200.5)
  feed.height = 0
  h.resize()
  h.flush()
  assert.equal(h.insets.at(-1), 60)
  feed.height = 140.5
  feed.visibility = 'hidden'
  h.scroll()
  h.flush()
  assert.equal(h.insets.at(-1), 60)
  h.observer.destroy()
})

test('cached route headers stop contributing while detached and return on activation', () => {
  const h = harness()
  const navigation = header(60)
  const feed = header(300, 240)
  h.observer.observe(navigation)
  h.observer.observe(feed)
  h.flush()
  feed.isConnected = false
  h.resize()
  h.flush()
  assert.equal(h.insets.at(-1), 60)
  feed.isConnected = true
  h.resize()
  h.flush()
  assert.equal(h.insets.at(-1), 300)
  h.observer.unobserve(feed)
  h.flush()
  assert.equal(h.insets.at(-1), 60)
  assert.equal(h.observed(), 1)
  h.observer.destroy()
  assert.equal(h.observed(), 0)
})

test('a header taller than the viewport leaves no negative track height', () => {
  const h = harness()
  h.observer.observe(header(900, 840))
  h.flush()
  assert.equal(h.insets.at(-1), 660.25)
  h.observer.destroy()
  h.scroll()
  h.flush()
  assert.equal(h.insets.length, 1)
})
