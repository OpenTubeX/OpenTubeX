import { registerPlugin } from '@capacitor/core'

const AndroidStorage = process.env.IS_CAPACITOR ? registerPlugin('AndroidStorage') : null

function storageBytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

export async function getAndroidStorageUsage() {
  const result = await (AndroidStorage?.getUsage() ?? Promise.resolve({}))
  return {
    androidAppData: storageBytes(result.appDataBytes),
    androidCache: storageBytes(result.cacheBytes),
  }
}

export async function clearAndroidCache() {
  const result = await (AndroidStorage?.clearCache() ?? Promise.resolve({ cleared: false }))
  return result.cleared === true
}
