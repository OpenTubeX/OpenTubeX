import assert from 'node:assert/strict'
import test from 'node:test'

import { bindIosAutoPictureInPicture } from '../../src/renderer/helpers/player/iosAutoPictureInPicture.js'

for (const [name, enabled, paused, ended, mode, supported, expected] of [
  ['playing active video', true, false, false, 'inline', true, 1],
  ['paused', true, true, false, 'inline', true, 0],
]) {
  test(`native resignation enters iOS PiP only for ${name}`, () => {
    const target = new EventTarget()
    const calls = []
    const video = {
      paused,
      ended,
      webkitPresentationMode: mode,
      webkitSupportsPresentationMode: () => supported,
      webkitSetPresentationMode: mode => calls.push(mode),
    }
    const cleanup = bindIosAutoPictureInPicture({ getVideo: () => video, isEnabled: () => enabled, target })
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected)
    cleanup()
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected, 'teardown removes the native listener')
  })
}
