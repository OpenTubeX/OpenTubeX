/**
 * How far ahead of the player replay messages are fetched, in milliseconds.
 */
export const REPLAY_PREFETCH_MS = 20_000

/**
 * A jump of more than this many seconds between two player position updates is
 * treated as a seek rather than as normal playback.
 */
export const REPLAY_SEEK_TOLERANCE_SECONDS = 5

/**
 * @param {string|undefined} videoOffsetTimeMsec the raw offset of a replay action
 * @returns {number} the player position the action belongs to, in milliseconds
 */
export function parseReplayOffsetMs(videoOffsetTimeMsec) {
  const offsetMs = Number.parseInt(videoOffsetTimeMsec)

  return Number.isFinite(offsetMs) && offsetMs > 0 ? offsetMs : 0
}

/**
 * Playback moves the position forward in small steps, so anything else is the
 * player having jumped somewhere, which the replay has to be re-anchored to.
 * @param {number} previousSeconds the previously seen player position
 * @param {number} currentSeconds the current player position
 * @returns {boolean}
 */
export function isReplaySeek(previousSeconds, currentSeconds) {
  const elapsedSeconds = currentSeconds - previousSeconds

  return elapsedSeconds < 0 || elapsedSeconds > REPLAY_SEEK_TOLERANCE_SECONDS
}

/**
 * Removes the buffered messages that the player has reached from `pending`
 * and returns them, oldest first.
 * @param {{ offsetMs: number, comment: any }[]} pending buffered messages, oldest first
 * @param {number} currentSeconds the current player position
 * @returns {{ offsetMs: number, comment: any }[]}
 */
export function takeDueReplayComments(pending, currentSeconds) {
  const currentOffsetMs = currentSeconds * 1000

  let dueCount = 0
  while (dueCount < pending.length && pending[dueCount].offsetMs <= currentOffsetMs) {
    dueCount++
  }

  return pending.splice(0, dueCount)
}

/**
 * Unlike the pending messages, the position the replay has been fetched up to
 * doesn't shrink as messages are shown, so stretches of the stream without any
 * chat activity don't look like an empty buffer.
 * @param {number} fetchedUntilMs the player position the replay has been fetched up to
 * @param {number} currentSeconds the current player position
 * @returns {boolean}
 */
export function shouldPrefetchReplay(fetchedUntilMs, currentSeconds) {
  return fetchedUntilMs < currentSeconds * 1000 + REPLAY_PREFETCH_MS
}

/**
 * Wraps a poll so that only one runs at a time, and a request made while one is
 * already running re-runs it afterwards instead of being dropped.
 *
 * Dropping it is not safe: a seek discards the response of the poll that is in
 * flight, so the request that follows the seek is the only thing that would fetch
 * the new position. Losing it leaves the chat empty until something else happens
 * to trigger a poll, which never comes while the video is paused.
 * @param {() => Promise<void>} poll
 * @returns {() => Promise<void>}
 */
export function createCoalescingPoller(poll) {
  let inFlight = false
  let pending = false

  return async function request() {
    if (inFlight) {
      pending = true
      return
    }

    inFlight = true

    try {
      await poll()
    } finally {
      inFlight = false
    }

    if (pending) {
      pending = false
      await request()
    }
  }
}
