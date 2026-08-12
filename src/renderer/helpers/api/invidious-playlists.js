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
