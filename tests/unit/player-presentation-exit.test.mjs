import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function exitPresentationModes() {')
const exitSource = source.slice(start, source.indexOf('\n    /**', start))

function createExit({ native = true, active = true, eventBeforePromise = false } = {}) {
  const document = Object.assign(new EventTarget(), { fullscreenElement: native && active ? {} : null })
  const isFullscreen = { value: native && active }
  const fullWindowEnabled = { value: !native && active }
  const calls = []
  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = false
    calls.push('close docks')
  })
  const exit = vm.runInNewContext(`${exitSource}\nexitPresentationModes`, {
    document, isFullscreen, fullWindowEnabled,
    ui: { getControls: () => ({
      isFullScreenEnabled: () => isFullscreen.value || fullWindowEnabled.value,
      async toggleFullScreen() {
        calls.push('toggle')
        document.fullscreenElement = null
        if (!native) fullWindowEnabled.value = false
        else if (eventBeforePromise) document.dispatchEvent(new Event('fullscreenchange'))
      }
    }) },
    nextTick: async () => { calls.push('render') },
    fullWindowAnimation: { cancel: () => calls.push('cancel animation') },
    console,
  })
  return { exit, document, calls }
}

test('presentation exit waits for dock cleanup when fullscreenchange follows the exit promise', async () => {
  const { exit, document, calls } = createExit()
  let finished = false
  const navigation = exit().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false, 'navigation must wait for fullscreenchange')
  assert.deepEqual(calls, ['toggle'])
  document.dispatchEvent(new Event('fullscreenchange'))
  await navigation
  assert.deepEqual(calls, ['toggle', 'close docks', 'render', 'cancel animation'])
})

test('presentation exit does not wait again when fullscreenchange precedes the exit promise', { timeout: 1000 }, async () => {
  const { exit, calls } = createExit({ eventBeforePromise: true })
  await exit()
  assert.deepEqual(calls, ['toggle', 'close docks', 'render', 'cancel animation'])
})

test('app-owned full-window exit does not wait for a native fullscreen event', { timeout: 1000 }, async () => {
  const { exit, calls } = createExit({ native: false })
  await exit()
  assert.deepEqual(calls, ['toggle', 'render', 'cancel animation'])
})

test('inactive presentation is not toggled into fullscreen', { timeout: 1000 }, async () => {
  const { exit, calls } = createExit({ active: false })
  await exit()
  assert.deepEqual(calls, ['render', 'cancel animation'])
})
