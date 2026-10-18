/**
 * Coordinates the single scroll mini player that may be shown outside its
 * source tab. Multiple logical tabs can keep a player mounted, but only the
 * most recently left video tab should float above the presented tab.
 */

import { shallowRef } from 'vue'

/**
 * @typedef {{
 *   canShow: () => boolean,
 *   hide: () => void,
 *   show: () => boolean
 * }} CrossTabMiniPlayerCandidate
 */

/** @type {CrossTabMiniPlayerCandidate | null} */
let latestCandidate = null

/**
 * Reactive, so the presented tab can yield its own scroll mini player when
 * another tab takes over or releases the floating player.
 *
 * @type {import('vue').ShallowRef<CrossTabMiniPlayerCandidate | null>}
 */
const owner = shallowRef(null)

/**
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
function showCandidate(candidate) {
  if (owner.value === candidate) {
    return
  }

  owner.value?.hide()
  owner.value = candidate
  // A hidden tab that cannot measure its player stays inline, so it must not
  // keep ownership and stop the presented tab from docking its own player.
  if (!candidate.show()) {
    owner.value = null
  }
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
  if (owner.value === candidate && !candidate.canShow()) {
    owner.value = null
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
  return owner.value === candidate
}

/**
 * @returns {boolean}
 */
export function hasCrossTabMiniPlayerOwner() {
  return owner.value !== null
}

/**
 * Releases a player that no longer presents its detached mini player.
 *
 * @param {CrossTabMiniPlayerCandidate} candidate
 */
export function releaseCrossTabMiniPlayerOwnership(candidate) {
  if (owner.value === candidate) {
    owner.value = null
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
