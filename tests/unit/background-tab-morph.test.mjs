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

for (const canceled of [false, true]) {
  test(`the thumbnail copy follows tab geometry and is removed when ${canceled ? 'canceled' : 'finished'}`, async () => {
    let finish
    let cancel
    const finished = new Promise((resolve, reject) => { finish = resolve; cancel = reject })
    let keyframes
    let removed = false
    let appended = false
    const image = {
      style: {},
      removeAttribute() {},
      setAttribute() {},
      animate(frames) { keyframes = frames; return { finished } },
      remove() { removed = true }
    }
    class Element {
      querySelector() { return this }
      currentSrc = 'cached-thumbnail'
      getBoundingClientRect() { return { x: 200.5, y: 300.5, width: 320, height: 180 } }
      cloneNode() { return image }
    }
    const context = vm.createContext({
      HTMLElement: Element,
      document: {
        body: { append(element) { assert.equal(element, image); appended = true } },
        querySelector(selector) {
          assert.equal(selector, '.tab[data-tab-id="new-tab"]')
          return { getBoundingClientRect: () => ({ x: 20.5, y: 40.5, width: 160, height: 45 }) }
        }
      },
      CSS: { escape: value => value },
      isReducedMotionEnabled: () => false,
      nextTick: () => Promise.resolve()
    })
    vm.runInContext(source, context)
    await context.morphThumbnailIntoNewTab(new Element(), async () => ({ id: 'new-tab' }))
    assert.equal(appended, true)
    assert.equal(image.src, 'cached-thumbnail')
    assert.deepEqual(image.style, { left: '200.5px', top: '300.5px', width: '320px', height: '180px' })
    assert.equal(keyframes[1].transform, 'translate(-180px, -260px) scale(0.5, 0.25)')
    assert.equal(removed, false)
    if (canceled) cancel(new Error('Canceled'))
    else finish()
    await Promise.resolve()
    assert.equal(removed, true)
  })
}

test('reduced motion opens the tab without measuring or cloning the thumbnail', async () => {
  class Element {
    querySelector() { throw new Error('Reduced motion needs no thumbnail') }
  }
  const context = vm.createContext({ HTMLElement: Element, isReducedMotionEnabled: () => true })
  vm.runInContext(source, context)
  let created = 0
  await context.morphThumbnailIntoNewTab(new Element(), async () => { created++; return { id: 'new-tab' } })
  assert.equal(created, 1)
})
