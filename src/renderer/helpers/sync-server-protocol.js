export const SYNC_SERVER_DEVICE_ID_BYTES = 16

const MAX_DEVICE_NAME_CHARS = 80
const MAX_DEVICE_NAME_BYTES = 240

export function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(value) {
  if (typeof value !== 'string') throw new Error()
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

export function canonicalBase64ToBytes(value, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error()
  const bytes = base64ToBytes(value)
  if ((expectedLength !== undefined && bytes.length !== expectedLength) ||
      bytesToBase64(bytes) !== value) {
    throw new Error()
  }
  return bytes
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function base64UrlToBytes(value, expectedLength) {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) throw new Error()
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const bytes = base64ToBytes(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  if ((expectedLength !== undefined && bytes.length !== expectedLength) ||
      bytesToBase64Url(bytes) !== value) {
    throw new Error()
  }
  return bytes
}

export function isCanonicalBase64Url(value, expectedLength) {
  try {
    base64UrlToBytes(value, expectedLength)
    return true
  } catch {
    return false
  }
}

export function standardBase64ToBase64Url(value, expectedLength) {
  return bytesToBase64Url(canonicalBase64ToBytes(value, expectedLength))
}

export function base64UrlToStandardBase64(value, expectedLength) {
  return bytesToBase64(base64UrlToBytes(value, expectedLength))
}

export function randomBase64Url(length) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)))
}

export function validateSyncServerDeviceName(value) {
  if (typeof value !== 'string' || value.trim() !== value || !value ||
      [...value].length > MAX_DEVICE_NAME_CHARS ||
      new TextEncoder().encode(value).length > MAX_DEVICE_NAME_BYTES ||
      [...value].some(character => /\p{Cc}/u.test(character))) {
    throw new Error()
  }
  return value
}

export function isValidSyncServerDeviceName(value) {
  try {
    validateSyncServerDeviceName(value)
    return true
  } catch {
    return false
  }
}
