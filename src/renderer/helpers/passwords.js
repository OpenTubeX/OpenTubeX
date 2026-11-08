const HASH_PREFIX = 'pbkdf2-sha256'
const HASH_ITERATIONS = 210000
const SALT_BYTES = 16
const KEY_BYTES = 32

const textEncoder = new TextEncoder()

function bytesToBase64 (bytes) {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return globalThis.btoa(binary)
}

function base64ToBytes (base64) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function constantTimeEqual (actual, expected) {
  if (actual.length !== expected.length) {
    return false
  }

  let difference = 0

  for (let index = 0; index < actual.length; index++) {
    difference |= actual[index] ^ expected[index]
  }

  return difference === 0
}

async function derivePasswordKey (password, salt, iterations) {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    keyMaterial,
    KEY_BYTES * 8
  )

  return new Uint8Array(derivedBits)
}

export function isHashedPassword (storedPassword) {
  if (typeof storedPassword !== 'string') {
    return false
  }

  const [prefix, iterationsString, saltBase64, hashBase64] = storedPassword.split('$')
  const iterations = Number.parseInt(iterationsString, 10)

  return (
    prefix === HASH_PREFIX &&
    Number.isInteger(iterations) &&
    iterations > 0 &&
    saltBase64 != null &&
    hashBase64 != null
  )
}

export async function hashPassword (password) {
  if (password === '') {
    return ''
  }

  const salt = new Uint8Array(SALT_BYTES)
  globalThis.crypto.getRandomValues(salt)

  const hash = await derivePasswordKey(password, salt, HASH_ITERATIONS)

  return [
    HASH_PREFIX,
    HASH_ITERATIONS,
    bytesToBase64(salt),
    bytesToBase64(hash)
  ].join('$')
}

export async function verifyPassword (password, storedPassword) {
  if (storedPassword === '') {
    return password === ''
  }

  if (!isHashedPassword(storedPassword)) {
    return password === storedPassword
  }

  const [, iterationsString, saltBase64, hashBase64] = storedPassword.split('$')
  const iterations = Number.parseInt(iterationsString, 10)

  if (!Number.isInteger(iterations) || iterations <= 0 || !saltBase64 || !hashBase64) {
    return false
  }

  try {
    const salt = base64ToBytes(saltBase64)
    const expectedHash = base64ToBytes(hashBase64)
    const actualHash = await derivePasswordKey(password, salt, iterations)

    return constantTimeEqual(actualHash, expectedHash)
  } catch {
    return false
  }
}
