import assert from 'node:assert/strict'
import test from 'node:test'

import { isAppHidden, setAndroidAppVisible } from '../../src/renderer/helpers/appVisibility.js'
import { resolveAndroidBackgroundPlaybackFormat } from '../../src/renderer/helpers/player/androidBackgroundPlayback.js'

test('Android background playback follows Home even when Chromium stays visible for a refresh', () => {
  const originalDocument = globalThis.document
  const document = new EventTarget()
  document.hidden = false
  globalThis.document = document
  const changes = []
  document.addEventListener('visibilitychange', () => { changes.push(isAppHidden()) })
  try {
    setAndroidAppVisible(true)
    setAndroidAppVisible(false)
    assert.equal(isAppHidden(), true)
    assert.deepEqual(resolveAndroidBackgroundPlaybackFormat({
      hidden: isAppHidden(), continuePlayback: true, activeFormat: 'dash',
      audioFormatAvailable: true, paused: false
    }), { activeFormat: 'audio', restoreFormat: 'dash' })

    // Releasing the refresh changes Chromium visibility too, but the activity
    // remains hidden. Returning to the app must still publish a resume event.
    document.hidden = true
    assert.equal(isAppHidden(), true)
    document.hidden = false
    setAndroidAppVisible(true)
    assert.equal(isAppHidden(), false)
    assert.deepEqual(changes, [true, false])

    setAndroidAppVisible(null)
    document.hidden = true
    assert.equal(isAppHidden(), true, 'other platforms use document visibility')
  } finally {
    setAndroidAppVisible(null)
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})
