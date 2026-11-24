import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const transcriptSource = readFileSync(new URL('../../src/renderer/components/WatchVideoTranscript/WatchVideoTranscript.vue', import.meta.url), 'utf8')

function sliceFunction(name) {
  const start = transcriptSource.indexOf(`function ${name}(`)
  return transcriptSource.slice(start, transcriptSource.indexOf('\n}\n', start) + 2)
}

function sliceConstant(name) {
  const start = transcriptSource.indexOf(`const ${name} =`)
  return transcriptSource.slice(start, transcriptSource.indexOf('\n', start) + 1)
}

function loadParseTranscript() {
  const parsedMarkup = []
  const source = [
    sliceConstant('CUE_STYLE_TAG'),
    ...['formatTimestamp', 'parseTranscript', 'normalizeRollingCaptions', 'removeOverlappingPrefix', 'parseTimestamp', 'cleanCaptionText']
      .map(sliceFunction),
  ].join('\n')
  const parseTranscript = vm.runInNewContext(`${source}\nparseTranscript`, {
    formatDurationAsTimestamp: seconds => `t${seconds}`,
    DOMParser: class {
      parseFromString(markup) {
        parsedMarkup.push(markup)
        return { body: { textContent: markup.replaceAll('&amp;', '&') } }
      }
    },
  })
  return { parseTranscript, parsedMarkup }
}

test('transcript cues carry their formatted timestamp from parsing', () => {
  const { parseTranscript } = loadParseTranscript()
  const segments = parseTranscript('WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello\n\n01:02:03.900 --> 01:02:05.000\nWorld')
  assert.deepEqual(Array.from(segments, ({ text, timestamp }) => ({ text, timestamp })), [
    { text: 'Hello', timestamp: 't1' },
    { text: 'World', timestamp: 't3723' },
  ])
})

test('styled transcript cues skip the HTML parser, other markup does not', () => {
  const { parseTranscript, parsedMarkup } = loadParseTranscript()
  // Long auto-generated tracks have thousands of cues like the first two.
  const segments = parseTranscript([
    'WEBVTT',
    '00:00:01.000 --> 00:00:03.000 align:start position:0%\n \n<00:00:01.200><c> first</c><00:00:01.600><c> words</c>',
    '00:00:03.000 --> 00:00:05.000 align:start position:0%\nfirst words\n<00:00:03.400><c.colorE5E5E5> more</c>',
    '00:00:05.000 --> 00:00:07.000\n<v Speaker Name><i title="a>b">Said</i> <font color="#ffffff">this</font></v>',
    '00:00:07.000 --> 00:00:09.000\nSalt &amp; pepper',
  ].join('\n\n'))

  assert.deepEqual(Array.from(segments, ({ text }) => text), ['first words', 'more', 'Said this', 'Salt & pepper'])
  assert.deepEqual(parsedMarkup, ['Salt &amp; pepper'])
})
