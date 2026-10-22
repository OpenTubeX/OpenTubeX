import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { getVideoCodecPreferences, preferredVideoDecodingAttributes } from '../../src/renderer/helpers/player/videoCodecPreference.js'

test('automatic selection leaves all supported codecs available for hardware selection', () => {
  assert.deepEqual(getVideoCodecPreferences('auto'), [{ codec: '', hdrLevel: 'AUTO' }])
  assert.deepEqual(getVideoCodecPreferences('unknown'), [{ codec: '', hdrLevel: 'AUTO' }])
})

test('explicit preferences cover both VP9 identifiers', () => {
  assert.deepEqual(getVideoCodecPreferences('vp9').map(entry => entry.codec).filter(Boolean), ['vp09', 'vp9'])
  assert.deepEqual(getVideoCodecPreferences('av1').map(entry => entry.codec).filter(Boolean), ['av01'])
  assert.deepEqual(getVideoCodecPreferences('h264').map(entry => entry.codec).filter(Boolean), ['avc1'])
})

// Exercise the installed player's filtering, including its fallback semantics.
const shaka = { util: {}, media: {}, device: { DeviceFactory: { getDevice: () => ({ getHdrLevel: () => 'SDR' }) } } }
runInNewContext(readFileSync(new URL('../../node_modules/shaka-player/lib/util/stream_utils.js', import.meta.url), 'utf8'), {
  shaka,
  goog: { provide() {}, require() {}, requireType() {} }
})
const variants = ['av01.0.09M.08', 'vp9', 'avc1.64002a'].map(codecs => ({ video: { codecs } }))

test('Shaka selects the requested codec and falls back when it is absent', () => {
  const choose = (available, preference) => shaka.util.StreamUtils.choosePreferredCodecs(
    available, getVideoCodecPreferences(preference).map(entry => entry.codec).filter(Boolean), []
  )
  assert.deepEqual(choose(variants, 'vp9'), [variants[1]])
  assert.deepEqual(choose(variants, 'h264'), [variants[2]])
  assert.deepEqual(choose(variants.slice(1), 'av1'), variants.slice(1))
  assert.deepEqual(choose(variants, 'auto'), variants)
})

test('every codec preference retains automatic display HDR selection', () => {
  for (const preference of ['auto', 'unknown', 'av1', 'vp9', 'h264']) {
    const entries = getVideoCodecPreferences(preference)
    assert.ok(entries.length > 0, `${preference}: automatic HDR entry missing`)
    for (const entry of entries) assert.equal(entry.hdrLevel, 'AUTO')
  }
})

runInNewContext(readFileSync(new URL('../../node_modules/shaka-player/lib/media/preference_based_criteria.js', import.meta.url), 'utf8'), {
  shaka,
  goog: { provide() {}, require() {}, requireType() {} }
})

test('full codec identifiers retain HDR filtering after manifest codec selection', () => {
  const available = ['av01.0.09M.08', 'vp09.00.51.08', 'avc1.64002a'].flatMap(codecs =>
    ['SDR', 'PQ'].map(hdr => ({ video: { codecs, hdr } }))
  )
  for (const preference of ['auto', 'av1', 'vp9', 'h264']) {
    const preferences = getVideoCodecPreferences(preference)
    const codecs = preferences.map(entry => entry.codec).filter(Boolean)
    const filtered = shaka.util.StreamUtils.choosePreferredCodecs(available, codecs, [])
    const selected = shaka.media.PreferenceBasedCriteria.applyVideoPreferences_(filtered, preferences)
    assert.ok(selected.length > 0)
    assert.ok(selected.every(variant => variant.video.hdr === 'SDR'), preference)
    if (preference !== 'auto') {
      const prefix = { av1: 'av01', vp9: 'vp09', h264: 'avc1' }[preference]
      assert.ok(selected.every(variant => variant.video.codecs.startsWith(prefix)))
    }
  }
})

shaka.log = { debug() {} }
shaka.polyfill = { register: install => install() }
for (const file of ['multi_map', 'mime_utils']) {
  const polyfill = file === 'multi_map'
    ? readFileSync(new URL('../../node_modules/shaka-player/lib/polyfill/map.js', import.meta.url), 'utf8')
    : ''
  runInNewContext(polyfill + readFileSync(new URL(`../../node_modules/shaka-player/lib/util/${file}.js`, import.meta.url), 'utf8'), {
    shaka, goog: { provide() {}, require() {}, requireType() {} }
  })
}

test('Auto prefers hardware decoding over a lower-bitrate software codec reported smooth', () => {
  const variants = [
    { codec: 'av01.0.09M.08', bitrate: 1270300, smooth: true, powerEfficient: false },
    { codec: 'vp9', bitrate: 1914862, smooth: false, powerEfficient: true },
    { codec: 'avc1.64002A', bitrate: 3819357, smooth: false, powerEfficient: true }
  ].map((format, id) => ({
    video: { id, codecs: format.codec, bandwidth: format.bitrate, width: 1920, height: 1080, frameRate: 60 },
    decodingInfos: [{ supported: true, smooth: format.smooth, powerEfficient: format.powerEfficient }]
  }))
  const manifest = { variants, textStreams: [] }
  shaka.util.StreamUtils.chooseCodecsAndFilterManifest(manifest, [], [], preferredVideoDecodingAttributes, [])
  assert.equal(manifest.variants.length, 1)
  assert.equal(manifest.variants[0].video.codecs, 'vp9')

  // An explicit preference still wins, and software-only devices remain playable.
  const explicit = { variants, textStreams: [] }
  shaka.util.StreamUtils.chooseCodecsAndFilterManifest(explicit, ['av01'], [], preferredVideoDecodingAttributes, [])
  assert.equal(explicit.variants[0].video.codecs, 'av01.0.09M.08')
  const software = { variants: variants.map(variant => ({
    ...variant, decodingInfos: [{ supported: true, smooth: true, powerEfficient: false }]
  })), textStreams: [] }
  shaka.util.StreamUtils.chooseCodecsAndFilterManifest(software, [], [], preferredVideoDecodingAttributes, [])
  assert.ok(software.variants.length > 0)
})

for (const powerEfficient of [true, false]) {
  test(`Auto uses smoothness to break ties when powerEfficient is ${powerEfficient}`, () => {
    const variants = [
      { codec: 'av01.0.09M.08', bitrate: 1270300, smooth: false },
      { codec: 'vp9', bitrate: 1914862, smooth: true }
    ].map((format, id) => ({
      video: { id, codecs: format.codec, bandwidth: format.bitrate, width: 1920, height: 1080, frameRate: 60 },
      decodingInfos: [{ supported: true, smooth: format.smooth, powerEfficient }]
    }))
    const manifest = { variants, textStreams: [] }
    shaka.util.StreamUtils.chooseCodecsAndFilterManifest(manifest, [], [], preferredVideoDecodingAttributes, [])
    assert.equal(manifest.variants.length, 1)
    assert.equal(manifest.variants[0].video.codecs, 'vp9')
  })
}
