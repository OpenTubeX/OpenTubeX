import { shallowReactive } from 'vue'

/**
 * The places a viewer jumped away from in a video, so that a misclicked seek
 * never loses their position. Like an editor's jump list, stepping back and
 * forward walks the entries, and a new jump keeps the newer entries instead of
 * discarding them.
 */

/** Shorter jumps adjust the position instead of leaving a place. */
export const SEEK_HISTORY_MIN_JUMP_SECONDS = 15
/** Positions closer than this are the same place. */
const SEEK_HISTORY_SAME_PLACE_SECONDS = 5
export const SEEK_HISTORY_MAX_ENTRIES = 50
const SEEK_HISTORY_MAX_VIDEOS = 50

/**
 * @typedef {object} SeekHistoryEntry
 * @property {number} position
 * @property {number} leftAt When the viewer last left the position, in milliseconds since the epoch.
 */

/**
 * @typedef {object} SeekHistory
 * @property {readonly SeekHistoryEntry[]} entries Places jumped away from, oldest first.
 * @property {number} index The entry being revisited, or `entries.length` while none is.
 */

/** @typedef {{ history: SeekHistory, target: number }} SeekHistoryStep */

/** @type {SeekHistory} */
export const EMPTY_SEEK_HISTORY = Object.freeze({ entries: Object.freeze([]), index: 0 })

/**
 * Histories last for the app session, so they survive player reloads and
 * reopening a video. They are reactive so that every player showing a video
 * follows changes made in another.
 * @type {Map<string, SeekHistory>}
 */
const histories = shallowReactive(new Map())

/**
 * @param {string} key
 * @returns {SeekHistory}
 */
export function getSeekHistory(key) {
  return histories.get(key) ?? EMPTY_SEEK_HISTORY
}

/**
 * @param {string} key
 * @param {SeekHistory} history
 */
export function setSeekHistory(key, history) {
  // Reinsert so that the least recently changed video is evicted first.
  histories.delete(key)
  if (history.entries.length === 0) return

  histories.set(key, history)
  if (histories.size > SEEK_HISTORY_MAX_VIDEOS) {
    histories.delete(histories.keys().next().value)
  }
}

export function clearSeekHistories() {
  histories.clear()
}

/**
 * @param {readonly SeekHistoryEntry[]} entries
 * @param {SeekHistoryEntry} entry
 * @returns {SeekHistoryEntry[]}
 */
function appendEntry(entries, entry) {
  return [
    ...entries.filter(({ position }) => Math.abs(position - entry.position) >= SEEK_HISTORY_SAME_PLACE_SECONDS),
    entry,
  ].slice(-SEEK_HISTORY_MAX_ENTRIES)
}

/**
 * Records leaving `from` with a new jump. A revisited entry moves to the end,
 * as it is the place being left.
 * @param {SeekHistory} history
 * @param {number} from
 * @param {number} [now]
 * @returns {SeekHistory}
 */
export function recordSeekHistoryJump(history, from, now = Date.now()) {
  const entries = appendEntry(
    history.entries.filter((_, index) => index !== history.index),
    { position: from, leftAt: now }
  )
  return { entries, index: entries.length }
}

/**
 * @param {SeekHistory} history
 * @param {number} current
 * @param {number} [now]
 * @returns {SeekHistoryStep | null}
 */
export function stepSeekHistoryBack(history, current, now = Date.now()) {
  // Remember the place being left so that stepping forward returns to it.
  const left = { position: current, leftAt: now }
  const entries = history.index < history.entries.length
    ? history.entries.with(history.index, left)
    : appendEntry(history.entries, left)
  const index = Math.min(history.index, entries.length - 1)

  if (index <= 0) return null

  return { history: { entries, index: index - 1 }, target: entries[index - 1].position }
}

/**
 * @param {SeekHistory} history
 * @param {number} current
 * @param {number} [now]
 * @returns {SeekHistoryStep | null}
 */
export function stepSeekHistoryForward(history, current, now = Date.now()) {
  const { index } = history
  if (index >= history.entries.length - 1) return null

  const entries = history.entries.with(index, { position: current, leftAt: now })
  return { history: { entries, index: index + 1 }, target: entries[index + 1].position }
}
