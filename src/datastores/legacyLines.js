// @ts-check
// No imports: Capacitor's NeDB storage adapter uses this, and NeDB loads that adapter.

/**
 * The lines of a NeDB datafile without the given documents, including their
 * earlier versions and deletions, or null when it has none of them.
 * @param {string | null | undefined} raw
 * @param {string[]} ids
 * @returns {string[] | null}
 */
export function legacyLinesWithout(raw, ids) {
  const removed = new Set(ids)
  const lines = (raw ?? '').split('\n').filter(line => line !== '')
  const kept = lines.filter(line => {
    try {
      return !removed.has(JSON.parse(line)._id)
    } catch {
      // NeDB decides what to make of a line it cannot parse.
      return true
    }
  })
  return kept.length === lines.length ? null : kept
}
