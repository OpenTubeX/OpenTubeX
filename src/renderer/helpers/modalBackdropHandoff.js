// @ts-check

/** @type {Set<HTMLElement>} */
const leavingBackdrops = new Set()

/**
 * Lets a modal that opens while this backdrop animates out take it over.
 * @param {HTMLElement} backdrop
 * @returns {() => void} Call once the backdrop is removed.
 */
export function trackLeavingModalBackdrop(backdrop) {
  leavingBackdrops.add(backdrop)
  return () => leavingBackdrops.delete(backdrop)
}

/**
 * A menu sheet that opens a dialog closes as the dialog opens. Clearing one
 * backdrop while the other builds up shows the page sharp in between, and
 * fully so when a slow frame lets the first finish before the second starts.
 * Instead, the entering backdrop starts from the leaving one's current dim and
 * blur, and the leaving one stops painting them.
 * @param {HTMLElement} backdrop
 * @returns {{ backgroundColor: string, backdropFilter: string } | null} The
 *   entering backdrop's starting keyframe, or null if no backdrop is leaving.
 */
export function takeOverLeavingModalBackdrop(backdrop) {
  /** @type {{ backgroundColor: string, backdropFilter: string } | null} */
  let from = null
  for (const leaving of leavingBackdrops) {
    if (leaving === backdrop || !leaving.isConnected) continue
    const style = getComputedStyle(leaving)
    from ??= { backgroundColor: style.backgroundColor, backdropFilter: style.backdropFilter }
    // Important declarations override the leave animation.
    leaving.style.setProperty('background-color', 'transparent', 'important')
    leaving.style.setProperty('backdrop-filter', 'none', 'important')
    // It paints nothing now, so a later modal must not start from it.
    leavingBackdrops.delete(leaving)
  }
  return from
}
