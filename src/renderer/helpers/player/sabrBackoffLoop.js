// How many backoffs a VOD may be told to wait through without a single segment
// arriving before we treat it as a loop rather than a wait.
export const MAX_BACKOFFS_WITHOUT_PROGRESS = 3

/**
 * Tracks server-requested backoffs that produce no playback.
 *
 * This has to belong to the stream rather than to a single request: the server
 * hands out one short backoff per request, so a tracker scoped to a request is
 * thrown away before it can ever reach the threshold and the loop never breaks.
 * `reset` is called as soon as a segment arrives, so an otherwise healthy video
 * that hits the occasional isolated backoff never accumulates towards a reload.
 */
export function createBackoffLoopTracker() {
  let cumulativeTimeMs = 0
  let requested = 0

  return {
    /**
     * Records a backoff and reports whether it has become a loop that only a
     * player reload can break.
     * @param {{ backoffTimeMs: number, isLive: boolean, timeoutMs: number }} options
     */
    record({ backoffTimeMs, isLive, timeoutMs }) {
      cumulativeTimeMs += backoffTimeMs
      requested += 1

      return (!isLive && requested >= MAX_BACKOFFS_WITHOUT_PROGRESS) ||
        (timeoutMs > 0 && timeoutMs <= cumulativeTimeMs + backoffTimeMs)
    },

    /** A segment arrived, so the stream is progressing again. */
    reset() {
      cumulativeTimeMs = 0
      requested = 0
    }
  }
}
