// Restarting a chapter this early goes to the previous one instead, so a
// repeated restart steps back through the chapters.
export const CHAPTER_RESTART_THRESHOLD_SECONDS = 3
// A seek to a chapter start can land a rounding error before it.
const CHAPTER_START_TOLERANCE_SECONDS = 0.001

/**
 * Finds the chapter to seek to from the playback time rather than the chapter
 * index the page reports, which only catches up after the next time update.
 * @param {{ startSeconds: number }[]} chapters sorted by start
 * @param {number} currentTime
 * @param {'next' | 'previous' | 'restart'} action `restart` returns to the
 * start of the current chapter, or the previous one near its start.
 * @returns {number | null} the index of the chapter to seek to
 */
export function getChapterNavigationTarget(chapters, currentTime, action) {
  const index = chapters.findLastIndex(({ startSeconds }) => startSeconds <= currentTime + CHAPTER_START_TOLERANCE_SECONDS)

  if (action === 'next') return index < chapters.length - 1 ? index + 1 : null
  if (index < 0) return null
  if (action === 'previous') return index > 0 ? index - 1 : null
  return index > 0 && currentTime - chapters[index].startSeconds < CHAPTER_RESTART_THRESHOLD_SECONDS
    ? index - 1
    : index
}
