import assert from 'node:assert/strict'
import test from 'node:test'

import {
  base64ToBytes,
  bytesToBase64,
  canonicalBase64ToBytes,
  base64UrlToBytes,
  bytesToBase64Url,
} from '../../src/renderer/helpers/sync-server-protocol.js'

test('Base64 decoding preserves every byte in large encrypted payloads', () => {
  for (const length of [0, 1, 2, 3, 256, 65_537, 1_048_576]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256)
    const encoded = Buffer.from(bytes).toString('base64')
    assert.deepEqual(base64ToBytes(encoded), bytes)
    assert.equal(bytesToBase64(bytes), encoded)
    if (length > 0) {
      assert.deepEqual(canonicalBase64ToBytes(encoded, length), bytes)
      assert.deepEqual(base64UrlToBytes(bytesToBase64Url(bytes), length), bytes)
    }
  }
})

test('Base64 decoding retains permissive decoding and strict protocol validation', () => {
  assert.deepEqual(base64ToBytes(' Y Q\n'), Uint8Array.of(97))
  for (const value of [null, undefined, 42, {}, '!', 'a', 'Y===']) {
    assert.throws(() => base64ToBytes(value))
  }
  for (const value of ['YQ', 'Y Q==', 'YR==']) {
    assert.throws(() => canonicalBase64ToBytes(value))
  }
  assert.throws(() => canonicalBase64ToBytes('YQ==', 2))
})
