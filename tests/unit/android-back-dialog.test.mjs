import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { nextTick } from 'vue'
import { settleAndroidBackAnimation } from '../../src/renderer/helpers/androidBackGesture.js'

const source = readFileSync(new URL('../../src/renderer/helpers/androidBackDialog.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')

function fixture({ reducedMotion = false, busy = false, closes = true, rejects = false, deferredFrames = false } = {}) {
  let available = true
  let backs = 0
  const properties = new Map([['transition', ['opacity 100ms', '']]])
  const animations = []
  const frames = []
  const element = {
    isConnected: true, scrollTop: 150.5,
    querySelector: () => busy ? {} : null,
    style: {
      getPropertyValue: name => properties.get(name)?.[0] ?? '',
      getPropertyPriority: name => properties.get(name)?.[1] ?? '',
      setProperty: (name, value, priority) => properties.set(name, [value, priority]),
      removeProperty: name => properties.delete(name),
    },
    animate(frames, options) {
      const animation = {
        frames, effect: { getTiming: () => options }, currentTime: 0,
        playState: 'running', finished: Promise.resolve(),
        pause() { this.playState = 'paused' },
        play() { this.playState = 'running' },
        reverseCalls: 0,
        reverse() { this.reverseCalls++; this.playState = 'running' },
        cancel() { this.playState = 'idle' },
      }
      animations.push(animation)
      return animation
    },
  }
  const create = vm.runInNewContext(`${source}; createAndroidBackDialogPreview`, {
    nextTick, settleAndroidBackAnimation, applyAnimationSpeed: animation => animation,
    requestAnimationFrame: callback => deferredFrames ? frames.push(callback) : queueMicrotask(callback),
    isReducedMotionEnabled: () => reducedMotion,
    getComputedStyle: () => ({ transform: 'none', opacity: '1' }),
  })
  const preview = create(element, async () => {
    backs++
    if (rejects) throw new Error('Back failed')
    if (closes) element.isConnected = false
  }, () => element.isConnected && available)
  return { preview, element, animations, properties, frames, backs: () => backs, replaceLayer: () => { available = false } }
}

test('commit keeps the finished effect until Vue applies its leave state across two frames', async () => {
  const f = fixture({ closes: false, deferredFrames: true })
  f.preview.begin()
  const finished = f.preview.finish(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.backs(), 1)
  assert.notEqual(f.animations[0].playState, 'idle', 'the connected modal must not flash back to its base styles')
  f.frames.shift()()
  assert.notEqual(f.animations[0].playState, 'idle')
  // Vue removes the element when its leave-to classes take effect in this frame.
  f.element.isConnected = false
  f.frames.shift()()
  await finished
  assert.equal(f.animations[0].playState, 'idle')
  assert.deepEqual(f.properties.get('transition'), ['opacity 100ms', ''])
})

for (const progress of [0, 0.001]) {
  test(`cancelling after returning to progress ${progress} does not restart the preview`, async () => {
    const f = fixture()
    f.preview.begin()
    f.preview.update(0.6)
    f.preview.update(progress)
    await f.preview.finish(false)
    assert.equal(f.animations[0].reverseCalls, progress === 0 ? 0 : 1)
    assert.equal(f.animations[0].playState, 'idle')
    assert.equal(f.backs(), 0)
    assert.deepEqual(f.properties.get('transition'), ['opacity 100ms', ''])
  })
}

for (const commit of [false, true]) {
  test(`modal progress ${commit ? 'commits its existing Back action' : 'cancels without dismissing'}`, async () => {
    const f = fixture()
    assert.equal(f.preview.begin(), true)
    f.preview.update(0.6)
    const animation = f.animations[0]
    assert.equal(animation.playState, 'paused')
    assert.equal(animation.currentTime, 108)
    assert.equal(f.backs(), 0)
    assert.equal(f.element.scrollTop, 150.5)
    assert.deepEqual(f.properties.get('transition'), ['none', 'important'])
    await f.preview.finish(commit)
    assert.equal(f.backs(), commit ? 1 : 0)
    assert.equal(f.element.isConnected, !commit)
    assert.equal(animation.playState, 'idle')
    assert.deepEqual(f.properties.get('transition'), ['opacity 100ms', ''])
    assert.equal(f.element.scrollTop, 150.5)
  })
}

test('nested Back restores the surviving dialog after changing its view', async () => {
  const f = fixture({ closes: false })
  f.preview.begin()
  await f.preview.finish(true)
  assert.equal(f.backs(), 1)
  assert.equal(f.element.isConnected, true)
  assert.equal(f.animations[0].playState, 'idle')
  assert.equal(f.preview.begin(), true)
  f.preview.cancel()
})

test('a replaced layer or cancelled preview cannot dismiss a different dialog', async () => {
  for (const cancel of [true, false]) {
    const f = fixture()
    f.preview.begin()
    if (cancel) f.preview.cancel()
    else f.replaceLayer()
    await f.preview.finish(true)
    assert.equal(f.backs(), 0)
    assert.equal(f.animations[0].playState, 'idle')
    assert.deepEqual(f.properties.get('transition'), ['opacity 100ms', ''])
  }
})

for (const options of [{ reducedMotion: true }, { busy: true }]) {
  test(`ordinary Back handles dialogs with ${JSON.stringify(options)}`, () => {
    const f = fixture(options)
    assert.equal(f.preview.begin(), false)
    assert.equal(f.animations.length, 0)
  })
}

test('a failed Back action still restores the dialog animation and styles', async () => {
  const f = fixture({ rejects: true })
  f.preview.begin()
  await assert.rejects(f.preview.finish(true), /Back failed/)
  assert.equal(f.animations[0].playState, 'idle')
  assert.deepEqual(f.properties.get('transition'), ['opacity 100ms', ''])
})
