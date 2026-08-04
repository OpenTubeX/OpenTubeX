import assert from 'node:assert/strict'
import test from 'node:test'

class FakeElement {
  constructor ({ feed = false, managed = false, timeout = false } = {}) {
    this.feed = feed
    this.managed = managed
    this.timeout = timeout
  }

  matches () {
    return this.feed
  }

  closest () {
    return this.managed || this.timeout ? this : null
  }
}

globalThis.Element = FakeElement

const activeAnimations = []
globalThis.document = {
  addEventListener () {},
  getAnimations () {
    return activeAnimations
  }
}

const {
  getAnimationSpeedMultiplier,
  setAnimationSpeed
} = await import('../../src/renderer/helpers/animationSpeed.js')

test('clamps animation speed to the supported range', () => {
  assert.equal(getAnimationSpeedMultiplier(10), 0.25)
  assert.equal(getAnimationSpeedMultiplier(25), 0.25)
  assert.equal(getAnimationSpeedMultiplier(100), 1)
  assert.equal(getAnimationSpeedMultiplier(200), 2)
  assert.equal(getAnimationSpeedMultiplier(300), 2)
  assert.equal(getAnimationSpeedMultiplier(0), 1)
  assert.equal(getAnimationSpeedMultiplier(Number.NaN), 1)
})

test('does not rescale animations with speed-managed timing', () => {
  const playbackRates = []
  const animation = target => ({
    effect: { target },
    updatePlaybackRate (rate) {
      playbackRates.push(rate)
    }
  })

  activeAnimations.push(
    animation(new FakeElement()),
    animation(new FakeElement({ feed: true })),
    animation(new FakeElement({ managed: true })),
    animation(new FakeElement({ timeout: true }))
  )

  setAnimationSpeed(300)

  assert.deepEqual(playbackRates, [2])
})
