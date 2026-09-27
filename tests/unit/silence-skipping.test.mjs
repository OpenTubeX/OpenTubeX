import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, ref } from 'vue'

import {
  createRequestPresentationTracker,
  releaseAnalysisSegmentsBefore,
  useSilenceSkipping
} from '../../src/renderer/components/ft-shaka-video-player/opentubex/useSilenceSkipping.js'

test('rejects late responses from an earlier presentation', () => {
  const tracker = createRequestPresentationTracker()
  const previousRequest = {}
  const currentRequest = {}

  tracker.beginRequest(previousRequest)
  tracker.reset()
  tracker.beginRequest(currentRequest)

  assert.equal(tracker.isCurrent(previousRequest), false)
  assert.equal(tracker.isCurrent(currentRequest), true)
})

function analysisFixture (t, { standard = false, managed = false } = {}) {
  const previous = Object.fromEntries(['MediaSource', 'ManagedMediaSource', 'document'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const sources = []
  const audioElements = []
  class Source extends EventTarget {
    static isTypeSupported (type) { return type === 'audio/mp4; codecs="mp4a.40.2"' }
    constructor () {
      super()
      this.readyState = 'closed'
      sources.push(this)
    }
  }
  class ManagedSource extends Source {}
  globalThis.MediaSource = standard ? Source : undefined
  globalThis.ManagedMediaSource = managed ? ManagedSource : undefined
  globalThis.document = {
    createElement (tag) {
      assert.equal(tag, 'audio')
      const audio = Object.assign(new EventTarget(), { pause () {}, load () {}, removeAttribute () {} })
      audioElements.push(audio)
      return audio
    },
  }
  t.mock.method(URL, 'createObjectURL', () => 'blob:analysis-fixture')
  t.mock.method(URL, 'revokeObjectURL', () => {})
  let analysis
  const renderer = createRenderer({ createComment: () => ({}), insert () {}, remove () {}, parentNode () {}, nextSibling () {} })
  const app = renderer.createApp({
    setup () {
      analysis = useSilenceSkipping({ available: ref(true), enabled: ref(true), isLive: ref(false), video: ref(null), setCurrentTime () {} })
      return () => null
    },
  })
  app.mount({})
  t.after(() => {
    app.unmount()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  function response (segment) {
    const context = { stream: { id: 1, type: 'audio', mimeType: 'audio/mp4', codecs: 'mp4a.40.2' }, segment }
    analysis.handleSegmentRequest(context)
    analysis.handleSegmentResponse({ data: new Uint8Array([1, 2, 3]).buffer }, context)
  }
  return { sources, audioElements, Source, ManagedSource, feed () { response(); response({ startTime: 0, endTime: 5 }) } }
}

test('managed-only media support does not break the main player response filter', t => {
  const f = analysisFixture(t, { managed: true })
  assert.doesNotThrow(() => f.feed())
  assert.equal(f.sources.length, 0)
  assert.equal(f.audioElements.length, 0)
})

test('keeps using MediaSource when both media source APIs are available', t => {
  const f = analysisFixture(t, { standard: true, managed: true })
  f.feed()
  assert.equal(f.sources.length, 1)
  assert.equal(f.sources[0].constructor, f.Source)
})

test('unsupported media source APIs do not break the main player response filter', t => {
  const f = analysisFixture(t)
  assert.doesNotThrow(() => f.feed())
  assert.equal(f.sources.length, 0)
  assert.equal(f.audioElements.length, 0)
})

test('does not relabel a retried request after the presentation changes', () => {
  const tracker = createRequestPresentationTracker()
  const retriedRequest = {}

  tracker.beginRequest(retriedRequest)
  tracker.reset()
  tracker.beginRequest(retriedRequest)

  assert.equal(tracker.isCurrent(retriedRequest), false)
})

test('allows evicted analysis segments to be queued again after a backward seek', () => {
  const initSegment = { end: Number.NEGATIVE_INFINITY, key: 'init' }
  const evictedSegment = { end: 20, key: 'old' }
  const retainedSegment = { end: 50, key: 'current' }
  const analysisSegments = new Map([
    [initSegment.key, initSegment],
    [evictedSegment.key, evictedSegment],
    [retainedSegment.key, retainedSegment]
  ])
  const appendQueue = [evictedSegment, retainedSegment]

  releaseAnalysisSegmentsBefore(analysisSegments, appendQueue, 30)

  assert.deepEqual([...analysisSegments.keys()], ['init', 'current'])
  assert.deepEqual(appendQueue, [retainedSegment])
})
