/**
 * Invidious includes unavailable playlist videos with no usable metadata.
 * Filtering them also prevents thumbnail requests that can stall the instance.
 * @param {{ title: string, author: string, authorId: string | null }[]} videos
 */
export function filterUnavailableInvidiousPlaylistVideos(videos) {
  return videos.filter(video => !(
    video.title === '' &&
    video.author === '' &&
    video.authorId == null
  ))
}

function getInvidiousPlaylistVideoIdentity(video) {
  if (Number.isInteger(video.index) && video.index >= 0) {
    return `index:${video.index}:video:${video.videoId ?? ''}`
  }

  if (typeof video.videoId === 'string' && video.videoId !== '') {
    return `video:${video.videoId}`
  }

  return null
}

/**
 * Invidious playlist pages overlap, so append only entries that have not
 * already appeared. Playlist position remains part of the identity because a
 * playlist can intentionally contain the same video more than once.
 * @param {object[]} currentVideos
 * @param {object[]} nextVideos
 */
export function mergeInvidiousPlaylistVideos(currentVideos, nextVideos) {
  const identities = new Set(currentVideos.map(getInvidiousPlaylistVideoIdentity).filter(Boolean))

  return currentVideos.concat(nextVideos.filter((video) => {
    const identity = getInvidiousPlaylistVideoIdentity(video)
    if (identity == null) return true
    if (identities.has(identity)) return false

    identities.add(identity)
    return true
  }))
}

/**
 * Invidious currently advances playlist pages by at least 100 positions even
 * though responses may overlap and may contain up to 200 entries.
 * @param {number} videoCount
 * @param {number} loadedPage
 * @param {number} loadedVideoCount
 * @param {number} responseVideoCount count before unavailable entries are filtered
 */
export function hasMoreInvidiousPlaylistPages(videoCount, loadedPage, loadedVideoCount, responseVideoCount) {
  return responseVideoCount > 0 &&
    loadedVideoCount < videoCount &&
    loadedPage * 100 < videoCount
}
