import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { verifyYtDlpReleaseAsset } from '../../src/main/ytDlpSignature.js'

// SHA2-256SUMS and its signature from the yt-dlp 2026.10.21 release
const checksums = readFileSync(new URL('./fixtures/yt-dlp/SHA2-256SUMS', import.meta.url))
const signature = readFileSync(new URL('./fixtures/yt-dlp/SHA2-256SUMS.sig', import.meta.url))

test('accepts a genuine yt-dlp signature and then compares the asset checksum', () => {
  assert.throws(
    () => verifyYtDlpReleaseAsset(Buffer.from('not yt-dlp'), 'yt-dlp_linux', checksums, signature),
    /does not match its signed checksum/
  )
})

test('rejects a checksum file that differs from the signed one', () => {
  const tampered = Buffer.from(checksums.toString('utf8').replace(/^[\da-f]{64}(?=  yt-dlp_linux$)/m, '0'.repeat(64)))
  assert.notDeepEqual(tampered, checksums)

  assert.throws(
    () => verifyYtDlpReleaseAsset(Buffer.alloc(0), 'yt-dlp_linux', tampered, signature),
    /not signed by the yt-dlp release key/
  )
})

test('rejects malformed or truncated signatures', () => {
  for (const malformed of [Buffer.alloc(0), signature.subarray(0, 100), Buffer.concat([signature, Buffer.from([0])])]) {
    assert.throws(
      () => verifyYtDlpReleaseAsset(Buffer.alloc(0), 'yt-dlp_linux', checksums, malformed),
      /not signed by the yt-dlp release key/
    )
  }
})

test('requires a signed checksum entry for the downloaded asset', () => {
  assert.throws(
    () => verifyYtDlpReleaseAsset(Buffer.alloc(0), 'yt-dlp_unknown', checksums, signature),
    /no entry for yt-dlp_unknown/
  )
})
