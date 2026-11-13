// @ts-check
// How YouTube sync compares the account with the saved data, without the
// store or network requests.

/**
 * @typedef {import('./api/youtube-account-parsers.js').YouTubePlaylistVideo} YouTubePlaylistVideo
 * @typedef {{ videoId: string, playlistItemId: string, youTubeSetVideoId?: string | null, [key: string]: unknown }} SavedPlaylistVideo
 */

/**
 * Changes on YouTube since the last sync. Channels subscribed to or
 * unsubscribed from only in OpenTubeX stay as they are; the first sync only
 * adds. An empty list is more likely a page that was misread than an
 * unsubscribe from every channel, so it removes nothing and the next sync
 * compares with the last list that had channels.
 * @template {{ id: string }} T
 * @param {string[] | null} previousIds the channels YouTube had at the last sync, null before the first
 * @param {T[]} remoteChannels the channels YouTube has now
 * @param {Set<string>} localIds the channels in All Channels
 * @returns {{ added: T[], removedIds: string[], nextIds: string[] }} the channels to add, the saved ones
 *   to remove, and the channels the next sync compares with
 */
export function diffYouTubeSubscriptions(previousIds, remoteChannels, localIds) {
  const previous = previousIds === null ? null : new Set(previousIds)
  const remoteIds = new Set(remoteChannels.map(channel => channel.id))
  const misread = previousIds !== null && previousIds.length > 0 && remoteChannels.length === 0
  return {
    added: remoteChannels.filter(channel => !localIds.has(channel.id) && !previous?.has(channel.id)),
    removedIds: previous === null || misread ? [] : [...previous].filter(id => !remoteIds.has(id) && localIds.has(id)),
    nextIds: misread ? previousIds : [...remoteIds]
  }
}

/**
 * The playlist's videos in YouTube's order. Saved entries keep their IDs and
 * added times, matched by their YouTube entry, or by video for entries added
 * here since the last sync.
 * @param {SavedPlaylistVideo[]} saved
 * @param {YouTubePlaylistVideo[]} remote
 * @param {{ now: number, newestFirst: boolean, createId: () => string }} options
 *   `newestFirst` lists new entries from the newest, as Liked videos does
 * @returns {SavedPlaylistVideo[]}
 */
export function mergeYouTubePlaylistVideos(saved, remote, { now, newestFirst, createId }) {
  /** @type {Map<string, SavedPlaylistVideo>} */
  const bySetVideoId = new Map()
  /** @type {Map<string, SavedPlaylistVideo[]>} */
  const unconfirmed = new Map()
  for (const video of saved) {
    if (video.youTubeSetVideoId) {
      bySetVideoId.set(video.youTubeSetVideoId, video)
    } else {
      unconfirmed.set(video.videoId, [...unconfirmed.get(video.videoId) ?? [], video])
    }
  }

  return remote.map((video, index) => {
    const match = (video.setVideoId ? bySetVideoId.get(video.setVideoId) : undefined) ??
      unconfirmed.get(video.videoId)?.shift()
    return {
      ...match,
      type: 'video',
      videoId: video.videoId,
      title: video.title,
      author: video.author || /** @type {string | undefined} */ (match?.author) || '',
      authorId: video.authorId || /** @type {string | undefined} */ (match?.authorId) || '',
      lengthSeconds: video.lengthSeconds,
      // The TV app only shows a rough age, so keep a more exact date.
      published: /** @type {number | undefined} */ (match?.published) ?? video.published ?? undefined,
      ...(video.viewCount !== null ? { viewCount: video.viewCount } : {}),
      timeAdded: /** @type {number | undefined} */ (match?.timeAdded) ?? (newestFirst ? now - index : now - remote.length + index),
      playlistItemId: match?.playlistItemId ?? createId(),
      youTubeSetVideoId: video.setVideoId
    }
  })
}

/**
 * Fills in the YouTube entries of videos added here since the last sync,
 * from the playlist as YouTube has it.
 * @template {SavedPlaylistVideo} T
 * @param {T[]} saved
 * @param {YouTubePlaylistVideo[]} remote
 * @returns {T[]}
 */
export function resolveYouTubeSetVideoIds(saved, remote) {
  const claimed = new Set(saved.map(video => video.youTubeSetVideoId).filter(Boolean))
  /** @type {Map<string, string[]>} */
  const unclaimed = new Map()
  for (const video of remote) {
    if (video.setVideoId && !claimed.has(video.setVideoId)) {
      unclaimed.set(video.videoId, [...unclaimed.get(video.videoId) ?? [], video.setVideoId])
    }
  }
  return saved.map(video => video.youTubeSetVideoId
    ? video
    : { ...video, youTubeSetVideoId: unclaimed.get(video.videoId)?.shift() ?? null })
}

/**
 * Finishes a playlist read early once its last page continues the saved
 * entries in order and the counts add up, as when videos were only added to
 * the start, which is where Liked videos adds them.
 * @param {YouTubePlaylistVideo[]} read the videos read so far
 * @param {SavedPlaylistVideo[]} saved
 * @param {number | null} videoCount the count the playlist list shows
 * @returns {YouTubePlaylistVideo[] | null} all videos, or null to keep reading
 */
export function completeYouTubePlaylistVideos(read, saved, videoCount) {
  const lastSetVideoId = read.at(-1)?.setVideoId
  if (videoCount === null || !lastSetVideoId) return null
  const index = saved.findIndex(video => video.youTubeSetVideoId === lastSetVideoId)
  if (index === -1) return null

  const rest = saved.slice(index + 1)
  if (read.length + rest.length !== videoCount || rest.some(video => !video.youTubeSetVideoId)) return null
  // A single matching entry could be a video moved from further down.
  const overlap = Math.min(read.length, index + 1)
  for (let offset = 1; offset <= overlap; offset++) {
    if (read.at(-offset)?.setVideoId !== saved[index - offset + 1].youTubeSetVideoId) return null
  }

  return [...read, ...rest.map(video => ({
    videoId: video.videoId,
    setVideoId: /** @type {string} */ (video.youTubeSetVideoId),
    title: String(video.title ?? ''),
    author: String(video.author ?? ''),
    authorId: String(video.authorId ?? ''),
    lengthSeconds: /** @type {number | ''} */ (video.lengthSeconds ?? ''),
    published: /** @type {number | null} */ (video.published ?? null),
    viewCount: /** @type {number | null} */ (video.viewCount ?? null)
  }))]
}

/**
 * Indexes into `sequence` of a longest increasing subsequence.
 * @param {number[]} sequence
 * @returns {Set<number>}
 */
function longestIncreasingSubsequence(sequence) {
  /** @type {number[]} */
  const tails = []
  /** @type {number[]} */
  const previous = []
  sequence.forEach((value, index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (sequence[tails[middle]] < value) low = middle + 1
      else high = middle
    }
    previous[index] = low > 0 ? tails[low - 1] : -1
    tails[low] = index
  })

  const kept = new Set()
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]) kept.add(index)
  return kept
}

/**
 * The fewest moves that put YouTube's entries in the new order. The entries
 * that are already in order stay, and each other one moves behind the entry
 * before it. Entries only one side has keep their places.
 * @param {string[]} current entry IDs in YouTube's order
 * @param {string[]} desired entry IDs in the new order
 * @returns {{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: string, movedSetVideoIdPredecessor?: string }[]}
 */
export function planYouTubePlaylistMoves(current, desired) {
  const positions = new Map(current.map((id, index) => [id, index]))
  const target = desired.filter(id => positions.has(id))
  const kept = longestIncreasingSubsequence(target.map(id => /** @type {number} */ (positions.get(id))))

  /** @type {{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: string, movedSetVideoIdPredecessor?: string }[]} */
  const moves = []
  target.forEach((id, index) => {
    if (kept.has(index)) return
    // Without a predecessor, the entry moves to the start.
    moves.push(index === 0
      ? { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: id }
      : { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: id, movedSetVideoIdPredecessor: target[index - 1] })
  })
  return moves
}
