import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref } from 'vue'

function frameHarness() {
  const frames = new Map()
  let id = 0
  return {
    frames,
    requestAnimationFrame(callback) { frames.set(++id, callback); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
    async flush() {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) await callback()
    }
  }
}

function colorPicker() {
  const source = readFileSync(new URL('../../src/renderer/components/FtColorPicker/FtColorPicker.vue', import.meta.url), 'utf8')
  const frames = frameHarness()
  const calls = { reads: 0, colors: 0, changes: 0 }
  const surface = {
    getBoundingClientRect() {
      calls.reads++
      return { left: 10.5, top: 20.25, width: 200.5, height: 100.25 }
    }
  }
  const saturation = ref(0)
  const value = ref(0)
  const listeners = new Map()
  const window = {
    addEventListener(type, callback) { listeners.set(type, callback) },
    removeEventListener(type) { listeners.delete(type) },
    dispatchEvent(event) { listeners.get(event.type)?.(event) }
  }
  const declarations = source.match(/^let saturationValue\w* = .*$/gm).join('\n')
  const methods = source.slice(source.indexOf('function startSaturationValue('), source.indexOf('function adjustSaturationValue('))
  const api = vm.runInNewContext(`${declarations}\n${methods}\n({ startSaturationValue, updateSaturationValue, stopSaturationValue, cancelSaturationValue })`, {
    ...frames, saturation, value,
    saturationValueRef: { value: surface },
    clamp: (number, min, max) => Math.min(max, Math.max(min, number)),
    emitCurrentColor() { calls.colors++ },
    emit() { calls.changes++ },
    window
  })
  const event = (clientX, clientY, pointerId = 7, type = 'pointermove') => ({ button: 0, clientX, clientY, pointerId, type, preventDefault() {} })
  api.startSaturationValue(event(10.5, 20.25))
  Object.assign(calls, { reads: 0, colors: 0, changes: 0 })
  return { api, calls, frames, saturation, value, event, window, listeners }
}

test('color picker coalesces pointer bursts into one geometry read and color update', async () => {
  const harness = colorPicker()
  for (let index = 0; index < 50; index++) {
    harness.api.updateSaturationValue(harness.event(50 + index, 45))
  }
  await harness.frames.flush()
  console.log('Color picker pointer burst:', harness.calls)
  assert.equal(harness.calls.reads, 1)
  assert.equal(harness.calls.colors, 1)
  assert.ok(Math.abs(harness.saturation.value - (99 - 10.5) / 200.5 * 100) < 0.001)
  harness.api.cancelSaturationValue()
})

test('color picker flushes the release position before change and cancels pending work', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.api.stopSaturationValue(harness.event(211, 120.5))
  assert.equal(harness.saturation.value, 100)
  assert.equal(harness.value.value, 0)
  assert.equal(harness.calls.changes, 1)
  assert.equal(harness.frames.frames.size, 0)
  const colors = harness.calls.colors
  await harness.frames.flush()
  assert.equal(harness.calls.colors, colors)
})

test('closing a color picker discards pending previews without emitting a change', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.api.cancelSaturationValue()
  harness.api.stopSaturationValue(harness.event(211, 120.5))
  await harness.frames.flush()
  assert.deepEqual(harness.calls, { reads: 0, colors: 0, changes: 0 })
  assert.equal(harness.frames.frames.size, 0)
})

test('a second pointer cannot start another color drag', async () => {
  const harness = colorPicker()
  harness.api.startSaturationValue(harness.event(211, 120.5, 8, 'pointerdown'))
  assert.deepEqual(harness.calls, { reads: 0, colors: 0, changes: 0 })
  harness.api.cancelSaturationValue()
})

test('unrelated pointer moves and releases cannot update or commit a color drag', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.api.updateSaturationValue(harness.event(211, 120.5, 8))
  harness.api.stopSaturationValue(harness.event(211, 120.5, 8, 'pointerup'))
  harness.api.stopSaturationValue(harness.event(211, 120.5, 8, 'pointercancel'))
  assert.equal(harness.calls.changes, 0)
  await harness.frames.flush()
  assert.ok(Math.abs(harness.saturation.value - (50 - 10.5) / 200.5 * 100) < 0.001)
  harness.api.stopSaturationValue(harness.event(50, 45, 7, 'pointerup'))
  assert.equal(harness.calls.changes, 1)
})

test('canceling a color drag discards queued work without committing', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.api.stopSaturationValue(harness.event(0, 0, 7, 'pointercancel'))
  await harness.frames.flush()
  assert.deepEqual(harness.calls, { reads: 0, colors: 0, changes: 0 })
  assert.equal(harness.frames.frames.size, 0)
  harness.api.stopSaturationValue(harness.event(211, 120.5, 7, 'pointerup'))
  assert.equal(harness.calls.changes, 0)
})

test('a new press from the same pointer recovers a missed release', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.api.startSaturationValue(harness.event(211, 120.5, 7, 'pointerdown'))
  assert.equal(harness.saturation.value, 100)
  assert.equal(harness.value.value, 0)
  assert.equal(harness.frames.frames.size, 0)
  await harness.frames.flush()
  assert.equal(harness.calls.changes, 0)
  harness.api.stopSaturationValue(harness.event(211, 120.5, 7, 'pointerup'))
  assert.equal(harness.calls.changes, 1)
  assert.equal(harness.listeners.size, 0)
})

test('losing window focus discards the drag and allows a new pointer', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  harness.window.dispatchEvent({ type: 'blur' })
  await harness.frames.flush()
  assert.deepEqual(harness.calls, { reads: 0, colors: 0, changes: 0 })
  assert.equal(harness.listeners.size, 0)
  harness.api.startSaturationValue(harness.event(211, 120.5, 8, 'pointerdown'))
  assert.equal(harness.saturation.value, 100)
  harness.api.cancelSaturationValue()
})

test('stationary color picker pointers do not emit redundant theme updates', async () => {
  const harness = colorPicker()
  harness.api.updateSaturationValue(harness.event(50, 45))
  await harness.frames.flush()
  harness.api.updateSaturationValue(harness.event(50, 45))
  await harness.frames.flush()
  assert.equal(harness.calls.colors, 1)
  harness.api.cancelSaturationValue()
})

test('playlist preview measures one pointer position per frame and uses the latest index', async () => {
  const source = readFileSync(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')
  const frames = frameHarness()
  const calls = { barReads: 0, boundaryReads: 0, widthReads: 0, styleWrites: 0 }
  const boundary = { getBoundingClientRect() { calls.boundaryReads++; return { left: 0, right: 300.5, width: 300.5 } } }
  const bar = {
    getBoundingClientRect() { calls.barReads++; return { left: 10.5, width: 200.5 } },
    closest: () => boundary
  }
  const preview = {
    style: { setProperty() { calls.styleWrites++ } },
    get offsetWidth() { calls.widthReads++; return 100 }
  }
  const previewVideoIndex = ref(1)
  const previewPositionPixels = ref(0)
  const showProgressBarPreview = ref(true)
  const declarations = source.match(/^let preview\w* = .*$/gm).join('\n')
  const method = source.slice(source.indexOf('function updateProgressBarPreview('), source.indexOf('function handleProgressBarClick('))
  const api = vm.runInNewContext(`${declarations}\n${method}\n;({ updateProgressBarPreview })`, {
    ...frames, nextTick: async () => {}, watch() {}, onBeforeUnmount() {},
    playlistProgressBar: { value: bar }, progressBarPreview: { value: preview },
    previewVideoIndex, previewPositionPixels, showProgressBarPreview,
    playlistVideoCount: ref(100)
  })
  for (let index = 0; index < 50; index++) api.updateProgressBarPreview({ clientX: 50 + index })
  await frames.flush()
  console.log('Playlist preview pointer burst:', calls)
  assert.equal(calls.barReads, 1)
  assert.equal(calls.boundaryReads, 1)
  assert.equal(calls.widthReads, 1)
  assert.equal(previewVideoIndex.value, 45)
  assert.equal(previewPositionPixels.value, 38.5)
  api.updateProgressBarPreview({ clientX: 200 })
  showProgressBarPreview.value = false
  await frames.flush()
  assert.equal(calls.barReads, 1, 'hidden previews discard queued measurements')
})
