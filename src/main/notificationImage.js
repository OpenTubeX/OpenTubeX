// @ts-check
import { nativeImage, net } from 'electron'

import { isThumbnailUrl } from '../notificationHistory.js'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 3000

/**
 * Loads a notification image through the app session, so proxy settings apply.
 * Without one in time, the notification shows without an image.
 * @param {string | undefined} url
 * @returns {Promise<import('electron').NativeImage | undefined>}
 */
export async function loadNotificationImage(url) {
  if (!isThumbnailUrl(url)) return undefined
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_IMAGE_BYTES) return undefined
    const image = nativeImage.createFromBuffer(buffer)
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}
