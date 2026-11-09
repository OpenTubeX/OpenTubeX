import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpring, createVelocityTracker, EXPAND_SPRING } from '../../src/renderer/components/ft-shaka-video-player/opentubex/spring.js'

const frames = spring => Array.from({ length: 60 }, (_, index) => spring.at(index * 16))
const restTime = spring => {
  let elapsed = 0
  while (!spring.done(elapsed)) elapsed += 1
  return elapsed
}

test('an underdamped spring comes to rest when it reaches its target', () => {
  const spring = createSpring(0, 1, 0, { stiffness: 300, damping: 0.5 })
  const arrival = restTime(spring)
  assert.ok(spring.at(arrival - 1) < 1)
  assert.equal(spring.at(arrival), 1)
  assert.ok(frames(spring).every(value => value <= 1))
})

test('a release moving away from the target turns around and settles', () => {
  const spring = createSpring(0.6, 0, 0.01, EXPAND_SPRING)
  assert.ok(spring.at(40) > 0.6)
  assert.ok(Math.abs(spring.at(500)) < 0.01)
  assert.equal(spring.done(800), true)
})

test('velocity tracking uses recent samples and ignores a finger that rested before release', () => {
  const tracker = createVelocityTracker()
  tracker.add(0, 0)
  tracker.add(0.1, 100)
  tracker.add(0.2, 150)
  tracker.add(0.4, 200)
  assert.equal(tracker.velocity(200), (0.4 - 0.1) / 100)
  assert.equal(tracker.velocity(300), 0)
  assert.equal(createVelocityTracker().velocity(0), 0)
  // A flick delivered as a single move still has a velocity from where it started.
  const flick = createVelocityTracker(0, 0)
  flick.add(0.2, 16)
  assert.equal(flick.velocity(16), 0.2 / 16)
})
