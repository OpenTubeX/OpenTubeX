import assert from 'node:assert/strict'
import test from 'node:test'

import { bindIosAutoPictureInPicture, isEnteringIosPictureInPicture } from '../../src/renderer/helpers/player/iosAutoPictureInPicture.js'

for (const [name, enabled, paused, ended, mode, supported, expected] of [
  ['playing active video', true, false, false, 'inline', true, 1],
  ['paused', true, true, false, 'inline', true, 0],
]) {
  test(`native resignation enters iOS PiP only for ${name}`, () => {
    const target = new EventTarget()
    const calls = []
    const video = Object.assign(new EventTarget(), {
      paused,
      ended,
      webkitPresentationMode: mode,
      webkitSupportsPresentationMode: () => supported,
      webkitSetPresentationMode: mode => calls.push(mode),
    })
    const cleanup = bindIosAutoPictureInPicture({ getVideo: () => video, isEnabled: () => enabled, target })
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected)
    // WebKit still reports inline, so a background audio switch must see the request.
    assert.equal(isEnteringIosPictureInPicture(video), expected === 1)
    video.dispatchEvent(new Event('webkitpresentationmodechanged'))
    assert.equal(isEnteringIosPictureInPicture(video), false)
    cleanup()
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected, 'teardown removes the native listener')
  })
}
