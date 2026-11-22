import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import '@capacitor/core'

// The Android plugin is registered when the helper is first imported, so this
// file sets up Capacitor before loading the coordinator.
const calls = []
globalThis.Capacitor.PluginHeaders = [{
  name: 'AndroidMediaSession',
  methods: [{ name: 'update', rtype: 'promise' }, { name: 'clear', rtype: 'promise' }]
}]
globalThis.Capacitor.nativePromise = (plugin, method, options) => {
  if (plugin === 'AndroidMediaSession') calls.push(method === 'clear' ? 'clear' : `${options.state.playbackState} ${options.state.title}`)
  return Promise.resolve()
}
process.env.IS_CAPACITOR = '1'
const { tabMediaCoordinator } = await import('../../src/renderer/tabs/TabMediaCoordinator.js')

test('Android keeps the playback service from a video end until the next video plays', async t => {
  t.after(() => tabMediaCoordinator.unregister('handoff-tab'))
  const playVideo = title => {
    tabMediaCoordinator.setMetadata('handoff-tab', { title })
    tabMediaCoordinator.setActionHandlers('handoff-tab', 'player', { pause() {} })
    tabMediaCoordinator.setPlaybackState('handoff-tab', 'playing')
  }
  const replacePlayer = () => {
    tabMediaCoordinator.setActionHandlers('handoff-tab', 'player', {})
    tabMediaCoordinator.setPlaybackState('handoff-tab', 'none')
    tabMediaCoordinator.setMetadata('handoff-tab', null)
  }
  tabMediaCoordinator.setPresented('handoff-tab')
  playVideo('First')
  await setImmediate()

  // A background app cannot start the service again for the queued video.
  calls.length = 0
  tabMediaCoordinator.endPlayback('handoff-tab')
  replacePlayer()
  assert.equal(tabMediaCoordinator.holdsEndedPlayback('handoff-tab'), true, 'a hidden next player can start')
  playVideo('Second')
  await setImmediate()
  assert.deepEqual(calls, ['paused First', 'playing Second'])

  // Without a next video, the ended video's notification goes away.
  tabMediaCoordinator.endPlayback('handoff-tab')
  tabMediaCoordinator.releaseEndedPlayback('handoff-tab')
  await setImmediate()
  assert.equal(calls.at(-1), 'clear')
})

test('repeated reports of the same end keep the handoff deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => tabMediaCoordinator.unregister('deadline-tab'))
  tabMediaCoordinator.setPresented('deadline-tab')
  tabMediaCoordinator.setMetadata('deadline-tab', { title: 'Ended' })
  tabMediaCoordinator.setPlaybackState('deadline-tab', 'playing')
  tabMediaCoordinator.endPlayback('deadline-tab')
  t.mock.timers.tick(60_000)
  tabMediaCoordinator.endPlayback('deadline-tab')
  t.mock.timers.tick(60_000)
  assert.equal(tabMediaCoordinator.holdsEndedPlayback('deadline-tab'), false)
  await setImmediate()
  assert.equal(calls.at(-1), 'clear')
})
