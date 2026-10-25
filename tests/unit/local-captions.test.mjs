import assert from 'node:assert/strict'
import test from 'node:test'

import { createLocalCaption, LOCAL_CAPTION_FILE_TYPES, normalizeLocalCaptionText } from '../../src/renderer/helpers/player/localCaptions.js'

const srt = '1\n00:00:01,000 --> 00:00:02,000\nÜbersetzung & mehr\n'

test('keeps the subtitle file local in a data URL of the matching Shaka text type', () => {
  for (const [fileName, mimeType] of [['movie.srt', 'text/srt'], ['movie.en.VTT', 'text/vtt']]) {
    const caption = createLocalCaption(fileName, srt, [])
    assert.deepEqual(caption, {
      url: `data:${mimeType};charset=utf-8,${encodeURIComponent(srt)}`,
      label: fileName,
      language: 'und',
      mimeType,
    })
    assert.equal(decodeURIComponent(caption.url.slice(caption.url.indexOf(',') + 1)), srt)
  }
})

test('converts SRT timing and separators that Shaka cannot parse', () => {
  assert.equal(
    normalizeLocalCaptionText('movie.SRT', '1\r\n00:00:01.000 --> 00:00:02,500 X1:10\r\nAt 1.5 seconds\r\n \t\r\n2\r00:00:03.000 --> 00:00:04.000\rWorld\r'),
    '1\n00:00:01,000 --> 00:00:02,500 X1:10\nAt 1.5 seconds\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n'
  )
  const vtt = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\n'
  assert.equal(normalizeLocalCaptionText('movie.vtt', vtt), vtt)
})

test('rejects files that are not SRT or WebVTT subtitles', () => {
  for (const fileName of ['movie.ass', 'movie.txt', 'srt', 'movie.srt.zip']) {
    assert.equal(createLocalCaption(fileName, srt, []), null, fileName)
  }
})

test('gives a file loaded again a distinct label', () => {
  assert.equal(createLocalCaption('movie.srt', srt, ['English', 'movie.srt']).label, 'movie.srt (2)')
  assert.equal(createLocalCaption('movie.srt', srt, ['movie.srt', 'movie.srt (2)']).label, 'movie.srt (3)')
})

test('offers only the supported file types in the picker', () => {
  assert.deepEqual(Object.values(LOCAL_CAPTION_FILE_TYPES).sort(), ['.srt', '.vtt'])
})
