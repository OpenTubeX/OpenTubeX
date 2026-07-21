import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptLegacySyncDocument,
  decryptSyncDocument,
  preparePrivacyKey,
} from '../../src/renderer/helpers/sync-server-privacy.js'

const additionalData = new TextEncoder().encode('OpenTubeX encrypted sync v1')

function bytesToBase64 (bytes) {
  return Buffer.from(bytes).toString('base64')
}

async function encryptLegacyDocument (document, privacy) {
  const key = await crypto.subtle.importKey(
    'raw',
    Buffer.from(privacy.key, 'base64'),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(document))
  const plaintext = new Uint8Array(64 * 1024)
  plaintext.fill(0x20)
  plaintext.set(encoded)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    plaintext
  )
  return JSON.stringify({
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 600000,
      salt: privacy.salt,
    },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  })
}

test('decrypts the original single-document encrypted sync format', async () => {
  const passphrase = 'legacy-privacy-passphrase'
  const privacy = await preparePrivacyKey(null, passphrase)
  const document = {
    version: 1,
    subscriptions: [{ id: 'UC-test' }],
    playlists: [],
    history: [],
    playbackSpeeds: [],
    subscriptionGroups: [],
    playlistBookmarks: [],
  }
  const payload = await encryptLegacyDocument(document, privacy)

  assert.deepEqual(
    await decryptLegacySyncDocument(payload, privacy.key),
    document
  )
  await assert.doesNotReject(() => preparePrivacyKey(payload, passphrase))
  await assert.rejects(
    () => decryptSyncDocument(payload, privacy.key),
    /corrupted sync data/
  )
})
