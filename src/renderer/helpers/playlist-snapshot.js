import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from './api/invidious-playlists.js'

/**
 * Fetch a fresh snapshot without exposing partially loaded pages to callers.
 * `onProgress` receives the number of videos loaded so far and the playlist's
 * reported size, when `getTotal` knows it.
 */
export async function loadLocalPlaylistSnapshot(id, { getPlaylist, getContinuation, parseVideos, getTotal = () => null, signal, onProgress = () => {} }) {
  signal?.throwIfAborted()
  let page = await getPlaylist(id)
  const title = page.info.title
  const description = page.info.description ?? ''
  const total = getTotal(page)
  const videos = []
  while (page) {
    signal?.throwIfAborted()
    videos.push(...parseVideos(page.items))
    onProgress(videos.length, total)
    if (!page.has_continuation) break
    page = await getContinuation(page)
    if (!page) throw new Error('Missing playlist continuation')
  }
  signal?.throwIfAborted()
  return { title, description, videos }
}

/** Invidious pages can overlap; preserve repeated videos at different positions. */
export async function loadInvidiousPlaylistSnapshot(id, { getPlaylist, signal, onProgress = () => {} }) {
  signal?.throwIfAborted()
  let page = await getPlaylist(id)
  const { title, description } = page
  let videos = page.videos
  let pageNumber = 1
  onProgress(videos.length, page.videoCount ?? null)
  while (hasMoreInvidiousPlaylistPages(page.videoCount, pageNumber, videos.length, page.pageVideoCount)) {
    signal?.throwIfAborted()
    page = await getPlaylist(id, ++pageNumber)
    if (page.pageVideoCount === 0) throw new Error('Missing playlist continuation')
    videos = mergeInvidiousPlaylistVideos(videos, page.videos)
    onProgress(videos.length, page.videoCount ?? null)
  }
  signal?.throwIfAborted()
  return { title, description, videos }
}
