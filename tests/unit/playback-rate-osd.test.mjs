import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { reactive, ref } from 'vue'

import { usePlaybackRate } from '../../src/renderer/components/ft-shaka-video-player/opentubex/usePlaybackRate.js'
import { resolveMappedIcon } from '../../src/renderer/icons/iconMappingResolver.js'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const readIconJson = name => JSON.parse(readFileSync(new URL(`../../src/renderer/icons/${name}.json`, import.meta.url), 'utf8'))
const aliases = readIconJson('faAliasToCanon')
const mapping = readIconJson('faIconMap')

function fixture() {
  let playerFunctions
  const playbackRate = usePlaybackRate({
    video: ref({ playbackRate: 1, defaultPlaybackRate: 1 }),
    getPlayer: () => ({ cancelTrickPlay() {}, trickPlay() {}, getPlaybackRate: () => 1 }),
    hasLoaded: ref(true),
    isLive: ref(false),
    musicMode: ref(false),
    hasSponsorBlockMusicOfftopicSegment: ref(false),
    shortsNavigationSuspended: ref(false),
    props: reactive({ currentPlaybackRate: 1, videoIsMusic: false }),
    defaultPlaybackRate: ref(1),
    maxVideoPlaybackRate: ref(4),
    savedChannelPlaybackRate: ref(null),
    holdToDoublePlaybackSpeed: ref(true),
    onPlaybackRateUpdated() {},
    onPlaybackRateUserSet() {},
    updatePendingPlaybackRateMenu() {},
    showValueChange: (...args) => playerFunctions.showValueChange(...args),
    showToast() {},
    t: key => key,
  })
  const state = {
    valueChangeMessage: { value: '' },
    valueChangeIcons: { value: [] },
    showValueChangePopup: { value: false },
    invertValueChangeContentOrder: { value: false },
    valueChangeTimeout: null,
    setPlaybackRate: playbackRate.setPlaybackRate,
    getDefaultPlaybackRateForVideo: playbackRate.getDefaultPlaybackRateForVideo,
    showOverlayControls() {},
    setTimeout() {},
    clearTimeout() {},
  }
  const names = ['handleControlsContainerClick', 'showValueChange']
  const functions = names.map(name => {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    }`))
    assert.ok(match, `missing ${name}`)
    return match[0]
  }).join('\n')
  playerFunctions = vm.runInNewContext(`${functions}\n({ ${names.join(', ')} })`, state)
  return { state, api: { ...playbackRate, ...playerFunctions } }
}

function assertSpeedOsd(state, message) {
  assert.equal(state.showValueChangePopup.value, true)
  assert.equal(state.valueChangeMessage.value, message)
  assert.equal(state.valueChangeIcons.value.length, 1, 'playback speed OSD must show an icon')
  for (const pack of ['material', 'remix']) {
    const icon = resolveMappedIcon(['fas', state.valueChangeIcons.value[0]], pack, aliases, mapping)
    assert.ok(icon, `speed icon must resolve in ${pack}`)
    assert.ok(readIconJson(`iconifyBundles/${pack}`)[icon], `speed icon must be bundled in ${pack}`)
  }
}

test('playback speed changes show an icon alongside the multiplier', () => {
  const { state, api } = fixture()
  for (const rate of [1.5, 0.75, 1]) {
    api.applyPlaybackRate(rate)
    assertSpeedOsd(state, `${rate.toFixed(2)}x`)
  }
})

test('Ctrl/Meta-click speed reset shows an icon alongside the default multiplier', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const { state, api } = fixture()
    api.handleControlsContainerClick({ [modifier]: true, stopPropagation() {} })
    assertSpeedOsd(state, '1x')
  }
})
