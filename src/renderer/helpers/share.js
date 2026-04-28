/**
 * @param {string} currentInvidiousInstanceUrl
 * @param {string} videoId
 * @param {string} [playlistId]
 * @returns {string}
 */
export function getInvidiousVideoUrl(currentInvidiousInstanceUrl, videoId, playlistId = '') {
  let videoUrl = `${currentInvidiousInstanceUrl}/watch?v=${videoId}`

  if (playlistId) {
    videoUrl += `&list=${playlistId}`
  }

  return videoUrl
}

/**
 * @param {string} videoId
 * @param {string} [playlistId]
 * @returns {string}
 */
export function getYoutubeVideoShareUrl(videoId, playlistId = '') {
  const videoUrl = `https://youtu.be/${videoId}`

  if (playlistId) {
    return `${videoUrl}?list=${playlistId}`
  }

  return videoUrl
}

/**
 * @param {string} url
 * @param {number} timestamp
 * @returns {string}
 */
export function appendTimestamp(url, timestamp) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${timestamp}`
}
