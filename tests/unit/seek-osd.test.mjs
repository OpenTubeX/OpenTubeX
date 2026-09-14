import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')

function fixture(t, { time = 50, live = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const state = {
    accumulatedSeekSeconds: 0,
    video: { value: { get currentTime() { return time }, set currentTime(value) { time = value; writes.push(value) } } },
    player: { seekRange: () => ({ start: 0, end: 100 }), goToLive: () => { time = 100; writes.push(time) } },
    isLive: { value: live },
    canSeek: () => true,
    valueChangeMessage: { value: '' },
    valueChangeIcons: { value: [] },
    showValueChangePopup: { value: false },
    invertValueChangeContentOrder: { value: false },
    valueChangeTimeout: null,
    showOverlayControls() {},
    setTimeout,
    clearTimeout,
  }
  const names = ['seekBySeconds', 'showValueChange']
  const functions = names.map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const api = vm.runInNewContext(`${functions}\n({ ${names.join(', ')} })`, state)
  return { state, writes, ...api }
}

for (const step of [5, -5]) {
  test(`repeated ${step}s seeks happen immediately and accumulate in the OSD`, t => {
    const { state, writes, seekBySeconds } = fixture(t)
    for (let press = 1; press <= 3; press++) {
      seekBySeconds(step, false, true)
      assert.equal(writes.at(-1), 50 + press * step)
      assert.equal(state.valueChangeMessage.value, `${press * 5}s`)
      assert.equal(state.valueChangeIcons.value[0], step > 0 ? 'arrow-right' : 'arrow-left')
      assert.equal(state.invertValueChangeContentOrder.value, step > 0)
    }
    assert.equal(writes.length, 3)
  })
}

test('direction changes subtract from the accumulated offset', t => {
  const { state, seekBySeconds } = fixture(t)
  for (const step of [5, 5, -5]) seekBySeconds(step, false, true)
  assert.equal(state.valueChangeMessage.value, '5s')
  assert.equal(state.valueChangeIcons.value[0], 'arrow-right')
  seekBySeconds(-10, false, true)
  assert.equal(state.valueChangeMessage.value, '5s')
  assert.equal(state.valueChangeIcons.value[0], 'arrow-left')
})

test('each press renews the OSD timeout and expiry resets the total', t => {
  const { state, seekBySeconds } = fixture(t)
  seekBySeconds(5, false, true)
  t.mock.timers.tick(1500)
  seekBySeconds(5, false, true)
  t.mock.timers.tick(1500)
  assert.equal(state.showValueChangePopup.value, true)
  assert.equal(state.valueChangeMessage.value, '10s')
  t.mock.timers.tick(500)
  assert.equal(state.showValueChangePopup.value, false)
  seekBySeconds(5, false, true)
  assert.equal(state.valueChangeMessage.value, '5s')
})

test('another OSD message resets the seek sequence', t => {
  const { state, seekBySeconds, showValueChange } = fixture(t)
  seekBySeconds(5, false, true)
  showValueChange('50%', 'volume-high')
  seekBySeconds(5, false, true)
  assert.equal(state.valueChangeMessage.value, '5s')
})

test('a seek without an OSD resets the sequence', t => {
  const { state, seekBySeconds } = fixture(t)
  seekBySeconds(5, false, true)
  seekBySeconds(10)
  seekBySeconds(5, false, true)
  assert.equal(state.valueChangeMessage.value, '5s')
})

test('fractional steps retain the existing two-decimal formatting', t => {
  const { state, seekBySeconds } = fixture(t)
  seekBySeconds(0.125, false, true)
  seekBySeconds(0.125, false, true)
  assert.equal(state.valueChangeMessage.value, '0.25s')
})

test('unseekable playback does not show an OSD or change position', t => {
  const { state, writes, seekBySeconds } = fixture(t)
  state.canSeek = () => false
  seekBySeconds(5, false, true)
  assert.equal(state.showValueChangePopup.value, false)
  assert.deepEqual(writes, [])
})

for (const live of [false, true]) {
  test(`seeks still respect the seek range with live=${live}`, t => {
    const { state, writes, seekBySeconds } = fixture(t, { time: 98, live })
    seekBySeconds(5, false, true)
    assert.equal(writes.at(-1), 100)
    seekBySeconds(-200, false, true)
    assert.equal(writes.at(-1), 0)
    assert.equal(state.valueChangeMessage.value, '195s')
  })
}
