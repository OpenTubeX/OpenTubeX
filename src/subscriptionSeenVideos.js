import { isHistoryEntryWatched } from './history.js'

export const MAX_SUBSCRIPTION_SEEN_VIDEOS = 10000

/**
 * @typedef {{ videoId: string, seenAt: number, unseenAt?: number, isMembersOnly: boolean }} SeenVideoMark
 * `unseenAt` is the time of the latest reverse action, see {@link mergeSeenVideoMark}.
 */

/**
 * What a merge changed in the saved marks: the marks it saved, and the marks
 * it dropped as they were saved before. Windows apply these instead of
 * reading the whole list again, see {@link applySubscriptionSeenVideoChanges}.
 * @typedef {{ upserts: SeenVideoMark[], removals: SeenVideoMark[] }} SeenVideoChanges
 */

export function parseSubscriptionSeenVideos(value) {
  try {
    const entries = typeof value === 'string'
      ? JSON.parse(value)
      : value instanceof Map ? [...value.values()] : value
    if (!Array.isArray(entries)) return []
    return entries.filter(entry => (
      typeof entry?.videoId === 'string' && entry.videoId.length > 0 &&
      Number.isFinite(entry.seenAt) && entry.seenAt > 0
    ))
  } catch {
    return []
  }
}

/**
 * Combines a video's mark with another one of the same video.
 * @param {SeenVideoMark | undefined} previous an earlier result of this function
 * @param {{ videoId: string, seenAt: number, unseenAt?: unknown, isMembersOnly?: unknown }} entry
 * @returns {SeenVideoMark}
 */
export function mergeSeenVideoMark(previous, entry) {
  // Retain the reverse action so an older synced seen mark cannot undo it.
  const unseenAt = Math.max(previous?.unseenAt ?? 0,
    Number.isFinite(entry.unseenAt) && /** @type {number} */ (entry.unseenAt) > 0 ? /** @type {number} */ (entry.unseenAt) : 0)
  return {
    videoId: entry.videoId,
    seenAt: Math.max(previous?.seenAt ?? 0, entry.seenAt),
    ...(unseenAt > 0 ? { unseenAt } : {}),
    // Keep public marks even when a stale device saw the members-only upload.
    isMembersOnly: entry.isMembersOnly === true && previous?.isMembersOnly !== false,
  }
}

/** @param {SeenVideoMark} a @param {SeenVideoMark} b */
function isSameSeenVideoMark(a, b) {
  return a.seenAt === b.seenAt && a.unseenAt === b.unseenAt && a.isMembersOnly === b.isMembersOnly
}

/** @param {SeenVideoMark} entry */
function latestSeenVideoAction(entry) {
  return Math.max(entry.seenAt, entry.unseenAt ?? 0)
}

const byVideoId = (a, b) => a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0

/**
 * The marks a list keeps, newest first.
 * @param {SeenVideoMark[]} entries one per video
 * @param {Record<string, any>} historyById
 */
function retainedSeenVideoMarks(entries, historyById) {
  // Evict oldest marks only after removing watched videos. Break timestamp ties
  // by ID so devices retain the same set regardless of merge order.
  return entries
    // Merge both halves before pruning: a reverse mark still needs to clear
    // older watched history on other devices, even after another seen action.
    .filter(entry => entry.unseenAt > 0 || !isHistoryEntryWatched(historyById[entry.videoId]))
    .sort((a, b) => latestSeenVideoAction(b) - latestSeenVideoAction(a) || byVideoId(a, b))
    .slice(0, MAX_SUBSCRIPTION_SEEN_VIDEOS)
}

/**
 * Each video's mark, merged from every mark of it in `value`.
 * @param {unknown} value
 * @returns {Map<string, SeenVideoMark>}
 */
export function indexSubscriptionSeenVideos(value) {
  const byId = new Map()
  for (const entry of parseSubscriptionSeenVideos(value)) {
    byId.set(entry.videoId, mergeSeenVideoMark(byId.get(entry.videoId), entry))
  }
  return byId
}

export function mergeSubscriptionSeenVideos(local, remote, historyById = {}) {
  const byId = indexSubscriptionSeenVideos([...parseSubscriptionSeenVideos(local), ...parseSubscriptionSeenVideos(remote)])
  return retainedSeenVideoMarks([...byId.values()], historyById).sort(byVideoId)
}

/**
 * Merges marks into saved ones without changing them. Watched videos leave
 * the list. Checking every saved mark reads a history record per mark, so
 * that only happens once the list is full and eviction would otherwise drop
 * recent marks; saved marks were checked when they arrived.
 * @param {Map<string, SeenVideoMark>} saved see {@link indexSubscriptionSeenVideos}
 * @param {unknown} incoming
 * @param {(videoIds: string[]) => Promise<Record<string, any>>} findHistory
 *   the history records of these videos, by video ID
 * @returns {Promise<SeenVideoChanges>}
 */
export async function planSubscriptionSeenVideoChanges(saved, incoming, findHistory) {
  const merged = new Map()
  for (const entry of parseSubscriptionSeenVideos(incoming)) {
    merged.set(entry.videoId, mergeSeenVideoMark(merged.get(entry.videoId) ?? saved.get(entry.videoId), entry))
  }
  let size = saved.size
  for (const videoId of merged.keys()) if (!saved.has(videoId)) size++
  const isFull = size > MAX_SUBSCRIPTION_SEEN_VIDEOS
  const historyById = await findHistory(isFull ? [...new Set([...saved.keys(), ...merged.keys()])] : [...merged.keys()])

  const retained = isFull
    ? retainedSeenVideoMarks([...new Map([...saved, ...merged]).values()], historyById)
    : retainedSeenVideoMarks([...merged.values()], historyById)
  const retainedIds = new Set(retained.map(entry => entry.videoId))
  /** @type {SeenVideoChanges} */
  const changes = { upserts: [], removals: [] }
  for (const videoId of isFull ? saved.keys() : merged.keys()) {
    const previous = saved.get(videoId)
    if (previous && !retainedIds.has(videoId)) changes.removals.push(previous)
  }
  for (const entry of retained) {
    const previous = saved.get(entry.videoId)
    if (!previous || !isSameSeenVideoMark(previous, entry)) changes.upserts.push(entry)
  }
  return changes
}

/** @param {SeenVideoChanges | null | undefined} changes */
export function hasSubscriptionSeenVideoChanges(changes) {
  return (changes?.upserts?.length ?? 0) > 0 || (changes?.removals?.length ?? 0) > 0
}

/**
 * Applies a merge's changes to marks in place. Windows can receive the
 * changes of concurrent merges in any order, and changes they already have,
 * so applying them is commutative and idempotent: a dropped mark only leaves
 * when no newer mark of the video arrived first.
 * @param {Map<string, SeenVideoMark>} byId
 * @param {SeenVideoChanges | null | undefined} changes
 * @returns {boolean} whether the marks changed
 */
export function applySubscriptionSeenVideoChanges(byId, changes) {
  let changed = false
  for (const removed of parseSubscriptionSeenVideos(changes?.removals)) {
    const current = byId.get(removed.videoId)
    if (current && current.seenAt <= removed.seenAt && (current.unseenAt ?? 0) <= (removed.unseenAt ?? 0)) {
      byId.delete(removed.videoId)
      changed = true
    }
  }
  for (const entry of parseSubscriptionSeenVideos(changes?.upserts)) {
    const previous = byId.get(entry.videoId)
    const merged = mergeSeenVideoMark(previous, entry)
    if (!previous || !isSameSeenVideoMark(previous, merged)) {
      byId.set(entry.videoId, merged)
      changed = true
    }
  }
  return changed
}

/**
 * A timestamp after every action in the marks.
 * @param {Iterable<SeenVideoMark>} marks
 */
export function latestSubscriptionSeenTimestamp(marks) {
  let latest = 0
  for (const entry of marks) latest = Math.max(latest, latestSeenVideoAction(entry))
  return latest
}
