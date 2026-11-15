import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { Misc } from 'youtubei.js'

import { getYatteeUpstreamUrl } from '../../src/renderer/helpers/api/yattee.js'

const source = readFileSync(new URL('../../src/renderer/helpers/player/yatteePlayback.js', import.meta.url), 'utf8')
const from = source.indexOf('function normalizeMimeType(')
const to = source.indexOf('/**\n * yattee-server leaves out')
assert.ok(from >= 0 && to > from, 'Update the extracted range after changing yatteePlayback.js')
const convertYatteeToLocalFormat = vm.runInNewContext(`${source.slice(from, to)}\nconvertYatteeToLocalFormat`, { Misc, getYatteeUpstreamUrl, URL })

test('audio track IDs become language tags when the stream URL has no language', () => {
  const format = convertYatteeToLocalFormat({
    itag: '140',
    type: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: '128000',
    url: 'https://rr1---sn-abc.googlevideo.com/videoplayback?itag=140&dur=6.000',
    audioTrack: { id: 'en.4', displayName: 'English original', isDefault: true }
  }, { initRange: { start: 0, end: 600 }, indexRange: { start: 601, end: 700 } }, 6)

  assert.equal(format.language, 'en')
  assert.doesNotThrow(() => new Intl.DisplayNames('en-US', { type: 'language' }).of(format.language))
})
