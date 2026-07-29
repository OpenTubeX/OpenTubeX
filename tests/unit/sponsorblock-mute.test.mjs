import assert from 'node:assert/strict'
import test from 'node:test'

import { createSponsorBlockMuteController } from '../../src/renderer/helpers/player/sponsorBlockMute.js'

test('temporarily mutes while SponsorBlock sources are active', () => {
  let muted = false
  const controller = createSponsorBlockMuteController({
    getMuted: () => muted,
    setMuted: value => { muted = value }
  })

  controller.setSourceActive('segment', true)
  assert.equal(muted, true)
  assert.equal(controller.handleVolumeChange(), true)

  controller.setSourceActive('preview', true)
  controller.setSourceActive('segment', false)
  assert.equal(muted, true)

  controller.setSourceActive('preview', false)
  assert.equal(muted, false)
})

test('preserves a user mute override after the segment', () => {
  let muted = false
  const controller = createSponsorBlockMuteController({
    getMuted: () => muted,
    setMuted: value => { muted = value }
  })

  controller.setSourceActive('segment', true)
  controller.handleVolumeChange()
  muted = false
  assert.equal(controller.handleVolumeChange(), false)

  controller.setSourceActive('segment', false)
  assert.equal(muted, false)
})

test('can reapply mute after a user override', () => {
  let muted = false
  const controller = createSponsorBlockMuteController({
    getMuted: () => muted,
    setMuted: value => { muted = value }
  })

  controller.setSourceActive('segment', true)
  controller.handleVolumeChange()
  muted = false
  controller.handleVolumeChange()

  controller.enforceMuted()
  assert.equal(muted, true)
  controller.handleVolumeChange()

  controller.setSourceActive('segment', false)
  assert.equal(muted, false)
})
