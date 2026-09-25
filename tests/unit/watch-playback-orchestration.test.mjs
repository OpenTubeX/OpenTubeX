import assert from 'node:assert/strict'
import test from 'node:test'
import { createWatchPlaybackOrchestration } from '../../src/renderer/views/Watch/watchPlaybackOrchestration.js'

test('watch playback orchestration preserves format selection and unavailable feedback', () => {
  const toasts = []
  const methods = createWatchPlaybackOrchestration({
    supportsYtDlp: true,
    showToast: toast => toasts.push(toast),
  })
  const view = { ...methods, activeFormat: 'legacy', dashFormatAvailable: true, audioFormatAvailable: false, t: key => key }
  view.handleFormatChange('dash')
  assert.equal(view.activeFormat, 'dash')
  view.handleFormatChange('audio')
  assert.equal(view.activeFormat, 'dash')
  assert.equal(toasts[0].message, 'Change Format.Audio formats are not available for this video')
})
