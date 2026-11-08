import assert from 'node:assert/strict'
import test from 'node:test'
import { COLLAPSE_SPRING, createSpring, createVelocityTracker, EXPAND_SPRING } from '../../src/renderer/components/ft-shaka-video-player/opentubex/spring.js'

const frames = spring => Array.from({ length: 60 }, (_, index) => spring.at(index * 16))
const restTime = spring => {
  let elapsed = 0
  while (!spring.done(elapsed)) elapsed += 1
  return elapsed
}

test('docking glides from rest into the bar without overshooting', () => {
  const spring = createSpring(0, 1, 0, COLLAPSE_SPRING)
  const values = frames(spring)
  assert.equal(values[0], 0)
  assert.ok(values[1] < 0.05, 'A large surface starts gently instead of jumping')
  assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]))
  assert.ok(values.every(value => value <= 1))
  assert.ok(Math.abs(restTime(spring) - 690) < 30)
})

test('returning to Watch is quicker than docking and never overshoots', () => {
  const expand = createSpring(1, 0, 0, EXPAND_SPRING)
  const collapse = createSpring(1, 0, 0, COLLAPSE_SPRING)
  assert.ok(expand.at(150) < collapse.at(150))
  assert.ok(restTime(expand) < restTime(collapse) * 0.7)
  assert.ok(frames(expand).every(value => value >= 0))
})

test('an underdamped spring comes to rest when it reaches its target', () => {
  const spring = createSpring(0, 1, 0, { stiffness: 300, damping: 0.5 })
  const arrival = restTime(spring)
  assert.ok(spring.at(arrival - 1) < 1)
  assert.equal(spring.at(arrival), 1)
  assert.ok(frames(spring).every(value => value <= 1))
})

test('a release keeps the finger velocity and arrives sooner without overshooting', () => {
  const rest = createSpring(0.4, 1, 0, COLLAPSE_SPRING)
  const fling = createSpring(0.4, 1, 0.004, COLLAPSE_SPRING)
  assert.ok(Math.abs((fling.at(1) - fling.at(0)) - 0.004) < 0.0002, 'The settle continues at the release speed')
  assert.ok(fling.at(100) > rest.at(100))
  // Close to the endpoint, a fast fling keeps its full speed and stops there.
  const near = createSpring(0.9, 1, 0.004, COLLAPSE_SPRING)
  assert.ok(Math.abs((near.at(1) - near.at(0)) - 0.004) < 0.0002)
  assert.ok(frames(near).every(value => value <= 1))
  assert.equal(near.done(restTime(near)), true)
  assert.ok(near.at(restTime(near)) > 0.997)
  assert.ok(restTime(near) < 60)
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
