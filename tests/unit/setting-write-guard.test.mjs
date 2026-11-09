import assert from 'node:assert/strict'
import test from 'node:test'
import { canRendererWriteSetting } from '../../src/main/settingWriteGuard.js'

test('the renderer can reset but not set paths that only native pickers choose', () => {
  for (const settingId of ['ytDlpPath', 'ytDlpFfmpegPath', 'externalPlayerExecutable', 'ytDlpDownloadFolderPath',
    'videoIpBlockScriptPath', 'ytDlpPlaybackCookiesPath']) {
    assert.equal(canRendererWriteSetting(settingId, '/bin/sh'), false, settingId)
    assert.equal(canRendererWriteSetting(settingId, ['/bin/sh']), false, settingId)
    assert.equal(canRendererWriteSetting(settingId, ''), true, settingId)
  }
  for (const settingId of ['externalPlayerApprovedArgs', 'screenshotFolderPath', 'scheduledBackupFolderPath', 'scheduledBackupStatus']) {
    assert.equal(canRendererWriteSetting(settingId, ''), false, settingId)
  }
  assert.equal(canRendererWriteSetting('ytDlpSource', 'system'), true)
  assert.equal(canRendererWriteSetting(undefined, ''), false)
})

test('the renderer can name a browser profile but only the picker can choose its folder', () => {
  for (const name of ['', 'default-release', 'Profile 1']) {
    assert.equal(canRendererWriteSetting('ytDlpPlaybackCookiesBrowserProfile', name), true, name)
  }
  // yt-dlp reads profiles with a separator as paths after expanding ~ and
  // variables, and `::` starts a container name.
  for (const value of ['/home/user/.mozilla/firefox/x', 'C:\\Users\\x', '~', '$HOME', '%APPDATA%', 'default::Work', null]) {
    assert.equal(canRendererWriteSetting('ytDlpPlaybackCookiesBrowserProfile', value), false, String(value))
  }
})
