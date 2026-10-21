import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { getVideoCodecPreferences } from '../../src/renderer/helpers/player/videoCodecPreference.js'

test('automatic selection leaves all supported codecs available for hardware selection', () => {
  assert.deepEqual(getVideoCodecPreferences('auto', false), [])
  assert.deepEqual(getVideoCodecPreferences('unknown', false), [])
})

test('explicit preferences cover both VP9 identifiers', () => {
  assert.deepEqual(getVideoCodecPreferences('vp9', false), ['vp09', 'vp9'])
  assert.deepEqual(getVideoCodecPreferences('av1', false), ['av01'])
  assert.deepEqual(getVideoCodecPreferences('h264', false), ['avc1'])
})

test('VR keeps the VP9 demuxer workaround even when VP9 is preferred', () => {
  assert.deepEqual(getVideoCodecPreferences('auto', true), ['av01', 'avc1'])
  assert.deepEqual(getVideoCodecPreferences('vp9', true), ['av01', 'avc1'])
  assert.deepEqual(getVideoCodecPreferences('h264', true), ['avc1', 'av01'])
  assert.deepEqual(getVideoCodecPreferences('av1', true), ['av01', 'avc1'])
})

// Exercise the installed player's filtering, including its fallback semantics.
const shaka = { util: {} }
runInNewContext(readFileSync(new URL('../../node_modules/shaka-player/lib/util/stream_utils.js', import.meta.url), 'utf8'), {
  shaka,
  goog: { provide() {}, require() {}, requireType() {} }
})
const variants = ['av01.0.09M.08', 'vp9', 'avc1.64002a'].map(codecs => ({ video: { codecs } }))

test('Shaka selects the requested codec and falls back when it is absent', () => {
  const choose = (available, preference) => shaka.util.StreamUtils.choosePreferredCodecs(
    available, getVideoCodecPreferences(preference, false), []
  )
  assert.deepEqual(choose(variants, 'vp9'), [variants[1]])
  assert.deepEqual(choose(variants, 'h264'), [variants[2]])
  assert.deepEqual(choose(variants.slice(1), 'av1'), variants.slice(1))
  assert.deepEqual(choose(variants, 'auto'), variants)
})
