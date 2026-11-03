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
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const response = await net.fetch(url, { signal })
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return undefined
    // The timeout also ends a body that stalls, and without a length, reading
    // stops once the body exceeds the limit.
    const reader = response.body.getReader()
    const stop = () => { reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', stop, { once: true })
    const chunks = []
    let size = 0
    try {
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        size += read.value.length
        if (size > MAX_IMAGE_BYTES) {
          stop()
          return undefined
        }
        chunks.push(read.value)
      }
    } finally {
      signal.removeEventListener('abort', stop)
    }
    if (signal.aborted) return undefined
    const image = nativeImage.createFromBuffer(Buffer.concat(chunks))
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}
