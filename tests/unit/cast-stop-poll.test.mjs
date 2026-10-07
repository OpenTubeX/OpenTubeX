import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileFunction } from 'node:vm'
import test from 'node:test'

const component = await readFile(new URL('../../src/renderer/components/WatchChromecast/WatchChromecast.vue', import.meta.url), 'utf8')
const polling = component.slice(component.indexOf('async function poll()'), component.indexOf('async function handleChoice('))

for (const outcome of ['disconnect', 'rejection', 'stale playback']) {
  for (const afterStop of [false, true]) {
    test(`intentional stop ignores ${outcome} ${afterStop ? 'after' : 'during'} stop completion`, async () => {
      let resolveStatus, rejectStatus, resolveStop
      let errors = 0, stops = 0, timers = 0
      const releases = [], events = []
      const castId = { value: 'session' }
      const status = { value: { connected: true, currentTime: 18, paused: false } }
      const api = {
        status: () => new Promise((resolve, reject) => { resolveStatus = resolve; rejectStatus = reject }),
        stop: () => { stops++; return new Promise(resolve => { resolveStop = resolve }) }
      }
      const { poll, stopCasting } = compileFunction(`let disposed = false, pollTimer; ${polling}\nreturn { poll, stopCasting }`,
        ['chromecast', 'castId', 'status', 'emit', 'releaseLocalPlayer', 'reportError', 'setTimeout', 'clearTimeout'])(
        api, castId, status, (...args) => events.push(args),
        (...args) => releases.push(args), () => errors++, () => { timers++ }, () => {})
      const pendingPoll = poll()
      const stopping = stopCasting()
      const repeatedStop = stopCasting()
      if (afterStop) { resolveStop({ connected: false, currentTime: 19, paused: false }); await stopping }
      if (outcome === 'rejection') rejectStatus(new Error('Sender closed'))
      else resolveStatus({ connected: outcome !== 'disconnect', currentTime: 1, paused: true })
      await Promise.resolve()
      assert.equal(errors, 0)
      assert.equal(stops, 1)
      assert.equal(timers, 0)
      if (!afterStop) {
        assert.equal(castId.value, 'session')
        assert.equal(status.value.currentTime, 18)
        assert.deepEqual(events, [])
        assert.deepEqual(releases, [])
        resolveStop({ connected: false, currentTime: 19, paused: false })
      }
      await Promise.all([stopping, repeatedStop])
      await pendingPoll
      assert.equal(errors, 0)
      assert.equal(castId.value, null)
      assert.equal(status.value.currentTime, 19)
      assert.deepEqual(releases, [[19, true]])
      assert.equal(events.length, 1)
    })
  }
}
