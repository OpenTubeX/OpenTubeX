/**
 * Reads premiere state before YouTube.js coerces a missing isLiveContent value
 * to false.
 * @param {object | null | undefined} videoDetails
 * @returns {boolean | undefined}
 */
export function getLocalPremiereState(videoDetails) {
  if (videoDetails?.isLive !== true) {
    return false
  }

  return typeof videoDetails.isLiveContent === 'boolean'
    ? !videoDetails.isLiveContent
    : undefined
}
