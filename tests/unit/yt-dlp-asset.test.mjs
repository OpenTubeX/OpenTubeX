import assert from 'node:assert/strict'
import test from 'node:test'

import { getYtDlpAssetName } from '../../src/main/ytDlpAsset.js'

test('uses self-contained yt-dlp executables where available', () => {
  assert.equal(getYtDlpAssetName('win32', 'x64'), 'yt-dlp.exe')
  assert.equal(getYtDlpAssetName('darwin', 'arm64'), 'yt-dlp_macos')
  assert.equal(getYtDlpAssetName('linux', 'x64'), 'yt-dlp_linux')
  assert.equal(getYtDlpAssetName('linux', 'arm64'), 'yt-dlp_linux_aarch64')
  assert.equal(getYtDlpAssetName('linux', 'arm'), 'yt-dlp')
})
