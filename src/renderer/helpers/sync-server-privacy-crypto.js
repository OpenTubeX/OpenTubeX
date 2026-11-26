// @ts-check
import { base64ToBytes, bytesToBase64 } from './sync-server-protocol.js'

/** The payload format this version writes. */
export const PRIVACY_VERSION = 2
// Payloads of version 1 authenticate the same additional data for every
// collection, so a server could serve one collection's payload as another's.
// Version 1 shipped, so its payloads are still read until their next upload.
const UNBOUND_PRIVACY_VERSION = 1
/** The format of the privacy key itself, which pairing transfers. Payload versions do not change it. */
export const PRIVACY_KEY_FORMAT = 1
const PBKDF2_ITERATIONS = 600_000
const PADDING_BLOCK_BYTES = 64 * 1024
const COMPRESSED_LENGTH_BYTES = 4
const UNBOUND_ADDITIONAL_DATA = new TextEncoder().encode('OpenTubeX encrypted sync v1')
const NEWER_VERSION_MESSAGE = 'Sync data was saved by a newer OpenTubeX version. Update OpenTubeX to sync.'
const GZIP_COMPRESSION = 'gzip'
const LEGACY_DOCUMENT_COLLECTIONS = [
  'subscriptions',
  'playlists',
  'history',
  'playbackSpeeds',
  'subscriptionGroups',
  'playlistBookmarks',
]

/**
 * What a payload holds, which its encryption authenticates, so a server cannot
 * serve it in place of another.
 * @param {string} collection The collection's name on the server
 */
export function syncCollectionContext(collection) {
  return `collection:${collection}`
}

/** @param {string} collection The collection's name on the server */
export function syncChangeContext(collection) {
  return `change:${collection}`
}

/** Device requests and the activity the server shares as events. */
export const SYNC_EVENT_CONTEXT = 'event'
/** The single document of the original format, which only exists as version 1. */
export const SYNC_LEGACY_DOCUMENT_CONTEXT = 'legacy'

/** @param {string} context */
function additionalData(context) {
  if (typeof context !== 'string' || context === '') throw new TypeError('Missing encrypted sync context')
  return new TextEncoder().encode(`OpenTubeX encrypted sync v2\n${context}`)
}

/** @param {BlobPart} bytes Bytes, or a string to compress as UTF-8 */
async function transformBytes(bytes, TransformStream) {
  const stream = new globalThis.Blob([bytes])
    .stream()
    .pipeThrough(new TransformStream(GZIP_COMPRESSION))
  return new Uint8Array(await new globalThis.Response(stream).arrayBuffer())
}

function compressBytes(bytes) {
  return transformBytes(bytes, globalThis.CompressionStream)
}

function decompressBytes(bytes) {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new Error('Compressed encrypted sync data is not supported by this app version')
  }
  return transformBytes(bytes, globalThis.DecompressionStream)
}

async function importPrivacyKey(value) {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(value),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

async function derivePrivacyKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

function parseEnvelope(payload) {
  let envelope
  try {
    envelope = JSON.parse(payload)
  } catch {}
  if (Number.isSafeInteger(envelope?.version) && envelope.version > PRIVACY_VERSION) {
    throw new Error(NEWER_VERSION_MESSAGE)
  }
  try {
    const compressed = envelope.compression != null
    if ((envelope.version !== PRIVACY_VERSION && envelope.version !== UNBOUND_PRIVACY_VERSION) ||
        envelope.kdf?.name !== 'PBKDF2' ||
        envelope.kdf?.hash !== 'SHA-256' ||
        envelope.kdf?.iterations !== PBKDF2_ITERATIONS ||
        envelope.cipher?.name !== 'AES-GCM' ||
        (compressed && (
          envelope.compression.name !== GZIP_COMPRESSION
        ))) {
      throw new Error()
    }
    return envelope
  } catch {
    throw new Error('Unsupported or invalid encrypted sync data')
  }
}

async function decryptWithKey(payload, key, context, { allowLegacyDocument = false } = {}) {
  const bound = additionalData(context)
  const envelope = parseEnvelope(payload)
  const unbound = envelope.version === UNBOUND_PRIVACY_VERSION
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(envelope.cipher.iv),
        additionalData: unbound ? UNBOUND_ADDITIONAL_DATA : bound,
      },
      key,
      base64ToBytes(envelope.ciphertext)
    ))
    let documentBytes = plaintext
    if (envelope.compression) {
      const compressedLength = new DataView(
        plaintext.buffer,
        plaintext.byteOffset,
        COMPRESSED_LENGTH_BYTES
      ).getUint32(0)
      if (compressedLength <= 0 || compressedLength > plaintext.length - COMPRESSED_LENGTH_BYTES) {
        throw new Error()
      }
      documentBytes = await decompressBytes(
        plaintext.slice(COMPRESSED_LENGTH_BYTES, COMPRESSED_LENGTH_BYTES + compressedLength)
      )
    }
    const document = JSON.parse(new TextDecoder().decode(documentBytes))
    if (document.version !== envelope.version) throw new Error()
    if ('data' in document) return document.data
    if (allowLegacyDocument && unbound && LEGACY_DOCUMENT_COLLECTIONS.some(collection => (
      Array.isArray(document[collection])
    ))) {
      return document
    }
    throw new Error()
  } catch {
    throw new Error('Incorrect privacy passphrase or corrupted sync data')
  }
}

/**
 * @param {string | null | undefined} payload Encrypted data the key must decrypt, if the account has any
 * @param {string} passphrase
 * @param {string} [context] What the payload holds, required with a payload
 */
export async function preparePrivacyKey(payload, passphrase, context) {
  const salt = payload
    ? base64ToBytes(parseEnvelope(payload).kdf.salt)
    : crypto.getRandomValues(new Uint8Array(16))
  const key = await derivePrivacyKey(passphrase, salt)
  if (payload) await decryptWithKey(payload, key, context, { allowLegacyDocument: true })
  const rawKey = await crypto.subtle.exportKey('raw', key)
  return {
    key: bytesToBase64(new Uint8Array(rawKey)),
    salt: bytesToBase64(salt),
  }
}

/**
 * @param {string | null | undefined} payload
 * @param {string} exportedKey
 * @param {string} context What the payload must hold, from {@link syncCollectionContext} or the other contexts
 */
export async function decryptSyncDocument(payload, exportedKey, context) {
  if (!payload) return null
  return decryptWithKey(payload, await importPrivacyKey(exportedKey), context)
}

export async function decryptLegacySyncDocument(payload, exportedKey) {
  if (!payload) return null
  return decryptWithKey(
    payload,
    await importPrivacyKey(exportedKey),
    SYNC_LEGACY_DOCUMENT_CONTEXT,
    { allowLegacyDocument: true }
  )
}

/**
 * @param {unknown} data
 * @param {string} exportedKey
 * @param {string} salt
 * @param {string} context What the payload holds, from {@link syncCollectionContext} or the other contexts
 * @param {{ paddingBytes?: number }} [options] Size of the padding blocks that hide the exact length
 */
export async function encryptSyncDocument(data, exportedKey, salt, context, { paddingBytes = PADDING_BLOCK_BYTES } = {}) {
  const boundData = additionalData(context)
  const key = await importPrivacyKey(exportedKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const json = JSON.stringify({ version: PRIVACY_VERSION, data })
  // A Blob encodes the string itself, without a separate copy of every byte.
  const compressed = typeof globalThis.CompressionStream === 'function'
    ? await compressBytes(json)
    : null
  const payload = compressed ?? new TextEncoder().encode(json)
  const payloadOffset = compressed ? COMPRESSED_LENGTH_BYTES : 0
  const paddedLength = Math.ceil(
    (payloadOffset + payload.length) / paddingBytes
  ) * paddingBytes
  const plaintext = new Uint8Array(Math.max(paddingBytes, paddedLength))
  plaintext.fill(0x20)
  if (compressed) {
    new DataView(plaintext.buffer).setUint32(0, compressed.length)
  }
  plaintext.set(payload, payloadOffset)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundData },
    key,
    plaintext
  )
  return JSON.stringify({
    version: PRIVACY_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt,
    },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    ...(compressed && {
      compression: { name: GZIP_COMPRESSION },
    }),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  })
}

export function getPrivacySalt(payload) {
  return parseEnvelope(payload).kdf.salt
}
