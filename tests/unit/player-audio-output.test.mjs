import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, shallowRef } from 'vue'
import { FormatUtils, Misc } from 'youtubei.js'

import { usePlayerAudioOutput } from '../../src/renderer/components/ft-shaka-video-player/opentubex/usePlayerAudioOutput.js'
import { getAudioFormatLoudness, getLoudnessNormalizationGain } from '../../src/renderer/helpers/player/loudnessNormalization.js'
import { getSabrFormatId } from '../../src/renderer/helpers/player/formatIds.js'

class FakeAudioNode {
  constructor () {
    /** @type {FakeAudioNode[]} */
    this.connections = []
    this.channelCount = 2
    this.channelCountMode = 'max'
  }

  connect (node) {
    this.connections.push(node)
    return node
  }
}

class FakeGainNode extends FakeAudioNode {
  constructor () {
    super()
    this.gain = {
      value: 1,
      cancelScheduledValues () {},
      setTargetAtTime (value) {
        this.value = value
      },
    }
  }
}

class FakeAudioContext extends EventTarget {
  constructor () {
    super()
    this.state = 'running'
    this.resumeCount = 0
    this.currentTime = 0
    this.destination = new FakeAudioNode()
    this.sources = []
    this.closed = false
    FakeAudioContext.instances.push(this)
  }

  async resume () {
    this.resumeCount++
    this.state = 'running'
  }

  async close () {
    this.closed = true
  }

  createMediaElementSource (element) {
    const source = new FakeAudioNode()
    source.element = element
    this.sources.push(source)
    return source
  }

  createGain () {
    return new FakeGainNode()
  }
}

FakeAudioContext.instances = []

function createVideo () {
  return Object.assign(new EventTarget(), { tagName: 'VIDEO', paused: false })
}

function getGraph (context) {
  const [voiceOver] = context.sources[0].connections
  const [boost] = voiceOver.connections
  const [loudness] = boost.connections
  const [mono] = loudness.connections
  return { voiceOver, boost, loudness, mono }
}

function mountAudioOutput (video) {
  let output
  const renderer = createRenderer({ createComment: () => ({}), insert () {}, remove () {}, parentNode () {}, nextSibling () {} })
  const app = renderer.createApp({
    setup () {
      output = usePlayerAudioOutput(video)
      return () => null
    },
  })
  app.mount({})
  return { output, unmount: () => app.unmount() }
}

test('player audio stages share one media element source', async (t) => {
  const OriginalAudioContext = globalThis.AudioContext
  globalThis.AudioContext = FakeAudioContext
  FakeAudioContext.instances = []
  t.after(() => {
    globalThis.AudioContext = OriginalAudioContext
  })

  const element = createVideo()
  const mounted = mountAudioOutput(shallowRef(element))

  // Unity gain leaves the element's audio untouched.
  await mounted.output.setGain('boost', 1)
  assert.equal(FakeAudioContext.instances.length, 0)

  await mounted.output.setGain('voiceOver', 0.1)
  await mounted.output.setGain('boost', 1.5)
  await mounted.output.setGain('loudness', 0.5)

  const [context] = FakeAudioContext.instances
  assert.equal(FakeAudioContext.instances.length, 1)
  assert.equal(context.sources.length, 1)
  assert.equal(context.sources[0].element, element)

  const { voiceOver, boost, loudness, mono } = getGraph(context)
  assert.deepEqual(mono.connections, [context.destination])
  assert.equal(mono.channelCountMode, 'max')
  assert.equal(voiceOver.gain.value, 0.1)
  assert.equal(boost.gain.value, 1.5)
  assert.equal(loudness.gain.value, 0.5)

  await mounted.output.setGain('voiceOver', 1)
  assert.equal(voiceOver.gain.value, 1)
  assert.equal(boost.gain.value, 1.5)
  assert.equal(context.sources.length, 1)

  mounted.unmount()
  assert.equal(context.closed, true)
})

test('stage values set before the graph exists apply when it is built', async (t) => {
  const OriginalAudioContext = globalThis.AudioContext
  globalThis.AudioContext = FakeAudioContext
  FakeAudioContext.instances = []
  t.after(() => {
    globalThis.AudioContext = OriginalAudioContext
  })

  const video = shallowRef(null)
  const { output, unmount } = mountAudioOutput(video)
  t.after(unmount)

  // The player sets its tab's boost and mono before the video element mounts.
  await output.setGain('boost', 2)
  await output.setMono(true)
  assert.equal(FakeAudioContext.instances.length, 0)

  video.value = createVideo()
  await output.setGain('voiceOver', 0.5)

  const { voiceOver, boost, mono } = getGraph(FakeAudioContext.instances[0])
  assert.equal(voiceOver.gain.value, 0.5)
  assert.equal(boost.gain.value, 2)
  assert.equal(mono.channelCountMode, 'explicit')
})

test('mono downmixes every channel and plays it in both ears', async (t) => {
  const OriginalAudioContext = globalThis.AudioContext
  globalThis.AudioContext = FakeAudioContext
  FakeAudioContext.instances = []
  t.after(() => {
    globalThis.AudioContext = OriginalAudioContext
  })

  const element = createVideo()
  const { output, unmount } = mountAudioOutput(shallowRef(element))
  t.after(unmount)

  // Leaving mono off keeps the element's audio untouched.
  await output.setMono(false)
  assert.equal(FakeAudioContext.instances.length, 0)

  await output.setMono(true)
  const [context] = FakeAudioContext.instances
  const { mono } = getGraph(context)
  assert.deepEqual(mono.connections, [context.destination])
  assert.equal(mono.channelCount, 1)
  assert.equal(mono.channelCountMode, 'explicit')

  await output.setMono(false)
  assert.equal(mono.channelCountMode, 'max')
  assert.equal(context.sources.length, 1)
})

test('a suspended graph resumes while the video plays', async (t) => {
  const OriginalAudioContext = globalThis.AudioContext
  globalThis.AudioContext = FakeAudioContext
  FakeAudioContext.instances = []
  t.after(() => {
    globalThis.AudioContext = OriginalAudioContext
  })

  const element = createVideo()
  const { output, unmount } = mountAudioOutput(shallowRef(element))
  t.after(unmount)
  await output.setGain('boost', 1.5)
  const [context] = FakeAudioContext.instances
  const resumesAfterSetup = context.resumeCount

  // An audio interruption suspends the context while the media keeps playing.
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(context.resumeCount, resumesAfterSetup + 1)

  // Paused media resumes the graph once it plays again.
  element.paused = true
  context.state = 'suspended'
  context.dispatchEvent(new Event('statechange'))
  assert.equal(context.resumeCount, resumesAfterSetup + 1)
  element.paused = false
  element.dispatchEvent(new Event('playing'))
  assert.equal(context.resumeCount, resumesAfterSetup + 2)
})

test('loudness normalization only turns loud videos down', () => {
  // YouTube reports 6 dB above its target, so the gain halves the amplitude.
  assert.ok(Math.abs(getLoudnessNormalizationGain(6) - 0.501) < 0.001)
  // Quiet videos and videos without loudness information keep their volume.
  assert.equal(getLoudnessNormalizationGain(-4), 1)
  assert.equal(getLoudnessNormalizationGain(null), 1)
  assert.equal(getLoudnessNormalizationGain(Number.NaN), 1)
})

const DRC_XTAGS = 'ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKCgoEbGFuZxICZW4'

test('per-format loudness is keyed by the audio IDs Shaka reports for DASH and SABR', async () => {
  const audio = {
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    bitrate: 130000,
    url: 'https://example.com/audio',
    initRange: { start: '0', end: '600' },
    indexRange: { start: '601', end: '900' },
    approxDurationMs: '1000',
    lastModified: '1700000000000000',
    audioQuality: 'AUDIO_QUALITY_MEDIUM',
    audioTrack: { id: 'en.4', displayName: 'English', audioIsDefault: true },
  }
  const formats = [
    new Misc.Format({ ...audio, loudnessDb: 7.33, xtags: 'ChEKBWFjb250EghvcmlnaW5hbAoKCgRsYW5nEgJlbg' }),
    new Misc.Format({ ...audio, loudnessDb: 0, isDrc: true, xtags: DRC_XTAGS }),
    new Misc.Format({ ...audio, loudnessDb: -0.2, audioTrack: { id: 'de.3', displayName: 'German', audioIsDefault: false }, xtags: 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZGU' }),
  ]

  const loudness = getAudioFormatLoudness(formats, true)
  const dash = await FormatUtils.toDash({ adaptive_formats: formats })
  const dashIds = [...dash.matchAll(/<Representation id="([^"]+)"/g)].map(([, id]) => id)
  assert.deepEqual(dashIds.map(id => loudness[id]), [7.33, 0, -0.2])
  assert.equal(loudness[getSabrFormatId({ itag: 140, lastModified: audio.lastModified, xtags: DRC_XTAGS })], 0)

  // Without the flag, YouTube's player uses the video's loudness for every track
  assert.deepEqual(getAudioFormatLoudness(formats, false), {})
})
