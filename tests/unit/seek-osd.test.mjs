import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/FtShakaVideoPlayer/FtShakaVideoPlayer.vue', import.meta.url), 'utf8')

function fixture(t, { time = 50, live = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes = []
  const state = {
    accumulatedSeekSeconds: 0,
    hasPlaybackPosition: { value: false },
    hasLoaded: { value: true },
    videoLayoutReady: { value: true },
    pendingMetadataSeek: null,
    video: { value: { readyState: 4, get currentTime() { return time }, set currentTime(value) { time = value; writes.push(value) } } },
    player: { seekRange: () => ({ start: 0, end: 100 }), goToLive: () => { time = 100; writes.push(time) } },
    isLive: { value: live },
    canSeek: () => true,
    valueChangeMessage: { value: '' },
    valueChangeIcons: { value: [] },
    showValueChangePopup: { value: false },
    invertValueChangeContentOrder: { value: false },
    valueChangeTimeout: null,
    showOverlayControls() {},
    noteSeekHistoryJump() {},
    setTimeout,
    clearTimeout,
  }
  const names = ['seekBySeconds', 'rememberSeekPosition', 'showValueChange']
  const functions = names.map(name => {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?\\n}`, 'm'))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  const api = vm.runInNewContext(`${functions}\n({ ${names.join(', ')} })`, state)
  return { state, writes, ...api }
}

test('repeated 5s seeks happen immediately and accumulate in the OSD', t => {
  const step = 5
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
