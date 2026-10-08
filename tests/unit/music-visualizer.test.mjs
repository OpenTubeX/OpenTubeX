import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useMusicVisualizer.js', import.meta.url), 'utf8')

async function createVisualizer() {
  const document = new EventTarget()
  document.documentElement = { dataset: {} }
  let hidden = false
  let mount
  let unmount
  let mutation
  const watchers = new Map()
  const frames = new Map()
  const contexts = []
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop() { this.readyState = 'ended' } })
  const stream = Object.assign(new EventTarget(), { getAudioTracks: () => [track], getTracks: () => [track] })
  const video = { value: Object.assign(new EventTarget(), { paused: false, captureStream: () => stream }) }
  const active = { value: true }
  class AudioContext extends EventTarget {
    state = 'running'
    suspends = 0
    constructor() { super(); contexts.push(this) }
    createMediaStreamSource() { return { connect() {}, disconnect() {} } }
    createAnalyser() { return { frequencyBinCount: 128, disconnect() {} } }
    async suspend() { this.suspends++; this.state = 'suspended' }
    async resume() { this.state = 'running' }
    async close() { this.state = 'closed' }
  }
  const useMusicVisualizer = vm.runInNewContext(`${source.replace(/^import .*$/gm, '').replace('export ', '')}; useMusicVisualizer`, {
    document, window: { devicePixelRatio: 1 }, AudioContext, Uint8Array, console,
    isAppHidden: () => hidden,
    ref: value => ({ value }),
    watch: (target, callback) => watchers.set(target, callback),
    nextTick: callback => Promise.resolve().then(callback),
    onMounted: callback => { mount = callback },
    onBeforeUnmount: callback => { unmount = callback },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { constructor(callback) { mutation = callback } observe() {} disconnect() {} },
    requestAnimationFrame: callback => { const id = frames.size + 1; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
  })
  useMusicVisualizer({ active, video, sourceKey: () => 'mp3' })
  mount()
  await setImmediate()
  return {
    contexts, frames, video,
    async setHidden(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); await setImmediate() },
    async setPaused(value) { video.value.paused = value; video.value.dispatchEvent(new Event(value ? 'pause' : 'play')); await setImmediate() },
    async setActive(value) { active.value = value; watchers.get(active)(value); await setImmediate() },
    async setReducedMotion(value) { document.documentElement.dataset.reducedMotion = value; mutation(); await setImmediate() },
    async dispose() { unmount(); await setImmediate() },
  }
}

test('hiding and showing a playing MP3 stops drawing without suspending its audio graph', async () => {
  const visualizer = await createVisualizer()
  const [context] = visualizer.contexts
  assert.equal(visualizer.frames.size, 1)
  for (let cycle = 0; cycle < 3; cycle++) {
    await visualizer.setHidden(true)
    assert.equal(visualizer.frames.size, 0)
    assert.equal(context.state, 'running')
    await visualizer.setHidden(false)
    assert.equal(visualizer.frames.size, 1)
  }
  assert.equal(context.suspends, 0)
  assert.equal(visualizer.contexts.length, 1)
  await visualizer.dispose()
  assert.equal(context.state, 'closed')
})

test('disabling drawing or reducing motion does not interrupt playing audio', async () => {
  const visualizer = await createVisualizer()
  const [context] = visualizer.contexts
  await visualizer.setActive(false)
  assert.equal(visualizer.frames.size, 0)
  assert.equal(context.state, 'running')
  await visualizer.setActive(true)
  await visualizer.setReducedMotion('reduce')
  assert.equal(visualizer.frames.size, 0)
  assert.equal(context.state, 'running')
  await visualizer.setReducedMotion('no-preference')
  assert.equal(visualizer.frames.size, 1)
  await visualizer.dispose()
})

test('pausing hidden playback suspends analysis and resuming restores it', async () => {
  const visualizer = await createVisualizer()
  const [context] = visualizer.contexts
  await visualizer.setHidden(true)
  await visualizer.setPaused(true)
  assert.equal(context.state, 'suspended')
  await visualizer.setPaused(false)
  assert.equal(context.state, 'running')
  assert.equal(visualizer.frames.size, 0)
  await visualizer.setHidden(false)
  assert.equal(visualizer.frames.size, 1)
  await visualizer.dispose()
})

test('hidden playback resumes analysis when an earlier suspension completes late', async () => {
  const visualizer = await createVisualizer()
  const [context] = visualizer.contexts
  let completeSuspension
  const suspension = new Promise(resolve => { completeSuspension = resolve })
  context.suspend = async () => {
    context.suspends++
    await suspension
    context.state = 'suspended'
    context.dispatchEvent(new Event('statechange'))
  }
  await visualizer.setHidden(true)
  await visualizer.setPaused(true)
  assert.equal(context.suspends, 1)
  assert.equal(context.state, 'running')
  await visualizer.setPaused(false)
  completeSuspension()
  await setImmediate()
  assert.equal(context.state, 'running')
  assert.equal(visualizer.frames.size, 0)
  await visualizer.dispose()
})

test('pausing hidden playback suspends analysis after a pending resume completes', async () => {
  const visualizer = await createVisualizer()
  const [context] = visualizer.contexts
  await visualizer.setHidden(true)
  await visualizer.setPaused(true)
  let completeResume
  const resume = new Promise(resolve => { completeResume = resolve })
  context.resume = async () => {
    await resume
    context.state = 'running'
    context.dispatchEvent(new Event('statechange'))
  }
  await visualizer.setPaused(false)
  await visualizer.setPaused(true)
  completeResume()
  await setImmediate()
  assert.equal(context.state, 'suspended')
  assert.equal(visualizer.frames.size, 0)
  await visualizer.dispose()
})
