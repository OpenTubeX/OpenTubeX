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
 * @typedef {object} SeekHistory
 * @property {readonly number[]} positions Places jumped away from, oldest first.
 * @property {number} index The entry being revisited, or `positions.length` while none is.
 */

/** @typedef {{ history: SeekHistory, target: number }} SeekHistoryStep */

/** @type {SeekHistory} */
export const EMPTY_SEEK_HISTORY = Object.freeze({ positions: Object.freeze([]), index: 0 })

/**
 * Histories last for the app session, so they survive player reloads and
 * reopening a video.
 * @type {Map<string, SeekHistory>}
 */
const histories = new Map()

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
  if (history.positions.length === 0) return

  histories.set(key, history)
  if (histories.size > SEEK_HISTORY_MAX_VIDEOS) {
    histories.delete(histories.keys().next().value)
  }
}

export function clearSeekHistories() {
  histories.clear()
}

/**
 * @param {readonly number[]} positions
 * @param {number} position
 * @returns {number[]}
 */
function appendPosition(positions, position) {
  return [
    ...positions.filter(entry => Math.abs(entry - position) >= SEEK_HISTORY_SAME_PLACE_SECONDS),
    position,
  ].slice(-SEEK_HISTORY_MAX_ENTRIES)
}

/**
 * Records leaving `from` with a new jump. A revisited entry moves to the end,
 * as it is the place being left.
 * @param {SeekHistory} history
 * @param {number} from
 * @returns {SeekHistory}
 */
export function recordSeekHistoryJump(history, from) {
  const positions = appendPosition(
    history.positions.filter((_, index) => index !== history.index),
    from
  )
  return { positions, index: positions.length }
}

/**
 * @param {SeekHistory} history
 * @param {number} current
 * @returns {SeekHistoryStep | null}
 */
export function stepSeekHistoryBack(history, current) {
  // Remember the place being left so that stepping forward returns to it.
  const positions = history.index < history.positions.length
    ? history.positions.with(history.index, current)
    : appendPosition(history.positions, current)
  const index = Math.min(history.index, positions.length - 1)

  if (index <= 0) return null

  return { history: { positions, index: index - 1 }, target: positions[index - 1] }
}

/**
 * @param {SeekHistory} history
 * @param {number} current
 * @returns {SeekHistoryStep | null}
 */
export function stepSeekHistoryForward(history, current) {
  const { index } = history
  if (index >= history.positions.length - 1) return null

  const positions = history.positions.with(index, current)
  return { history: { positions, index: index + 1 }, target: positions[index + 1] }
}
