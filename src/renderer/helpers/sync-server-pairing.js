import {
  Aes256Gcm,
  CipherSuite,
  DhkemX25519HkdfSha256,
  HkdfSha256,
} from '@hpke/core'
import {
  base64UrlToBytes,
  base64UrlToStandardBase64,
  bytesToBase64Url,
  isCanonicalBase64Url,
  randomBase64Url,
  standardBase64ToBase64Url,
  validateSyncServerDeviceName,
} from './sync-server-protocol.js'

export const PAIRING_PROTOCOL_VERSION = 1
export const PAIRING_QR_PREFIX = 'opentubex-pairing:'

const SESSION_ID_BYTES = 32
const DEVICE_ID_BYTES = 16
const PAIRING_SECRET_BYTES = 32
const RECIPIENT_TOKEN_BYTES = 32
const X25519_PUBLIC_KEY_BYTES = 32
const AES_256_KEY_BYTES = 32
const PRIVACY_SALT_BYTES = 16
const MAX_ORIGIN_LENGTH = 512
const MAX_QR_LENGTH = 2048
const MAX_USERNAME_BYTES = 512
const MAX_TOKEN_LENGTH = 4096
const MIN_ENCRYPTED_PAYLOAD_BYTES = 96
const MAX_ENCRYPTED_PAYLOAD_BYTES = 1536
const HPKE_INFO = new TextEncoder().encode('OpenTubeX key pairing v1')

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
})

const QR_FIELDS = [
  'version',
  'origin',
  'sessionId',
  'recipientPublicKey',
  'recipientDeviceId',
  'recipientDeviceName',
  'pairingSecret',
]
const BOUND_REQUEST_FIELDS = [...QR_FIELDS, 'accountId']
const KEY_FIELDS = [
  'version',
  'username',
  'token',
  'privacyKey',
  'privacySalt',
  'privacyFormat',
  'verificationCode',
]
const SESSION_FIELDS = [
  'version',
  'id',
  'account_id',
  'recipient_public_key',
  'recipient_device_id',
  'recipient_device_name',
  'approving_device_id',
  'expires_at',
  'approved',
]

function hasExactFields(value, fields) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every(field => Object.prototype.hasOwnProperty.call(value, field))
}

function normalizePairingOrigin(origin) {
  let url
  try {
    url = new URL(origin)
  } catch {
    throw new Error()
  }
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname
    .replace(/\/(?:docs|v1)\/?$/, '')
    .replace(/\/$/, '')
  const normalized = url.toString().replace(/\/$/, '')
  if (normalized !== origin || !normalized.startsWith('https://') || normalized.length > MAX_ORIGIN_LENGTH) {
    throw new Error()
  }
  return normalized
}

function validateAccountId(accountId) {
  if (typeof accountId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId)) {
    throw new Error()
  }
  return accountId
}

function validatePairingRequest(request) {
  if (!hasExactFields(request, QR_FIELDS) || request.version !== PAIRING_PROTOCOL_VERSION) {
    throw new Error()
  }
  normalizePairingOrigin(request.origin)
  base64UrlToBytes(request.sessionId, SESSION_ID_BYTES)
  base64UrlToBytes(request.recipientPublicKey, X25519_PUBLIC_KEY_BYTES)
  base64UrlToBytes(request.recipientDeviceId, DEVICE_ID_BYTES)
  validateSyncServerDeviceName(request.recipientDeviceName)
  base64UrlToBytes(request.pairingSecret, PAIRING_SECRET_BYTES)
  return request
}

function validateBoundPairingRequest(request) {
  if (!hasExactFields(request, BOUND_REQUEST_FIELDS)) throw new Error()
  const qrRequest = Object.fromEntries(QR_FIELDS.map(field => [field, request[field]]))
  validatePairingRequest(qrRequest)
  validateAccountId(request.accountId)
  return request
}

function validateUsername(username) {
  if (typeof username !== 'string' || !username || username.trim() !== username) throw new Error()
  if (new TextEncoder().encode(username).length > MAX_USERNAME_BYTES) throw new Error()
  if ([...username].some(character => /\p{Cc}/u.test(character))) throw new Error()
  return username
}

function validateToken(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[\w.-]+$/.test(token)) {
    throw new Error()
  }
  return token
}

function validateVerificationCode(code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error()
  return code
}

function encryptionContext(request, approvingDeviceId) {
  validateBoundPairingRequest(request)
  base64UrlToBytes(approvingDeviceId, DEVICE_ID_BYTES)
  return new TextEncoder().encode(JSON.stringify({
    version: PAIRING_PROTOCOL_VERSION,
    origin: request.origin,
    accountId: request.accountId,
    sessionId: request.sessionId,
    recipientPublicKey: request.recipientPublicKey,
    recipientDeviceId: request.recipientDeviceId,
    approvingDeviceId,
  }))
}

function psk(request) {
  return {
    id: new TextEncoder().encode(request.sessionId),
    key: base64UrlToBytes(request.pairingSecret, PAIRING_SECRET_BYTES),
  }
}

function serializeEncryptedPayload(encapsulatedKey, ciphertext) {
  const enc = new Uint8Array(encapsulatedKey)
  const encrypted = new Uint8Array(ciphertext)
  if (enc.length !== X25519_PUBLIC_KEY_BYTES) throw new Error()
  const payload = new Uint8Array(1 + enc.length + encrypted.length)
  payload[0] = PAIRING_PROTOCOL_VERSION
  payload.set(enc, 1)
  payload.set(encrypted, 1 + enc.length)
  if (payload.length < MIN_ENCRYPTED_PAYLOAD_BYTES || payload.length > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error()
  }
  return bytesToBase64Url(payload)
}

function parseEncryptedPayload(value) {
  const payload = base64UrlToBytes(value)
  if (payload.length < MIN_ENCRYPTED_PAYLOAD_BYTES || payload.length > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error()
  }
  if (payload[0] !== PAIRING_PROTOCOL_VERSION) throw new Error()
  return {
    enc: payload.slice(1, 1 + X25519_PUBLIC_KEY_BYTES),
    ciphertext: payload.slice(1 + X25519_PUBLIC_KEY_BYTES),
  }
}

export async function createPairingRecipient(deviceName) {
  const keyPair = await suite.kem.generateKeyPair()
  const recipientPublicKey = await suite.kem.serializePublicKey(keyPair.publicKey)
  const recipientTokenBytes = crypto.getRandomValues(new Uint8Array(RECIPIENT_TOKEN_BYTES))
  const recipientTokenHash = await crypto.subtle.digest('SHA-256', recipientTokenBytes)
  return {
    sessionId: randomBase64Url(SESSION_ID_BYTES),
    recipientDeviceId: randomBase64Url(DEVICE_ID_BYTES),
    recipientDeviceName: validateSyncServerDeviceName(deviceName),
    recipientPublicKey: bytesToBase64Url(new Uint8Array(recipientPublicKey)),
    pairingSecret: randomBase64Url(PAIRING_SECRET_BYTES),
    recipientToken: bytesToBase64Url(recipientTokenBytes),
    recipientTokenHash: bytesToBase64Url(new Uint8Array(recipientTokenHash)),
    recipientKey: keyPair.privateKey,
  }
}

export function createPairingQrPayload(recipient, origin) {
  const request = validatePairingRequest({
    version: PAIRING_PROTOCOL_VERSION,
    origin: normalizePairingOrigin(origin),
    sessionId: recipient.sessionId,
    recipientPublicKey: recipient.recipientPublicKey,
    recipientDeviceId: recipient.recipientDeviceId,
    recipientDeviceName: recipient.recipientDeviceName,
    pairingSecret: recipient.pairingSecret,
  })
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(request)))
  const payload = `${PAIRING_QR_PREFIX}${encoded}`
  if (payload.length > MAX_QR_LENGTH) throw new Error()
  return payload
}

export function bindPairingRequestToAccount(request, accountId) {
  validatePairingRequest(request)
  return validateBoundPairingRequest({
    ...request,
    accountId: validateAccountId(accountId),
  })
}

export function parsePairingQrPayload(payload) {
  try {
    if (typeof payload !== 'string' || payload.length > MAX_QR_LENGTH || !payload.startsWith(PAIRING_QR_PREFIX)) {
      throw new Error()
    }
    const bytes = base64UrlToBytes(payload.slice(PAIRING_QR_PREFIX.length))
    const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const request = validatePairingRequest(JSON.parse(serialized))
    if (JSON.stringify(request) !== serialized) throw new Error()
    return request
  } catch {
    throw new Error('This is not a valid OpenTubeX pairing code')
  }
}

export function pairingSessionMatchesRequest(session, request, approved = false) {
  try {
    if (Object.prototype.hasOwnProperty.call(request, 'accountId')) {
      validateBoundPairingRequest(request)
    } else {
      validatePairingRequest(request)
    }
  } catch {
    return false
  }
  const expectedAccountId = request.accountId ?? null
  return hasExactFields(session, SESSION_FIELDS) &&
    session.version === PAIRING_PROTOCOL_VERSION &&
    session?.id === request.sessionId &&
    session?.account_id === expectedAccountId &&
    session?.recipient_public_key === request.recipientPublicKey &&
    session?.recipient_device_id === request.recipientDeviceId &&
    session?.recipient_device_name === request.recipientDeviceName &&
    session.approved === approved &&
    (approved
      ? isCanonicalBase64Url(session.approving_device_id, DEVICE_ID_BYTES)
      : session.approving_device_id === null) &&
    Number.isSafeInteger(session.expires_at) &&
    session.expires_at > Date.now()
}

export async function encryptPairingKey(request, approvingDeviceId, privacy) {
  validateBoundPairingRequest(request)
  const transportKey = standardBase64ToBase64Url(privacy.key, AES_256_KEY_BYTES)
  const transportSalt = standardBase64ToBase64Url(privacy.salt, PRIVACY_SALT_BYTES)
  if (privacy.version !== 1) throw new Error('Unsupported privacy format')
  const username = validateUsername(privacy.username)
  const token = validateToken(privacy.token)
  const verificationCode = validateVerificationCode(privacy.verificationCode)

  const recipientPublicKey = await suite.kem.deserializePublicKey(
    base64UrlToBytes(request.recipientPublicKey, X25519_PUBLIC_KEY_BYTES)
  )
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: HPKE_INFO,
    psk: psk(request),
  })
  const plaintext = new TextEncoder().encode(JSON.stringify({
    version: PAIRING_PROTOCOL_VERSION,
    username,
    token,
    privacyKey: transportKey,
    privacySalt: transportSalt,
    privacyFormat: privacy.version,
    verificationCode,
  }))
  let ciphertext
  try {
    ciphertext = await sender.seal(plaintext, encryptionContext(request, approvingDeviceId))
  } finally {
    plaintext.fill(0)
  }
  return serializeEncryptedPayload(sender.enc, ciphertext)
}

export async function decryptPairingKey(request, approvingDeviceId, recipientKey, payload) {
  try {
    const encrypted = parseEncryptedPayload(payload)
    const recipient = await suite.createRecipientContext({
      recipientKey,
      enc: encrypted.enc,
      info: HPKE_INFO,
      psk: psk(request),
    })
    const plaintext = new Uint8Array(await recipient.open(
      encrypted.ciphertext,
      encryptionContext(request, approvingDeviceId)
    ))
    try {
      const serialized = new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
      const privacy = JSON.parse(serialized)
      if (!hasExactFields(privacy, KEY_FIELDS) ||
          JSON.stringify(privacy) !== serialized ||
          privacy.version !== PAIRING_PROTOCOL_VERSION || privacy.privacyFormat !== 1) {
        throw new Error()
      }
      const username = validateUsername(privacy.username)
      const token = validateToken(privacy.token)
      const verificationCode = validateVerificationCode(privacy.verificationCode)
      base64UrlToBytes(privacy.privacyKey, AES_256_KEY_BYTES)
      base64UrlToBytes(privacy.privacySalt, PRIVACY_SALT_BYTES)
      return {
        username,
        token,
        key: base64UrlToStandardBase64(privacy.privacyKey, AES_256_KEY_BYTES),
        salt: base64UrlToStandardBase64(privacy.privacySalt, PRIVACY_SALT_BYTES),
        version: privacy.privacyFormat,
        verificationCode,
      }
    } finally {
      plaintext.fill(0)
    }
  } catch {
    throw new Error('The pairing response could not be authenticated')
  }
}

export function randomPairingDeviceId() {
  return randomBase64Url(DEVICE_ID_BYTES)
}

export function randomPairingVerificationCode() {
  const range = 1000000
  const limit = Math.floor(0x100000000 / range) * range
  let value
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]
  } while (value >= limit)
  return String(value % range).padStart(6, '0')
}
