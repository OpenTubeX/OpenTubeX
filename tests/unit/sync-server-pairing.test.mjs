import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from '@hpke/core'
import {
  bindPairingRequestToAccount,
  createPairingQrPayload,
  createPairingRecipient,
  decryptPairingKey,
  encryptPairingKey,
  pairingSessionMatchesRequest,
  parsePairingQrPayload,
  randomPairingDeviceId,
  randomPairingVerificationCode,
} from '../../src/renderer/helpers/sync-server-pairing.js'

const ORIGIN = 'https://sync.example.com'
const ACCOUNT_ID = '0198e2d4-8ad2-7f73-8d6e-4f076707ce25'
const PRIVACY = {
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  salt: 'AAECAwQFBgcICQoLDA0ODw==',
  version: 1,
}
const TRANSFER = {
  ...PRIVACY,
  username: 'sync-user',
  token: 'header.payload.signature',
  verificationCode: '042731',
}

const VECTOR_PAYLOAD = 'AXrwPfFZ4tdXUcGojrWp6HmI8Tjc51luvaOtfwuwSoc02gY_WD6GVfCyLGKwYSuknzs_H11knturZTqjsTJrRcQt8oshhSYeR5zmADfHjlxtUOUtbFjE4FXS_YonTthVfWHiloh8tvG4Azunpwg9xCbRkx_yUqT1hHt-x2LNH8YqrdE6i019RuzpbRiUhwqd6mURrvdyDl5nuDJz5GnrrYCE2J4yf74i0V-6Ji-_WLGK2NH_L8apZxPQoshh0sYNiddX75ZcxWVcbAYGLHYdxAZNKR4M9qciId_PomIm4Op2SCCw2NH98YqJ7jD6YDLzHXEpx3K2qFlwCL0IjqzbG5rQbXg6a62l'

async function pairingRequest (deviceName = 'Living room laptop') {
  const recipient = await createPairingRecipient(deviceName)
  const qr = createPairingQrPayload(recipient, ORIGIN)
  const qrRequest = parsePairingQrPayload(qr)
  const request = bindPairingRequestToAccount(qrRequest, ACCOUNT_ID)
  return { recipient, qrRequest, request, qr }
}

test('transfers account authorization and the privacy key with HPKE PSK authentication', async () => {
  const { recipient, request } = await pairingRequest()
  const approvingDeviceId = randomPairingDeviceId()
  const payload = await encryptPairingKey(request, approvingDeviceId, TRANSFER)

  const received = await decryptPairingKey(
    request,
    approvingDeviceId,
    recipient.recipientKey,
    payload
  )

  assert.deepEqual(received, {
    username: TRANSFER.username,
    token: TRANSFER.token,
    ...PRIVACY,
    verificationCode: TRANSFER.verificationCode,
  })
  assert.doesNotMatch(payload, /AAECAwQF/)
  assert.doesNotMatch(payload, /sync-user|header\.payload/)
})

test('decrypts the published protocol v1 interoperability vector', async () => {
  const suite = new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  })
  const recipientIkm = Uint8Array.from(Buffer.from(
    'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    'base64url'
  ))
  const recipientKeyPair = await suite.kem.deriveKeyPair(recipientIkm)
  const request = {
    version: 1,
    origin: ORIGIN,
    sessionId: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
    recipientPublicKey: 'sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs',
    recipientDeviceId: 'MDEyMzQ1Njc4OTo7PD0-Pw',
    recipientDeviceName: 'Vector laptop',
    pairingSecret: 'oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8',
    accountId: ACCOUNT_ID,
  }

  assert.deepEqual(await decryptPairingKey(
    request,
    'QEFCQ0RFRkdISUpLTE1OTw',
    recipientKeyPair.privateKey,
    VECTOR_PAYLOAD
  ), TRANSFER)
})

test('binds the encrypted key to the server, account, session, and both devices', async () => {
  const { recipient, request } = await pairingRequest()
  const approvingDeviceId = randomPairingDeviceId()
  const payload = await encryptPairingKey(request, approvingDeviceId, TRANSFER)
  const tampered = { ...request, sessionId: 'A'.repeat(43) }

  await assert.rejects(
    decryptPairingKey(tampered, approvingDeviceId, recipient.recipientKey, payload),
    /could not be authenticated/
  )
  await assert.rejects(
    decryptPairingKey(request, 'B'.repeat(22), recipient.recipientKey, payload),
    /could not be authenticated/
  )
})

test('rejects a relay response made without the QR-only pairing secret', async () => {
  const { recipient, request } = await pairingRequest()
  const approvingDeviceId = randomPairingDeviceId()
  const payload = await encryptPairingKey(request, approvingDeviceId, TRANSFER)
  const forgedRequest = { ...request, pairingSecret: 'C'.repeat(43) }

  await assert.rejects(
    decryptPairingKey(forgedRequest, approvingDeviceId, recipient.recipientKey, payload),
    /could not be authenticated/
  )
})

test('uses strict versioned QR serialization and HTTPS origins', async () => {
  const { recipient, qr, qrRequest } = await pairingRequest('Büro-Laptop')
  assert.equal(qrRequest.recipientDeviceName, 'Büro-Laptop')
  assert.equal(qrRequest.accountId, undefined)
  assert.equal(qr.includes(recipient.recipientToken), false)
  assert.equal(qr.includes(recipient.recipientTokenHash), false)

  assert.throws(
    () => createPairingQrPayload(recipient, 'http://sync.example.com')
  )
  assert.throws(() => parsePairingQrPayload('https://sync.example.com/pairing?key=secret'))

  const prefix = 'opentubex-pairing:'
  const encoded = qr.slice(prefix.length).replaceAll('-', '+').replaceAll('_', '/')
  const parsed = JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)))
  parsed.unexpected = true
  const malformed = prefix + btoa(JSON.stringify(parsed))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  assert.throws(() => parsePairingQrPayload(malformed), /not a valid OpenTubeX pairing code/)
})

test('matches an authenticated server session against every QR relay field', async () => {
  const { qrRequest, request } = await pairingRequest()
  const session = {
    version: 1,
    id: request.sessionId,
    account_id: null,
    recipient_public_key: request.recipientPublicKey,
    recipient_device_id: request.recipientDeviceId,
    recipient_device_name: request.recipientDeviceName,
    approving_device_id: null,
    approved: false,
    expires_at: Date.now() + 60000,
  }

  assert.equal(pairingSessionMatchesRequest(session, qrRequest), true)
  assert.equal(pairingSessionMatchesRequest({
    ...session,
    account_id: request.accountId,
    approving_device_id: randomPairingDeviceId(),
    approved: true,
  }, request, true), true)
  assert.equal(pairingSessionMatchesRequest({ ...session, account_id: crypto.randomUUID() }, qrRequest), false)
  assert.equal(pairingSessionMatchesRequest({ ...session, approved: true }, request), false)
  assert.equal(pairingSessionMatchesRequest({ ...session, unexpected: true }, request), false)
  assert.equal(pairingSessionMatchesRequest({ ...session, expires_at: Date.now() - 1 }, request), false)
})

test('creates fixed-width numeric verification codes', () => {
  for (let index = 0; index < 100; index++) {
    assert.match(randomPairingVerificationCode(), /^\d{6}$/)
  }
})
