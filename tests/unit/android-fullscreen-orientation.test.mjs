import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { attachAndroidMediaElement } from '../../src/renderer/helpers/player/androidMediaElement.js'
import { shouldRotateFullscreenToLandscape } from '../../src/renderer/helpers/capacitorUi.js'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const template = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')

for (const [label, width, height, active, fullscreen, enabled, fromRotation, expected] of [
  ['late landscape dimensions', 1920, 1080, true, true, true, false, true],
  ['late portrait dimensions', 1080, 1920, true, true, true, false, false],
  ['inline playback', 1920, 1080, true, false, true, false, null],
  ['inactive tab', 1920, 1080, false, true, true, false, null],
  ['disabled rotation', 1920, 1080, true, true, false, false, false],
  ['sensor fullscreen', 1920, 1080, true, true, true, true, false],
]) {
  test(`fullscreen orientation follows ${label} after canplay`, () => {
    const rotations = []
    const element = Object.assign(new EventTarget(), {
      style: {}, volume: 1, muted: false, playbackRate: 1, pause() {},
    })
    const media = attachAndroidMediaElement(element, {
      command: async () => {}, load: async () => {}, onError: error => { throw error },
    })
    // Android may become ready before ExoPlayer reports its video size.
    media.update({ ready: true, width: 0, height: 0 })
    const handlerName = template.match(/@resize="(\w+)"/)?.[1]
    assert.ok(handlerName, 'Video dimension changes must recheck fullscreen orientation')
    const start = source.indexOf(`    function ${handlerName}(`)
    const body = source.slice(start, source.indexOf('\n    }', start) + 6)
    const handler = vm.runInNewContext(`${body}\n${handlerName}`, {
      video: { value: element }, isActiveTab: { value: active },
      isNativeFullscreenActive: () => fullscreen,
      rotateFullscreenToLandscape: { value: enabled },
      player: { nativePlayback: { isFullscreenFromRotation: () => fromRotation } },
      setFullscreenOrientation: async (...args) => rotations.push(shouldRotateFullscreenToLandscape(...args)),
      updateAnnotationVideoAspectRatio() {}, updateScrollMiniVideoAspectRatio() {}, updateScrollMiniPlayer() {},
    })
    element.addEventListener('resize', handler)
    media.update({ width, height })
    assert.deepEqual(rotations, expected === null ? [] : [expected])
    media.detach()
  })
}

for (const electron of [false, true]) {
  test(`${electron ? 'Electron' : 'Android'} restores fullscreen after the replacement player loads`, async () => {
    const calls = []
    const start = source.indexOf('    function applyPendingPresentationModes(')
    const body = source.slice(start, source.indexOf('\n    }', start) + 6)
    const context = vm.createContext({
      startInFullscreen: true, restoringNativeFullscreen: false, startInFullwindow: false, startInPip: false,
      isActiveTab: { value: false }, hasLoaded: { value: false },
      ui: {}, player: { nativePlayback: electron ? undefined : { show: async () => calls.push('native'), isScreenOpen: () => true } },
      process: { env: { IS_ELECTRON: electron } },
      window: { ftElectron: { requestFullscreen: () => calls.push('electron') } },
      tabId: 'watch', console,
    })
    const restore = vm.runInContext(`${body}\napplyPendingPresentationModes`, context)
    restore()
    context.isActiveTab.value = true
    restore()
    assert.deepEqual(calls, [])
    context.hasLoaded.value = true
    restore()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, [electron ? 'electron' : 'native'])
    restore()
    assert.equal(calls.length, 1, 'canplay must not enter fullscreen again')
  })
}

test('Android retries fullscreen restoration when the native controller was not ready', async () => {
  const start = source.indexOf('    function applyPendingPresentationModes(')
  const body = source.slice(start, source.indexOf('\n    }', start) + 6)
  let ready = false
  let open = false
  let attempts = 0
  const context = vm.createContext({
    startInFullscreen: true, restoringNativeFullscreen: false, startInFullwindow: false, startInPip: false,
    isActiveTab: { value: true }, hasLoaded: { value: true }, ui: {},
    player: { nativePlayback: {
      async show() { attempts++; open = ready },
      isScreenOpen: () => open,
    } },
    process: { env: { IS_ELECTRON: false } }, console,
  })
  const restore = vm.runInContext(`${body}\napplyPendingPresentationModes`, context)
  restore()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.startInFullscreen, true, 'A no-op show must retain the pending request')
  ready = true
  restore()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(open, true)
  assert.equal(context.startInFullscreen, false)
  restore()
  assert.equal(attempts, 2)
})

test('repeated ready events wait for the same native fullscreen restoration', async () => {
  const apply = source.slice(source.indexOf('    function applyPendingPresentationModes()'), source.indexOf('    function handleCanPlay()'))
  let resolveShow
  let calls = 0
  const context = vm.createContext({
    isActiveTab: { value: true }, ui: {}, startInFullwindow: false, startInPip: false,
    startInFullscreen: true, restoringNativeFullscreen: false, hasLoaded: { value: true },
    process: { env: { IS_ELECTRON: false } }, console,
    player: { nativePlayback: {
      show() { calls++; return new Promise(resolve => { resolveShow = resolve }) },
      isScreenOpen: () => true,
    } },
  })
  vm.runInContext(apply, context)
  context.applyPendingPresentationModes()
  context.applyPendingPresentationModes()
  assert.equal(calls, 1)
  assert.equal(context.startInFullscreen, true)
  resolveShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(context.startInFullscreen, false)
  assert.equal(context.restoringNativeFullscreen, false)
})
