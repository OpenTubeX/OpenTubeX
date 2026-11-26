import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/viewTransitions.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

test('background tab creation starts before an animation can capture the document', async () => {
  class Element {
    style = {}
    querySelector() { return this }
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0 } }
  }
  const context = vm.createContext({
    HTMLElement: Element,
    HTMLImageElement: Element,
    applyAnimationSpeed: animation => animation,
    document: {
      documentElement: { classList: { add() {}, remove() {} } },
      startViewTransition() {
        throw new Error('Background tab creation must not wait for document snapshots')
      }
    },
    isReducedMotionEnabled: () => false,
    nextTick: () => Promise.resolve()
  })
  vm.runInContext(source, context)
  let created = 0
  const opening = context.morphThumbnailIntoNewTab(new Element(), async () => {
    created++
    return null
  })
  const immediatelyCreated = created
  await opening
  assert.equal(immediatelyCreated, 1)
})

test('reduced motion opens the tab without measuring or cloning the thumbnail', async () => {
  class Element {
    querySelector() { throw new Error('Reduced motion needs no thumbnail') }
  }
  const context = vm.createContext({ HTMLElement: Element, HTMLImageElement: Element, isReducedMotionEnabled: () => true })
  vm.runInContext(source, context)
  let created = 0
  await context.morphThumbnailIntoNewTab(new Element(), async () => { created++; return { id: 'new-tab' } })
  assert.equal(created, 1)
})

test('a router navigation replaced while its morph destination loads starts no morph', async () => {
  let started = 0
  const hooks = {}
  const thumbnail = { style: { viewTransitionName: 'video-morph' } }
  let finishLoad
  const context = vm.createContext({
    HTMLElement: class {},
    document: {
      documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
      startViewTransition() { started++ }
    },
    isReducedMotionEnabled: () => false,
    nextTick: () => Promise.resolve(),
    setTimeout,
    clearTimeout
  })
  vm.runInContext(source, context)
  context.installViewTransitions({
    beforeEach: callback => { hooks.beforeEach = callback },
    beforeResolve: callback => { hooks.beforeResolve = callback }
  }, { preloadRoute: () => new Promise(resolve => { finishLoad = resolve }) })
  context.requestWatchPageViewTransition(null)
  context.thumbnail = thumbnail
  vm.runInContext('morphSourceElement = thumbnail', context)
  hooks.beforeEach()
  const guard = hooks.beforeResolve({ fullPath: '/watch/first' })
  // Another navigation starts while the first one loads Watch's code.
  hooks.beforeEach()
  finishLoad()
  await guard
  assert.equal(started, 0)
  assert.equal(thumbnail.style.viewTransitionName, '', 'the thumbnail gives up its shared name')
})
