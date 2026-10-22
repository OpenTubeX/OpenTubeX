import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const transcriptSource = readFileSync(new URL('../../src/renderer/components/WatchVideoTranscript/WatchVideoTranscript.vue', import.meta.url), 'utf8')
const watchTemplate = readFileSync(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')

function sliceFunction(name) {
  const start = transcriptSource.indexOf(`function ${name}(`)
  return transcriptSource.slice(start, transcriptSource.indexOf('\n}\n', start) + 2)
}

test('transcript cues carry their formatted timestamp from parsing', () => {
  const functions = ['formatTimestamp', 'parseTranscript', 'normalizeRollingCaptions', 'removeOverlappingPrefix', 'parseTimestamp', 'cleanCaptionText']
    .map(sliceFunction)
    .join('\n')
  const parseTranscript = vm.runInNewContext(`${functions}\nparseTranscript`, {
    formatDurationAsTimestamp: seconds => `t${seconds}`,
    document: {
      createElement: () => ({
        // The cues below are plain text, so the markup is the text.
        set innerHTML(value) { this.textContent = value },
      }),
    },
  })

  const segments = parseTranscript('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello\n\n01:02:03.900 --> 01:02:05.000\nWorld')
  assert.deepEqual(Array.from(segments, ({ text, timestamp }) => ({ text, timestamp })), [
    { text: 'Hello', timestamp: 't1' },
    { text: 'World', timestamp: 't3723' },
  ])
})

test('transcript rows only rerender when their cue or active state changes', () => {
  assert.match(transcriptSource, /v-memo="\[segment, segment\.index === activeSegmentIndex\]"/)
  assert.match(transcriptSource, /\{\{ segment\.timestamp \}\}/)
})

test('hidden side panels receive the playback time in whole seconds', () => {
  assert.doesNotMatch(watchTemplate, /:current-time="currentTime"/)
  assert.equal(watchTemplate.match(/:current-time="showTranscript \? currentTime : liveChatCurrentTime"/g)?.length, 2)
})
