import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'

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

function analysisFixture (t, { standard = false, managed = false, enabled = true } = {}) {
  const previous = Object.fromEntries(['MediaSource', 'ManagedMediaSource', 'AudioContext', 'document'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const sources = []
  const audioElements = []
  const appended = []
  class Source extends EventTarget {
    static isTypeSupported (type) { return type === 'audio/mp4; codecs="mp4a.40.2"' }
    constructor () {
      super()
      this.readyState = 'closed'
      sources.push(this)
    }

    addSourceBuffer () {
      const buffer = Object.assign(new EventTarget(), {
        updating: false,
        appendBuffer (data) {
          appended.push([...new Uint8Array(data)])
          queueMicrotask(() => buffer.dispatchEvent(new Event('updateend')))
        },
      })
      return buffer
    }
  }
  const node = () => ({ connect () {}, disconnect () {} })
  globalThis.AudioContext = class {
    destination = {}
    resume () { return Promise.resolve() }
    close () { return Promise.resolve() }
    createMediaElementSource = node
    createGain = () => ({ ...node(), gain: { value: 1 } })
    createChannelSplitter = () => ({ ...node(), numberOfOutputs: 2 })
    createAnalyser = () => ({ ...node(), fftSize: 32 })
  }
  class ManagedSource extends Source {}
  globalThis.MediaSource = standard ? Source : undefined
  globalThis.ManagedMediaSource = managed ? ManagedSource : undefined
  globalThis.document = {
    createElement (tag) {
      assert.equal(tag, 'audio')
      const audio = Object.assign(new EventTarget(), { buffered: { length: 0 }, pause () {}, load () {}, removeAttribute () {} })
      audioElements.push(audio)
      return audio
    },
  }
  t.mock.method(URL, 'createObjectURL', () => 'blob:analysis-fixture')
  t.mock.method(URL, 'revokeObjectURL', () => {})
  let analysis
  const enabledRef = ref(enabled)
  const renderer = createRenderer({ createComment: () => ({}), insert () {}, remove () {}, parentNode () {}, nextSibling () {} })
  const app = renderer.createApp({
    setup () {
      analysis = useSilenceSkipping({ enabled: enabledRef, isLive: ref(false), video: ref(null), setCurrentTime () {} })
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
  function response (segment, bytes = [1, 2, 3]) {
    const context = { stream: { id: 1, type: 'audio', mimeType: 'audio/mp4', codecs: 'mp4a.40.2' }, segment }
    analysis.handleSegmentRequest(context)
    analysis.handleSegmentResponse({ data: new Uint8Array(bytes).buffer }, context)
  }
  async function openSource (index = 0) {
    sources[index].readyState = 'open'
    sources[index].dispatchEvent(new Event('sourceopen'))
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  }
  return {
    sources,
    audioElements,
    appended,
    enabled: enabledRef,
    response,
    openSource,
    Source,
    ManagedSource,
    feed () { response(); response({ startTime: 0, endTime: 5 }) }
  }
}

test('analyses the captured audio while skipping is enabled', async t => {
  const f = analysisFixture(t, { standard: true })
  f.response(undefined, [9])
  f.response({ startTime: 0, endTime: 5 }, [1])
  await f.openSource()
  assert.deepEqual(f.appended, [[9], [1]])
})

test('does not copy media segments while skipping is disabled', async t => {
  const f = analysisFixture(t, { standard: true, enabled: false })
  f.response(undefined, [9])
  f.response({ startTime: 0, endTime: 5 }, [1])
  assert.equal(f.sources.length, 0)

  // Enabling mid-playback starts the analysis from the next segment.
  f.enabled.value = true
  await nextTick()
  assert.equal(f.sources.length, 1)
  f.response({ startTime: 5, endTime: 10 }, [2])
  await f.openSource()
  assert.deepEqual(f.appended, [[9], [2]])
})

test('drops captured media segments when skipping is disabled', async t => {
  const f = analysisFixture(t, { standard: true })
  f.response(undefined, [9])
  f.response({ startTime: 0, endTime: 5 }, [1])
  f.enabled.value = false
  await nextTick()
  f.enabled.value = true
  await nextTick()
  assert.equal(f.sources.length, 2)
  await f.openSource(1)
  assert.deepEqual(f.appended, [[9]])
})

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
