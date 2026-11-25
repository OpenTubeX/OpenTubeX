import assert from 'node:assert/strict'
import test from 'node:test'

import { getActiveCueText, getCueText } from '../../src/renderer/helpers/player/secondary-captions.js'

test('flattens styled cues and line breaks into plain text', () => {
  assert.equal(getCueText({
    startTime: 0,
    endTime: 1,
    payload: '',
    nestedCues: [
      { startTime: 0, endTime: 1, payload: 'Hello', nestedCues: [] },
      { startTime: 0, endTime: 1, payload: '', lineBreak: true, nestedCues: [] },
      { startTime: 0, endTime: 1, payload: 'world', nestedCues: [] },
    ]
  }, 0.5), 'Hello\nworld')
})

test('shows timed nested cues only while they are active', () => {
  const cue = {
    startTime: 0,
    endTime: 3,
    payload: '',
    nestedCues: [
      { startTime: 0, endTime: 3, payload: 'one ' },
      { startTime: 1, endTime: 3, payload: 'two ' },
      { startTime: 2, endTime: 3, payload: 'three' },
    ]
  }

  assert.equal(getActiveCueText([cue], 0.5), 'one')
  assert.equal(getActiveCueText([cue], 1.5), 'one two')
  assert.equal(getActiveCueText([cue], 2.5), 'one two three')
})

test('shows only the cues active at the current time', () => {
  const cues = [
    { startTime: 0, endTime: 2, payload: 'first' },
    { startTime: 1, endTime: 3, payload: ' second ' },
    { startTime: 3, endTime: 4, payload: 'third' },
    { startTime: 1, endTime: 2, payload: '   ' },
  ]

  assert.equal(getActiveCueText(cues, 0), 'first')
  assert.equal(getActiveCueText(cues, 1.5), 'first\nsecond')
  // end times are exclusive, so back-to-back cues never show together
  assert.equal(getActiveCueText(cues, 3), 'third')
  assert.equal(getActiveCueText(cues, 4), '')
})
