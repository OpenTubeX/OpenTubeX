import assert from 'node:assert/strict'
import test from 'node:test'
import { canRendererWriteSetting } from '../../src/main/settingWriteGuard.js'

test('the renderer can reset but not set paths that only native pickers choose', () => {
  for (const settingId of ['ytDlpPath', 'ytDlpFfmpegPath', 'externalPlayerExecutable', 'ytDlpDownloadFolderPath']) {
    assert.equal(canRendererWriteSetting(settingId, '/bin/sh'), false, settingId)
    assert.equal(canRendererWriteSetting(settingId, ['/bin/sh']), false, settingId)
    assert.equal(canRendererWriteSetting(settingId, ''), true, settingId)
  }
  for (const settingId of ['screenshotFolderPath', 'scheduledBackupFolderPath', 'scheduledBackupStatus']) {
    assert.equal(canRendererWriteSetting(settingId, ''), false, settingId)
  }
  assert.equal(canRendererWriteSetting('ytDlpSource', 'system'), true)
  assert.equal(canRendererWriteSetting(undefined, ''), false)
})
