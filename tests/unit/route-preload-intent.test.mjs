import assert from 'node:assert/strict'
import test from 'node:test'
import { installRoutePreloadIntent, ROUTE_PRELOAD_INTENT_DELAY_MS } from '../../src/renderer/helpers/routePreloadIntent.js'

class FakeElement {
  constructor({ href = null, parent = null, focusVisible = false } = {}) {
    this.href = href
    this.parent = parent
    this.focusVisible = focusVisible
  }

  closest(selector) {
    assert.equal(selector, 'a[href^="#/"]')
    for (let element = this; element; element = element.parent) {
      if (element.href?.startsWith('#/')) return element
    }
    return null
  }

  getAttribute(name) {
    assert.equal(name, 'href')
    return this.href
  }

  matches(selector) {
    assert.equal(selector, ':focus-visible')
    return this.focusVisible
  }
}
globalThis.Element = FakeElement

function setup(t, preload = async () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const listeners = new Map()
  const target = {
    addEventListener: (type, listener, options) => {
      assert.deepEqual(options, { capture: true, passive: true })
      listeners.set(type, listener)
    },
    removeEventListener: type => listeners.delete(type)
  }
  const preloaded = []
  const remove = installRoutePreloadIntent({
    target,
    preload: (path) => {
      preloaded.push(path)
      return preload(path)
    }
  })
  const fire = (type, event = {}) => listeners.get(type)?.({ pointerType: 'mouse', ...event })
  const wait = (ms = ROUTE_PRELOAD_INTENT_DELAY_MS) => t.mock.timers.tick(ms)
  return { listeners, preloaded, remove, fire, wait }
}

const videoLink = new FakeElement({ href: '#/watch/abc?timestamp=5' })
const videoTitle = new FakeElement({ parent: videoLink })
const channelLink = new FakeElement({ href: '#/channel/UC123' })
const plainElement = new FakeElement()

test('loads the destination once the pointer rests on an internal link', (t) => {
  const { preloaded, fire, wait } = setup(t)

  fire('pointermove', { target: videoTitle })
  wait(ROUTE_PRELOAD_INTENT_DELAY_MS - 1)
  // Moving within the same link keeps the original intent.
  fire('pointermove', { target: videoLink })
  assert.deepEqual(preloaded, [])
  wait(1)
  assert.deepEqual(preloaded, ['/watch/abc?timestamp=5'])

  fire('pointermove', { target: videoTitle })
  wait()
  assert.deepEqual(preloaded, ['/watch/abc?timestamp=5'], 'resting longer does not load again')
})

test('ignores pointers passing over links and links outside the app', (t) => {
  const { preloaded, fire, wait } = setup(t)

  fire('pointermove', { target: videoLink })
  wait(ROUTE_PRELOAD_INTENT_DELAY_MS / 2)
  fire('pointermove', { target: channelLink })
  wait(ROUTE_PRELOAD_INTENT_DELAY_MS / 2)
  fire('pointermove', { target: plainElement })
  wait()
  fire('pointermove', { target: new FakeElement({ href: 'https://example.com/#/watch/abc' }) })
  wait()
  assert.deepEqual(preloaded, [])

  fire('pointermove', { target: channelLink })
  wait(ROUTE_PRELOAD_INTENT_DELAY_MS / 2)
  fire('pointerout', { target: channelLink, relatedTarget: null })
  wait()
  assert.deepEqual(preloaded, [], 'leaving the window cancels the intent')
})

test('ignores touch and stylus pointers', (t) => {
  const { preloaded, fire, wait } = setup(t)

  fire('pointermove', { target: videoLink, pointerType: 'touch' })
  wait()
  fire('pointermove', { target: videoLink, pointerType: 'pen' })
  wait()
  assert.deepEqual(preloaded, [])
})

test('scrolling and pressing the pointer cancel a pending intent', (t) => {
  const { preloaded, fire, wait } = setup(t)

  fire('pointermove', { target: videoLink })
  fire('scroll', { target: plainElement })
  wait()
  assert.deepEqual(preloaded, [])

  // The next real movement over the link starts a new intent.
  fire('pointermove', { target: videoLink })
  fire('pointerdown', { target: videoLink })
  wait()
  assert.deepEqual(preloaded, [])

  fire('pointermove', { target: videoLink })
  wait()
  assert.deepEqual(preloaded, ['/watch/abc?timestamp=5'])
})

test('loads the destination of a link that keeps keyboard focus', (t) => {
  const { preloaded, fire, wait } = setup(t)
  const focusedChannel = new FakeElement({ href: '#/channel/UC123', focusVisible: true })
  const focusedPlaylist = new FakeElement({ href: '#/playlist/PL1', focusVisible: true })

  // Clicking a link also focuses it, without showing focus.
  fire('focusin', { target: channelLink })
  wait()
  assert.deepEqual(preloaded, [])

  fire('focusin', { target: focusedChannel })
  wait(ROUTE_PRELOAD_INTENT_DELAY_MS / 2)
  fire('focusout', { target: focusedChannel })
  fire('focusin', { target: focusedPlaylist })
  wait()
  assert.deepEqual(preloaded, ['/playlist/PL1'])
})

test('focus moving elsewhere does not cancel a pointer intent', (t) => {
  const { preloaded, fire, wait } = setup(t)

  fire('pointermove', { target: videoLink })
  fire('focusin', { target: plainElement })
  fire('focusout', { target: plainElement })
  wait()
  assert.deepEqual(preloaded, ['/watch/abc?timestamp=5'])
})

test('failed preloads stay silent and a later intent tries again', async (t) => {
  let attempts = 0
  const { preloaded, fire, wait } = setup(t, () => {
    attempts++
    if (attempts === 1) throw new Error('synchronous failure')
    return Promise.reject(new Error('chunk failed'))
  })
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))

  fire('pointermove', { target: videoLink })
  wait()
  fire('pointermove', { target: plainElement })
  fire('pointermove', { target: videoLink })
  wait()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(preloaded.length, 2)
  assert.deepEqual(unhandled, [])
})

test('removing the handler cancels pending intents and listeners', (t) => {
  const { listeners, preloaded, remove, fire, wait } = setup(t)

  fire('pointermove', { target: videoLink })
  remove()
  wait()
  assert.deepEqual(preloaded, [])
  assert.equal(listeners.size, 0)
})
