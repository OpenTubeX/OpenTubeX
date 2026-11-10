export const MAX_YT_DLP_FORMAT_AVAILABILITY_WAIT_MS = 15_000

/**
 * Matches yt-dlp's whole-second comparison when calculating its download delay.
 * @param {number | null | undefined} availableAt Unix timestamp in seconds
 * @param {number} now Unix timestamp in milliseconds
 */
export function getYtDlpFormatAvailabilityWaitMs(availableAt, now = Date.now()) {
  return (availableAt ?? 0) * 1000 - Math.floor(now / 1000) * 1000
}

/**
 * Waits for a shortly delayed format, while rejecting stale or unexpectedly
 * distant timestamps so they cannot hold up every usable playback format.
 * @param {{ availableAt?: number | null }} format
 */
export async function waitForYtDlpFormatAvailability(format) {
  const waitMs = getYtDlpFormatAvailabilityWaitMs(format.availableAt)

  if (waitMs > MAX_YT_DLP_FORMAT_AVAILABILITY_WAIT_MS) {
    return false
  }

  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  return true
}
