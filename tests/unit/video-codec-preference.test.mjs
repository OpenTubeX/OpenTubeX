import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { chooseAutoVariants, chooseAutoVariantsWithDisabled, getVideoCodecPreferences, preferredVideoDecodingAttributes } from '../../src/renderer/helpers/player/videoCodecPreference.js'

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

runInNewContext(readFileSync(new URL('../../node_modules/shaka-player/lib/media/preference_based_criteria.js', import.meta.url), 'utf8'), {
  shaka,
  goog: { provide() {}, require() {}, requireType() {} }
})

test('full codec identifiers retain HDR filtering after manifest codec selection', () => {
  const available = ['av01.0.09M.08', 'vp09.00.51.08', 'avc1.64002a'].flatMap(codecs =>
    ['SDR', 'PQ'].map(hdr => ({ video: { codecs, hdr } }))
  )
  for (const preference of ['auto', 'vp9']) {
    const preferences = getVideoCodecPreferences(preference)
    const codecs = preferences.map(entry => entry.codec).filter(Boolean)
    const filtered = shaka.util.StreamUtils.choosePreferredCodecs(available, codecs, [])
    const selected = shaka.media.PreferenceBasedCriteria.applyVideoPreferences_(filtered, preferences)
    assert.ok(selected.length > 0)
    assert.ok(selected.every(variant => variant.video.hdr === 'SDR'), preference)
    if (preference !== 'auto') {
      assert.ok(selected.every(variant => variant.video.codecs.startsWith('vp09')))
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
  const chosen = chooseAutoVariants(variants, [], preferredVideoDecodingAttributes)
  assert.equal(chosen.length, 1)
  assert.equal(chosen[0].video.codecs, 'vp9')

  // An explicit preference still wins, and software-only devices remain playable.
  const explicit = chooseAutoVariants(variants, ['av01'], preferredVideoDecodingAttributes)
  assert.equal(explicit[0].video.codecs, 'av01.0.09M.08')
  const software = variants.map(variant => ({
    ...variant, decodingInfos: [{ supported: true, smooth: true, powerEfficient: false }]
  }))
  assert.ok(chooseAutoVariants(software, [], preferredVideoDecodingAttributes).length > 0)
})

test('Auto uses smoothness to break ties between power-efficient codecs', () => {
  const variants = [
    { codec: 'av01.0.09M.08', bitrate: 1270300, smooth: false },
    { codec: 'vp9', bitrate: 1914862, smooth: true }
  ].map((format, id) => ({
    video: { id, codecs: format.codec, bandwidth: format.bitrate, width: 1920, height: 1080, frameRate: 60 },
    decodingInfos: [{ supported: true, smooth: format.smooth, powerEfficient: true }]
  }))
  const chosen = chooseAutoVariants(variants, [], preferredVideoDecodingAttributes)
  assert.equal(chosen.length, 1)
  assert.equal(chosen[0].video.codecs, 'vp9')
})

test('Auto chooses the same variants as Shaka would keep in the manifest', () => {
  // YouTube-like formats, with AV1, VP9 and H.264 at most resolutions
  const formats = [
    ['av01.0.00M.08', 256, 144, 30, 30e3], ['vp9', 256, 144, 30, 60e3], ['avc1.4D400C', 256, 144, 30, 50e3],
    ['av01.0.04M.08', 854, 480, 30, 120e3], ['vp9', 854, 480, 30, 180e3], ['avc1.4D401F', 854, 480, 30, 300e3],
    ['av01.0.08M.08', 1280, 720, 60, 250e3], ['vp9', 1280, 720, 60, 400e3], ['avc1.640020', 1280, 720, 60, 800e3],
    ['vp9', 1280, 720, 30, 350e3], ['avc1.64001F', 1280, 720, 30, 550e3],
    ['av01.0.09M.08', 1920, 1080, 60, 500e3], ['vp9', 1920, 1080, 60, 650e3], ['avc1.64002A', 1920, 1080, 60, 1.5e6],
    ['av01.0.13M.08', 3840, 2160, 60, 2.5e6], ['vp9', 3840, 2160, 60, 3.5e6],
    ['vp09.02.51.10', 3840, 2160, 60, 4e6, 'PQ'],
  ]
  /** Decoding attributes by device, e.g. a GPU without AV1 decoding */
  const devices = {
    software: () => ({ smooth: true, powerEfficient: false }),
    noAv1: codecs => ({ smooth: true, powerEfficient: !codecs.startsWith('av01') }),
    hardware: () => ({ smooth: true, powerEfficient: true }),
    av1Below4k: (codecs, height) => ({ smooth: height < 2160, powerEfficient: !codecs.startsWith('av01') || height < 2160 }),
  }

  for (const [device, getDecodingInfo] of Object.entries(devices)) {
    const variants = formats.map(([codecs, width, height, frameRate, bandwidth, hdr = 'SDR'], id) => ({
      id,
      video: { id, codecs, width, height, frameRate, bandwidth, hdr, roles: [] },
      decodingInfos: [{ supported: true, ...getDecodingInfo(codecs, height) }]
    }))
    for (const preference of ['auto', 'av1', 'vp9', 'h264']) {
      for (const decodingAttributes of [preferredVideoDecodingAttributes, []]) {
        const codecs = getVideoCodecPreferences(preference).map(entry => entry.codec).filter(Boolean)
        const manifest = { variants, textStreams: [] }
        shaka.util.StreamUtils.chooseCodecsAndFilterManifest(manifest, codecs, [], decodingAttributes, [])
        assert.deepEqual(
          chooseAutoVariants(variants, codecs, decodingAttributes).map(variant => variant.id).sort((a, b) => a - b),
          // Copied out of the VM context, as deepEqual compares prototypes
          [...manifest.variants].map(variant => variant.id).sort((a, b) => a - b),
          `${device}, ${preference}, ${decodingAttributes.length > 0 ? 'with' : 'without'} decoding attributes`
        )
      }
    }
  }
})

test('Auto keeps the chosen codec at lower resolutions when Shaka disables its streams', () => {
  // A GPU without AV1 decoding, where automatic quality chooses VP9
  const formats = [
    ['av01.0.04M.08', 854, 480, 120e3], ['vp9', 854, 480, 180e3], ['avc1.4D401F', 854, 480, 300e3],
    ['av01.0.09M.08', 1920, 1080, 500e3], ['vp9', 1920, 1080, 650e3], ['avc1.64002A', 1920, 1080, 1.5e6],
    ['av01.0.13M.08', 3840, 2160, 2.5e6], ['vp9', 3840, 2160, 3.5e6],
  ]
  const variants = formats.map(([codecs, width, height, bandwidth], id) => ({
    id,
    video: { id, codecs, width, height, frameRate: 30, bandwidth, hdr: 'SDR', roles: [] },
    decodingInfos: [{ supported: true, smooth: true, powerEfficient: !codecs.startsWith('av01') }],
    allowedByApplication: true,
    allowedByKeySystem: true,
    disabledUntilTime: 0,
  }))
  const choose = () => chooseAutoVariantsWithDisabled(
    variants.filter(variant => variant.disabledUntilTime === 0), variants, [], preferredVideoDecodingAttributes
  ).map(variant => variant.video.codecs + '@' + variant.video.height)

  assert.deepEqual(choose(), ['vp9@480', 'vp9@1080', 'vp9@2160'])

  // Dropped frames disable the 4K VP9 stream, which left AV1 as the only 4K stream
  variants[7].disabledUntilTime = 1
  assert.deepEqual(choose(), ['vp9@480', 'vp9@1080'])

  // Once every VP9 stream is disabled, fall back to the cheapest codec to decode
  variants[1].disabledUntilTime = variants[4].disabledUntilTime = 1
  assert.deepEqual(choose(), ['avc1.4D401F@480', 'avc1.64002A@1080'])

  // Streams the application restricts are not kept for later
  for (const variant of variants) variant.disabledUntilTime = 0
  variants[7].allowedByApplication = false
  assert.deepEqual(chooseAutoVariantsWithDisabled(
    variants.filter(variant => variant.allowedByApplication), variants, [], preferredVideoDecodingAttributes
  ).map(variant => variant.video.codecs + '@' + variant.video.height), ['vp9@480', 'vp9@1080', 'av01.0.13M.08@2160'])
})
