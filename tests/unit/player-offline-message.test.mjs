import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    const showOfflineMessage = computed(')
const expression = source.slice(start, source.indexOf('\n    // #endregion offline message', start))

for (const format of ['legacy', 'audio']) {
  test(`offline warning stays hidden while seeking downloaded ${format} media`, () => {
    const props = reactive({ localFilePlayback: true, format })
    const isOffline = ref(true)
    const isBuffering = ref(false)
    const visible = vm.runInNewContext(`${expression}\nshowOfflineMessage`, { computed, props, isOffline, isBuffering })
    assert.equal(visible.value, false)
    isBuffering.value = true
    assert.equal(visible.value, false, 'local seeking must not show a network warning')
    props.localFilePlayback = false
    assert.equal(visible.value, true, 'online streams still warn while buffering offline')
    isOffline.value = false
    assert.equal(visible.value, false)
    isOffline.value = true
    isBuffering.value = false
    assert.equal(visible.value, false)
  })
}

test('voice-over translation is unavailable offline and returns after reconnecting', () => {
  const start = source.indexOf('    const voiceOverTranslationAvailable = computed(')
  const expression = source.slice(start, source.indexOf('    const voiceOverTranslationAutoPrepare', start))
  const props = reactive({ offline: true, videoId: 'video' })
  const available = vm.runInNewContext(`${expression}\nvoiceOverTranslationAvailable`, {
    computed, props, process: { env: { IS_ELECTRON: true } },
    useVoiceOverTranslationSetting: ref(true), isLive: ref(false),
  })
  assert.equal(available.value, false)
  props.offline = false
  assert.equal(available.value, true)
})

for (const [loaded, loading] of [[false, false], [true, false], [false, true]]) {
  test(`reconnecting SponsorBlock ${loaded ? 'reuses loaded segments and decisions' : loading ? 'keeps the pending request' : 'initializes missing segments'}`, () => {
    const start = source.indexOf('    watch(useSponsorBlock, enabled => {')
    const end = source.indexOf('\n    })', start) + '\n    })'.length
    let change
    let setups = 0
    let schedules = 0
    vm.runInNewContext(source.slice(start, end), {
      watch: (_source, callback) => { change = callback }, useSponsorBlock: ref(false),
      sponsorBlockSegmentsLoaded: loaded, sponsorBlockInfoLoading: ref(loading),
      setupSponsorBlock: () => { setups++ }, scheduleSponsorBlockSkip() { schedules++ },
      closeSponsorBlockInfo() {}, sponsorBlockMuteController: { reset() {} },
      clearSponsorBlockMuteSegments() {}, cancelSponsorBlockSkipSchedule() {},
    })
    change(true)
    assert.equal(setups, loaded || loading ? 0 : 1)
    assert.equal(schedules, loaded ? 1 : 0)
  })
}
