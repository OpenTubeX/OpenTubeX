// @ts-check
import { nativeImage, net } from 'electron'

import { isThumbnailUrl } from '../notificationHistory.js'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 3000

let imagesAllowed = () => true

/**
 * Notifications follow the current thumbnail settings, since the system cannot
 * blur images and reminders keep the thumbnail from when they were set.
 * @param {() => boolean} allowed
 */
export function setNotificationImagesAllowed(allowed) {
  imagesAllowed = allowed
}

/**
 * Loads a notification image through the app session, so proxy settings apply.
 * Without one in time, the notification shows without an image.
 * @param {string | undefined} url
 * @returns {Promise<import('electron').NativeImage | undefined>}
 */
export async function loadNotificationImage(url) {
  if (!isThumbnailUrl(url) || !imagesAllowed()) return undefined
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return undefined
    // Without a length, stop reading once the body exceeds the limit.
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      // Leaving the loop cancels the rest of the body.
      if (size > MAX_IMAGE_BYTES) return undefined
      chunks.push(chunk)
    }
    const image = nativeImage.createFromBuffer(Buffer.concat(chunks))
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}
