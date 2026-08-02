import assert from 'node:assert/strict'
import test from 'node:test'

import { getMatchingDownloadValidators, getYtDlpAssetName } from '../../src/main/ytDlpAsset.js'

test('uses self-contained yt-dlp executables where available', () => {
  assert.equal(getYtDlpAssetName('win32', 'x64'), 'yt-dlp.exe')
  assert.equal(getYtDlpAssetName('darwin', 'arm64'), 'yt-dlp_macos')
  assert.equal(getYtDlpAssetName('linux', 'x64'), 'yt-dlp_linux')
  assert.equal(getYtDlpAssetName('linux', 'arm64'), 'yt-dlp_linux_aarch64')
  assert.equal(getYtDlpAssetName('linux', 'arm'), 'yt-dlp')
})

test('only reuses download validators for the selected asset and channel', () => {
  const genericSource = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  const validators = {
    etag: 'etag',
    lastModified: 'date',
    source: genericSource,
    channel: 'stable'
  }

  assert.deepEqual(getMatchingDownloadValidators(validators, genericSource, 'stable'), {
    etag: 'etag',
    lastModified: 'date'
  })
  assert.equal(getMatchingDownloadValidators(validators, `${genericSource}_linux`, 'stable'), null)
  assert.equal(getMatchingDownloadValidators(validators, `${genericSource}_linux_aarch64`, 'stable'), null)
  assert.equal(getMatchingDownloadValidators(validators, genericSource, 'nightly'), null)
  assert.equal(getMatchingDownloadValidators({ ...validators, source: undefined }, genericSource, 'stable'), null)
})
