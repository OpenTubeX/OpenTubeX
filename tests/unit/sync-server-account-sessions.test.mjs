import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decryptSyncServerDeviceInfo,
  encryptSyncServerDeviceInfo,
  loadSyncServerDevices,
  randomSyncServerDeviceId,
} from '../../src/renderer/helpers/sync-server-sessions.js'

function bytesToBase64 (bytes) {
  return Buffer.from(bytes).toString('base64')
}

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

test('loads names and platforms from encrypted account-session metadata', async () => {
  const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
  const laptopId = randomSyncServerDeviceId()
  const phoneId = randomSyncServerDeviceId()
  const encryptedLaptop = await encryptSyncServerDeviceInfo({
    name: 'Travel laptop',
    platform: 'linux',
    architecture: 'x64',
    release: '6.16.4-arch1-1',
  }, key, laptopId)

  const encryptedPhone = await encryptSyncServerDeviceInfo({ name: 'Pixel 8 Pro', platform: 'android', architecture: 'arm64', release: '16' }, key, phoneId)

  const devices = await loadSyncServerDevices({
    getAccountSessions: async () => ({
      sessions: [
        { device_id: laptopId, encrypted_device_info: encryptedLaptop },
        { device_id: phoneId, encrypted_device_info: encryptedPhone },
        { device_id: randomSyncServerDeviceId(), encrypted_device_info: 'invalid ciphertext' },
        { device_id: 'invalid-device-id', encrypted_device_info: encryptedLaptop },
      ],
    }),
  }, key)

  assert.deepEqual(devices, {
    [laptopId]: { name: 'Travel laptop', platform: 'linux' },
    [phoneId]: { name: 'Pixel 8 Pro', platform: 'android' },
  })
})
