import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'

import { isAppHidden, setAndroidAppVisible } from '../../src/renderer/helpers/appVisibility.js'
import { createPlaybackScreenWake } from '../../src/renderer/helpers/playbackScreenWake.js'

test('Android background playback follows Home even when Chromium stays visible for a refresh', () => {
  const originalDocument = globalThis.document
  const document = new EventTarget()
  document.hidden = false
  globalThis.document = document
  const changes = []
  document.addEventListener('visibilitychange', () => { changes.push(isAppHidden()) })
  try {
    setAndroidAppVisible(true)
    setAndroidAppVisible(false)
    assert.equal(isAppHidden(), true)

    // Releasing the refresh changes Chromium visibility too, but the activity
    // remains hidden. Returning to the app must still publish a resume event.
    document.hidden = true
    assert.equal(isAppHidden(), true)
    document.hidden = false
    setAndroidAppVisible(true)
    assert.equal(isAppHidden(), false)
    assert.deepEqual(changes, [true, false])

    setAndroidAppVisible(null)
    document.hidden = true
    assert.equal(isAppHidden(), true, 'other platforms use document visibility')
  } finally {
    setAndroidAppVisible(null)
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

for (const eventFirst of [false, true]) {
  test(`Android initial visibility preserves ${eventFirst ? 'a newer app-state event' : 'the initial snapshot without an event'}`, async () => {
    const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
    const start = source.indexOf('async function enableCapacitorIntegrations() {')
    const integration = source.slice(start, source.indexOf('\nconst windowTitle', start))
    const initialState = Promise.withResolvers()
    const requestedState = Promise.withResolvers()
    const changes = []
    const listeners = new Map()
    const removedListeners = []
    const wakeCalls = []
    const playbackScreenWake = createPlaybackScreenWake({
      async keepAwake() { wakeCalls.push(true) },
      async allowSleep() { wakeCalls.push(false) },
    })
    playbackScreenWake.bindVideo(Object.assign(new EventTarget(), { paused: false, ended: false }), () => true)
    const window = new EventTarget()
    let listener
    let pauses = 0
    let backPresses = 0
    let nativeAppActive = true
    let requestedInitialState = false
    const enable = vm.runInNewContext(`${integration}\nenableCapacitorIntegrations`, {
      window,
      Capacitor: { getPlatform: () => 'android' },
      handleAndroidBack: () => { backPresses++ },
      CapacitorApp: {
        addListener: async (name, callback) => {
          listeners.set(name, callback)
          if (name === 'appStateChange') listener = ({ isActive }) => {
            nativeAppActive = isActive
            callback({ isActive })
          }
          return { remove() { removedListeners.push(name) } }
        },
        getState: () => {
          if (requestedInitialState) return Promise.resolve({ isActive: nativeAppActive })
          requestedInitialState = true
          requestedState.resolve()
          return initialState.promise
        },
        getLaunchUrl: async () => null,
      },
      initializeCapacitorLiveReminderActions: async () => () => {},
      addAndroidMediaSessionActionListener: async () => () => {},
      AppShortcuts: { addListener: async () => ({ remove() {} }) },
      watch: () => () => {},
      locale: {},
      setAndroidAppVisible: visible => changes.push(visible),
      isAndroidLauncherReturnInProgress: async () => !eventFirst,
      playbackScreenWake,
      shouldPauseAndroidPlaybackOnAppStateChange: active => !active,
      store: { getters: { getContinuePlaybackWhenScreenIsLocked: false } },
      tabMediaCoordinator: { pauseAll: () => { pauses++ } },
      setTimeout,
      clearTimeout,
    })
    const enabling = enable()
    await requestedState.promise
    if (eventFirst) listener({ isActive: false })
    initialState.resolve({ isActive: true })
    const cleanup = await enabling
    assert.deepEqual(changes, eventFirst ? [] : [true])
    if (!eventFirst) {
      // Opening the icon while PiP is playing briefly backgrounds the Activity
      // before bringing the existing task to the foreground again.
      listener({ isActive: false })
      await delay(350)
      assert.equal(pauses, 0, 'a slow launcher return must not pause PiP')
      listener({ isActive: true })
      assert.ok(changes.every(Boolean), 'a launcher handoff must not hide the playing PiP view')
    }
    assert.equal(pauses, 0, 'a launcher handoff must not pause playing PiP')
    if (eventFirst) await delay(350)
    assert.equal(changes.includes(false), eventFirst, 'only a sustained background state becomes hidden')
    assert.equal(pauses, eventFirst ? 1 : 0, 'a sustained background state still pauses')
    listeners.get('backButton')({ canGoBack: false })
    assert.equal(backPresses, 1, 'native back events reach the existing app navigation handler')
    await setImmediate()
    assert.equal(wakeCalls.at(-1), !eventFirst, 'wake follows the newest native app lifecycle state')
    window.dispatchEvent(new Event('opentubex:android-task-removed'))
    assert.equal(pauses, eventFirst ? 2 : 1, 'task removal pauses playback while refresh continues')
    cleanup()
    window.dispatchEvent(new Event('opentubex:android-task-removed'))
    assert.equal(pauses, eventFirst ? 2 : 1, 'cleanup removes the task removal listener')
    await setImmediate()
    assert.equal(wakeCalls.at(-1), false, 'app teardown releases screen wake')
    assert.equal(changes.at(-1), null)
    assert.ok(removedListeners.includes('backButton'), 'unmount removes the native back listener')
  })
}

test('Capacitor integrations do not register the Android back button on iOS', async () => {
  const source = await readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function enableCapacitorIntegrations() {')
  const integration = source.slice(start, source.indexOf('\nconst windowTitle', start))
  const listeners = []
  const enable = vm.runInNewContext(`${integration}\nenableCapacitorIntegrations`, {
    window: new EventTarget(),
    Capacitor: { getPlatform: () => 'ios' },
    playbackScreenWake: createPlaybackScreenWake({ async keepAwake() {}, async allowSleep() {} }),
    AppShortcuts: { addListener: async () => ({ remove() {} }) },
    watch: () => () => {},
    locale: {},
    CapacitorApp: {
      addListener: async name => {
        listeners.push(name)
        return { remove() {} }
      },
      getState: async () => ({ isActive: true }),
      getLaunchUrl: async () => null,
    },
    initializeCapacitorLiveReminderActions: async () => () => {},
    addAndroidMediaSessionActionListener: async () => () => {},
    setAndroidAppVisible() {},
    clearTimeout,
  })

  const cleanup = await enable()
  assert.ok(!listeners.includes('backButton'))
  cleanup()
})
