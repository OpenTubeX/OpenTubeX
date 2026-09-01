import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptSyncServerDeviceInfo,
  encryptSyncServerDeviceInfo,
  isValidSyncServerDeviceId,
  isValidSyncServerDeviceName,
  randomSyncServerDeviceId,
} from '../../src/renderer/helpers/sync-server-sessions.js'

function bytesToBase64 (bytes) {
  return Buffer.from(bytes).toString('base64')
}

test('creates random canonical device identifiers', () => {
  const identifiers = new Set(Array.from({ length: 100 }, randomSyncServerDeviceId))
  assert.equal(identifiers.size, 100)
  for (const identifier of identifiers) assert.equal(isValidSyncServerDeviceId(identifier), true)
  assert.equal(isValidSyncServerDeviceId('not a device id'), false)
})

test('encrypts device identification for one device and privacy key', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const otherKey = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const deviceId = randomSyncServerDeviceId()
  const otherDeviceId = randomSyncServerDeviceId()
  const deviceInfo = {
    name: 'Büro-Laptop',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }
  const payload = await encryptSyncServerDeviceInfo(deviceInfo, key, deviceId)

  assert.deepEqual(await decryptSyncServerDeviceInfo(payload, key, deviceId), {
    version: 1,
    ...deviceInfo,
  })
  await assert.rejects(
    () => decryptSyncServerDeviceInfo(payload, otherKey, deviceId),
    /device info is invalid/
  )
  await assert.rejects(
    () => decryptSyncServerDeviceInfo(payload, key, otherDeviceId),
    /device info is invalid/
  )
})

test('validates device names and rejects invalid encrypted device info', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const deviceId = randomSyncServerDeviceId()
  assert.equal(isValidSyncServerDeviceName('Büro-Laptop'), true)
  assert.equal(isValidSyncServerDeviceName(' padded '), false)
  await assert.rejects(() => encryptSyncServerDeviceInfo({
    name: '',
    platform: 'linux',
    architecture: 'x64',
    release: '',
  }, key, deviceId))
})
