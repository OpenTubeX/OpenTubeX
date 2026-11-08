import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed } from 'vue'

const component = await readFile(new URL('../../src/renderer/components/PlaylistInfo/PlaylistInfo.vue', import.meta.url), 'utf8')
const durationComputed = component.match(/const durationFormatted = computed\(\(\) => \{[^]*?\n\}\)/)[0]
const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const formatter = utils.match(/export function formatDurationAsTimestamp\([^]*?\n\}/)[0].replace('export ', '')

function formatTotal(totalPlaylistDuration, overrides = {}) {
  return vm.runInNewContext(`${formatter}\n${durationComputed}\ndurationFormatted.value`, {
    computed,
    props: { totalPlaylistDuration, ...overrides },
    locale: { value: 'en-US' },
    isUserPlaylist: { value: overrides.isUserPlaylist ?? true },
  })
}

test('playlist totals use the same day-aware timestamps as videos', () => {
  for (const [seconds, expected] of [
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [3661, '1:01:01'],
    [86399, '23:59:59'],
    [86400, '1:00:00:00'],
    [90061, '1:01:01:01'],
    [954061.5, '11:01:01:01'],
  ]) {
    assert.equal(formatTotal(seconds), expected)
  }
})

test('playlist totals retain approximate and partially loaded indicators', () => {
  assert.equal(formatTotal(90061, { isDurationApproximate: true }), '~1:01:01:01')
  assert.equal(formatTotal(90061, { moreVideoDataAvailable: true, isUserPlaylist: false }), '1:01:01:01+')
  assert.equal(formatTotal(90061, { moreVideoDataAvailable: true, isUserPlaylist: false, isDurationApproximate: true }), '~1:01:01:01+')
  assert.equal(formatTotal(90061, { moreVideoDataAvailable: true }), '1:01:01:01')
})
