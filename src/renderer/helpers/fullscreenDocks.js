/**
 * Height sharing for the stacked fullscreen information docks.
 *
 * The docks divide the player height between them by weight rather than by
 * pixels, so opening or closing one reflows the others without measuring
 * anything. Collapsing a dock hands its weight to a neighbour and remembers what
 * it had, so expanding it again can take that weight back.
 */

export const FULLSCREEN_DOCK_COLLAPSED_HEIGHT = 60
export const FULLSCREEN_DOCK_OUTER_INSET = 12
export const FULLSCREEN_DOCK_GAP = 12

/**
 * The weight a dock occupies while collapsed, i.e. just its header.
 *
 * @param {string[]} openDocks
 * @param {string} dock
 * @param {Record<string, number>} weights
 * @param {number} containerHeight
 */
export function getFullscreenDockCollapsedWeight(openDocks, dock, weights, containerHeight) {
  const index = openDocks.indexOf(dock)
  const panelChrome = index === 0 || index === openDocks.length - 1
    ? FULLSCREEN_DOCK_OUTER_INSET + FULLSCREEN_DOCK_GAP / 2
    : FULLSCREEN_DOCK_GAP
  const totalWeight = openDocks.reduce((total, name) => total + weights[name], 0)

  return (FULLSCREEN_DOCK_COLLAPSED_HEIGHT + panelChrome) / containerHeight * totalWeight
}

/**
 * The dock a collapsing dock hands its weight to: the nearest one that is still
 * expanded. Piling the weight onto an already collapsed neighbour would render
 * that one expanded again while it still counts as collapsed, and would leave
 * nothing to restore from.
 *
 * Returns `null` when every other open dock is already collapsed, as there is
 * then nothing left to give the freed height to.
 *
 * @param {string[]} openDocks
 * @param {string} dock
 * @param {Record<string, { neighbor: string, weight: number } | null>} collapsedState
 */
export function getFullscreenDockCollapseNeighbor(openDocks, dock, collapsedState) {
  const index = openDocks.indexOf(dock)

  return [openDocks[index + 1], openDocks[index - 1], ...openDocks]
    .find(name => name != null && name !== dock && collapsedState[name] == null) ?? null
}

/** Weight differences below this are rounding noise rather than real height. */
const WEIGHT_EPSILON = 1e-9

/**
 * The docks a collapsed dock's weight was handed down through, nearest first.
 *
 * Collapsing lends weight to a neighbour, and collapsing that neighbour lends it
 * on again, so reclaiming has to follow the same path back. Guards against a
 * cycle, which two docks that were collapsed onto each other can form.
 *
 * @param {string | undefined} preferredDonor
 * @param {Record<string, { neighbor: string, weight: number } | null>} collapsedState
 */
function getFullscreenDockLoanChain(preferredDonor, collapsedState) {
  const chain = []
  let name = preferredDonor

  while (name != null && !chain.includes(name)) {
    chain.push(name)
    name = collapsedState[name]?.neighbor
  }

  return chain
}

/**
 * Frees up to `amount` of weight from the other open docks and reports how much
 * it could free. Mutates `weights`, and `collapsedState` when a loan has to be
 * charged against a borrower that cannot pay it out of its live weight.
 *
 * The donors keep at least their collapsed size. A dock that was collapsed after
 * lending its weight out has already passed it on, so charging it again would
 * drive it below zero and invert the whole stack.
 *
 * @param {string[]} openDocks
 * @param {string} dock
 * @param {number} amount
 * @param {Record<string, number>} weights
 * @param {Record<string, { neighbor: string, weight: number } | null>} collapsedState
 * @param {number} containerHeight
 * @param {string} [preferredDonor]
 */
export function takeFullscreenDockWeight(openDocks, dock, amount, weights, collapsedState, containerHeight, preferredDonor) {
  const donors = openDocks
    .filter(name => name !== dock)
    .map(name => ({
      name,
      spare: Math.max(0, weights[name] -
        getFullscreenDockCollapsedWeight(openDocks, name, weights, containerHeight))
    }))

  // A lone dock fills the height whatever its weight, so there is nothing to
  // reclaim from and nothing to take into account: hand it the weight outright,
  // ready for the next dock that opens alongside it
  if (donors.length === 0) {
    return amount
  }

  let remaining = amount

  // Walk the chain of loans: the dock this one lent to pays first, then whoever
  // that dock lent to when it was collapsed in turn, and so on. Following the
  // chain is what keeps the weight moving back along the path it took, instead
  // of being reclaimed from docks that never received any of it.
  for (const name of getFullscreenDockLoanChain(preferredDonor, collapsedState)) {
    if (remaining <= WEIGHT_EPSILON) {
      break
    }

    const donor = donors.find(candidate => candidate.name === name)
    if (donor == null) {
      continue
    }

    const paid = Math.min(donor.spare, remaining)
    weights[name] -= paid
    donor.spare -= paid
    remaining -= paid

    // A borrower that was collapsed in the meantime has already handed the
    // weight on and cannot pay out of its live weight. Charge what it still owes
    // against what it remembers being owed, otherwise it would later reclaim
    // weight that stopped being its own and squeeze another dock down to nothing
    // that no double click can undo.
    const borrowerState = remaining > WEIGHT_EPSILON ? collapsedState[name] : null
    if (borrowerState != null) {
      borrowerState.weight = Math.max(weights[name], borrowerState.weight - remaining)
    }
  }

  if (remaining <= WEIGHT_EPSILON) {
    return amount
  }

  const payingDonors = donors.filter(donor => donor.spare > 0)
  const totalSpare = payingDonors.reduce((total, donor) => total + donor.spare, 0)
  if (totalSpare === 0) {
    return amount - remaining
  }

  const taken = Math.min(remaining, totalSpare)
  for (const donor of payingDonors) {
    weights[donor.name] -= taken * donor.spare / totalSpare
  }

  return amount - remaining + taken
}

/**
 * Collapses the dock to its header, or expands it back. Mutates `weights` and
 * `collapsedState`, and reports whether anything changed.
 *
 * @param {string[]} openDocks
 * @param {string} dock
 * @param {Record<string, number>} weights
 * @param {Record<string, { neighbor: string, weight: number } | null>} collapsedState
 * @param {number} containerHeight
 */
export function toggleFullscreenDockCollapsed(openDocks, dock, weights, collapsedState, containerHeight) {
  if (!openDocks.includes(dock)) {
    return false
  }

  const savedState = collapsedState[dock]

  // Expanding stays available even once the dock is the only one left open: the
  // siblings it was collapsed next to may have been closed in the meantime, and
  // it has to be able to take its remembered height back before they reopen
  if (savedState) {
    collapsedState[dock] = null
    weights[dock] += takeFullscreenDockWeight(
      openDocks,
      dock,
      savedState.weight - weights[dock],
      weights,
      collapsedState,
      containerHeight,
      savedState.neighbor
    )

    return true
  }

  // Collapsing needs somewhere to put the freed height, so it needs a sibling
  if (openDocks.length < 2) {
    return false
  }

  const neighbor = getFullscreenDockCollapseNeighbor(openDocks, dock, collapsedState)
  if (neighbor == null) {
    return false
  }

  const collapsedWeight = getFullscreenDockCollapsedWeight(openDocks, dock, weights, containerHeight)
  collapsedState[dock] = { neighbor, weight: weights[dock] }
  weights[neighbor] += weights[dock] - collapsedWeight
  weights[dock] = collapsedWeight

  return true
}
