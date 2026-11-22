import assert from 'node:assert/strict'
import test from 'node:test'

import { getMatchingDownloadValidators } from '../../src/main/ytDlpAsset.js'

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
  assert.deepEqual(getMatchingDownloadValidators({ ...validators, signedAt: 1792619636 }, genericSource, 'stable'), {
    etag: 'etag',
    lastModified: 'date',
    signedAt: 1792619636
  })
})
