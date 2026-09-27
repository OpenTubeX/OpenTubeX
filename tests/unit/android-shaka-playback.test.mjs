import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const template = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.vue', import.meta.url), 'utf8')

test('Android shows a thumbnail over the video while waiting for playback', () => {
  const poster = template.match(/<div\s+v-if="[^"]+"\s+class="countdownPoster"[\s\S]*?<\/div>/)?.[0]
  assert.ok(poster)
  const render = Vue.compile(poster)
  const context = {
    showCountdownOverlay: false,
    showAndroidPoster: true,
    audioPlayerMode: false,
    thumbnail: 'poster.jpg',
  }
  assert.equal(render(context).type, 'div')
  context.showAndroidPoster = false
  assert.equal(render(context).type, Vue.Comment)
})

test('Android registers the SABR scheme before Shaka loads its manifest', () => {
  const start = source.indexOf('    function ensureSabrStream() {')
  const end = source.indexOf('\n    ensureSabrStream()', start)
  assert.ok(start !== -1 && end !== -1)

  let registrations = 0
  const setupSabrScheme = () => {
    registrations++
    return { onBackoffRequested() {}, onReloadOnce() {} }
  }
  vm.runInNewContext(`${source.slice(start, end)}\nensureSabrStream()`, {
    process: { env: { IS_CAPACITOR: true, SUPPORTS_LOCAL_API: true } },
    sabrStream: null,
    props: { sabrData: { scheme: 'sabr1' } },
    setupSabrScheme,
    player: null,
    sabrManifest: null,
    playerWidth: { value: 0 },
    playerHeight: { value: 0 },
    AbortController,
  })
  assert.equal(registrations, 1)
})

test('Android phone uses the central Shaka play button without a duplicate in the bottom row', () => {
  const start = source.indexOf('      const controlPanelElements = [')
  const end = source.indexOf('\n      ]', start)
  assert.ok(start !== -1 && end !== -1)
  const expression = `${source.slice(start, end + '\n      ]'.length)}\ncontrolPanelElements`
  const controls = mobile => vm.runInNewContext(expression, {
    mobile,
    onlyUseOverFlowMenu: { value: true },
    props: { shortsPlayer: false, chapters: [] },
  })
  assert.equal(controls(true).includes('play_pause'), false)
  assert.equal(controls(true).includes('ft_skip_previous'), false)
  assert.equal(controls(true).includes('ft_skip_next'), false)
  assert.equal(controls(false).includes('play_pause'), true)
})

test('Android restores orientation if fullscreen entry fails after rotation starts', async () => {
  const start = source.indexOf('    function handleFullscreenButtonClick(event) {')
  const end = source.indexOf('\n    const mobileAdjustmentsVisible', start)
  assert.ok(start !== -1 && end !== -1)
  const calls = []
  let afterEntry
  const context = {
    process: { env: { IS_CAPACITOR: true, IS_IOS: false } },
    document: { fullscreenElement: null },
    fullscreenEntryAttempt: 0,
    isActiveTab: { value: true },
    isNativeFullscreenActive: () => false,
    setFullscreenOrientation: async fullscreen => { calls.push(fullscreen) },
    video: { value: { videoWidth: 0, videoHeight: 0 } },
    rotateFullscreenToLandscape: { value: true },
    fullscreenAspectRatio: { value: 16 / 9 },
    suppressPanelTransitions: () => {},
    handleScrollMiniFullscreenButtonClick: () => {},
    setTimeout: callback => { afterEntry = callback },
  }
  vm.runInNewContext(`${source.slice(start, end)}\nhandleFullscreenButtonClick({})`, context)
  await Promise.resolve()
  assert.deepEqual(calls, [true])
  assert.equal(typeof afterEntry, 'function')
  context.document.fullscreenElement = {}
  await afterEntry()
  assert.deepEqual(calls, [true])
  context.document.fullscreenElement = null
  await afterEntry()
  assert.deepEqual(calls, [true, false])
})

test('Android ignores fullscreen recovery from an earlier entry attempt', async () => {
  const start = source.indexOf('    function handleFullscreenButtonClick(event) {')
  const end = source.indexOf('\n    const mobileAdjustmentsVisible', start)
  assert.ok(start !== -1 && end !== -1)
  const calls = []
  const recoveryTimers = []
  const context = {
    process: { env: { IS_CAPACITOR: true, IS_IOS: false } },
    document: { fullscreenElement: null },
    fullscreenEntryAttempt: 0,
    isActiveTab: { value: true },
    isNativeFullscreenActive: () => false,
    setFullscreenOrientation: async fullscreen => { calls.push(fullscreen) },
    video: { value: { videoWidth: 0, videoHeight: 0 } },
    rotateFullscreenToLandscape: { value: true },
    fullscreenAspectRatio: { value: 16 / 9 },
    suppressPanelTransitions: () => {},
    handleScrollMiniFullscreenButtonClick: () => {},
    setTimeout: callback => { recoveryTimers.push(callback) },
  }
  vm.runInNewContext(`${source.slice(start, end)}\nhandleFullscreenButtonClick({}); handleFullscreenButtonClick({})`, context)
  await Promise.resolve()
  assert.deepEqual(calls, [true, true])
  assert.equal(recoveryTimers.length, 2)
  recoveryTimers[0]()
  assert.deepEqual(calls, [true, true])
  recoveryTimers[1]()
  assert.deepEqual(calls, [true, true, false])
})

test('Android rechecks fullscreen orientation when metadata aspect ratio arrives', async () => {
  const start = source.indexOf('    watch([rotateFullscreenToLandscape, fullscreenAspectRatio],')
  const end = source.indexOf('\n    /** @type', start)
  assert.ok(start !== -1 && end !== -1)
  const calls = []
  let onChange
  vm.runInNewContext(source.slice(start, end), {
    watch: (_sources, callback) => { onChange = callback },
    rotateFullscreenToLandscape: { value: true },
    fullscreenAspectRatio: { value: 16 / 9 },
    isNativeFullscreenActive: () => true,
    video: { value: { videoWidth: 0, videoHeight: 0 } },
    setFullscreenOrientation: async (_fullscreen, _video, _enabled, ratio) => { calls.push(ratio) },
  })
  await onChange([true, 16 / 9])
  assert.deepEqual(calls, [16 / 9])
})
