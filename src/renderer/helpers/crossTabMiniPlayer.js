/**
 * Coordinates the single scroll mini player that may be shown outside its
 * source tab. Multiple logical tabs can keep a player mounted, but only the
 * most recently left video tab should float above the presented tab.
 */

/**
 * @typedef {{
 *   canShow: () => boolean,
 *   hide: () => void,
 *   show: () => void
 * }} CrossTabMiniPlayerCandidate
 */

/** @type {CrossTabMiniPlayerCandidate | null} */
let latestCandidate = null

/** @type {CrossTabMiniPlayerCandidate | null} */
let owner = null

/**
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
function showCandidate(candidate) {
  if (owner === candidate) {
    return
  }

  owner?.hide()
  owner = candidate
  candidate.show()
}

/**
 * Records that a player tab was left and shows it when the preference allows.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function markCrossTabMiniPlayerInactive(candidate) {
  latestCandidate = candidate
  refreshCrossTabMiniPlayer(candidate)
}

/**
 * Stops presenting a player that has become the active tab again.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function markCrossTabMiniPlayerActive(candidate) {
  if (latestCandidate === candidate) {
    latestCandidate = null
  }

  releaseCrossTabMiniPlayerOwnership(candidate)
}

/**
 * Applies preference and playback-state changes to a mounted candidate.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function refreshCrossTabMiniPlayer(candidate) {
  if (owner === candidate && !candidate.canShow()) {
    owner = null
    candidate.hide()
    return
  }

  if (latestCandidate === candidate && candidate.canShow()) {
    showCandidate(candidate)
  }
}

/**
 * @param {CrossTabMiniPlayerCandidate} candidate
 * @returns {boolean}
 */
export function isCrossTabMiniPlayerOwner(candidate) {
  return owner === candidate
}

/**
 * @returns {boolean}
 */
export function hasCrossTabMiniPlayerOwner() {
  return owner !== null
}

/**
 * Releases a player that no longer presents its detached mini player.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function releaseCrossTabMiniPlayerOwnership(candidate) {
  if (owner === candidate) {
    owner = null
  }
}

/**
 * Removes an unmounted player from the coordinator.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function unregisterCrossTabMiniPlayer(candidate) {
  if (latestCandidate === candidate) {
    latestCandidate = null
  }
  releaseCrossTabMiniPlayerOwnership(candidate)
}
