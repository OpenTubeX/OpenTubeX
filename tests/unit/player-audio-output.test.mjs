import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, shallowRef } from 'vue'

import { usePlayerAudioOutput } from '../../src/renderer/components/ft-shaka-video-player/opentubex/usePlayerAudioOutput.js'
import { sanitizeVolumeBoost, VOLUME_BOOST_LEVELS } from '../../src/renderer/helpers/player/volumeBoost.js'

class FakeAudioNode {
  constructor () {
    /** @type {FakeAudioNode[]} */
    this.connections = []
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

class FakeAudioContext {
  constructor () {
    this.currentTime = 0
    this.destination = new FakeAudioNode()
    this.sources = []
    this.closed = false
    FakeAudioContext.instances.push(this)
  }

  async resume () {}

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

  const element = { tagName: 'VIDEO' }
  const mounted = mountAudioOutput(shallowRef(element))

  // Unity gain leaves the element's audio untouched.
  await mounted.output.setGain('boost', 1)
  assert.equal(FakeAudioContext.instances.length, 0)

  await mounted.output.setGain('voiceOver', 0.1)
  await mounted.output.setGain('boost', 1.5)

  const [context] = FakeAudioContext.instances
  assert.equal(FakeAudioContext.instances.length, 1)
  assert.equal(context.sources.length, 1)
  assert.equal(context.sources[0].element, element)

  const [voiceOver] = context.sources[0].connections
  const [boost] = voiceOver.connections
  assert.deepEqual(boost.connections, [context.destination])
  assert.equal(voiceOver.gain.value, 0.1)
  assert.equal(boost.gain.value, 1.5)

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

  // The player sets its tab's boost before the video element mounts.
  await output.setGain('boost', 2)
  assert.equal(FakeAudioContext.instances.length, 0)

  video.value = { tagName: 'VIDEO' }
  await output.setGain('voiceOver', 0.5)

  const [voiceOver] = FakeAudioContext.instances[0].sources[0].connections
  const [boost] = voiceOver.connections
  assert.equal(voiceOver.gain.value, 0.5)
  assert.equal(boost.gain.value, 2)
})

test('volume boost only accepts offered levels', () => {
  assert.equal(VOLUME_BOOST_LEVELS[0], 1)
  assert.equal(sanitizeVolumeBoost(1.5), 1.5)
  assert.equal(sanitizeVolumeBoost(10), 1)
  assert.equal(sanitizeVolumeBoost('1.5'), 1)
  assert.equal(sanitizeVolumeBoost(undefined), 1)
})
