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

/**
 * Frees up to `amount` of weight from the other open docks and reports how much
 * it could free. Mutates `weights`.
 *
 * The donors keep at least their collapsed size. A dock that was collapsed after
 * lending its weight out has already passed it on, so charging it again would
 * drive it below zero and invert the whole stack.
 *
 * @param {string[]} openDocks
 * @param {string} dock
 * @param {number} amount
 * @param {Record<string, number>} weights
 * @param {number} containerHeight
 * @param {string} [preferredDonor]
 */
export function takeFullscreenDockWeight(openDocks, dock, amount, weights, containerHeight, preferredDonor) {
  const donors = openDocks
    .filter(name => name !== dock)
    .map(name => ({
      name,
      spare: Math.max(0, weights[name] -
        getFullscreenDockCollapsedWeight(openDocks, name, weights, containerHeight))
    }))

  // Let the dock it borrowed from pay it all back first, so an otherwise
  // untouched stack returns to exactly the layout it had before collapsing
  const preferred = donors.find(donor => donor.name === preferredDonor)
  if (preferred != null && preferred.spare >= amount) {
    weights[preferred.name] -= amount
    return amount
  }

  const totalSpare = donors.reduce((total, donor) => total + donor.spare, 0)
  if (totalSpare === 0) {
    return 0
  }

  const taken = Math.min(amount, totalSpare)
  for (const donor of donors) {
    weights[donor.name] -= taken * donor.spare / totalSpare
  }

  return taken
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
  if (openDocks.length < 2 || !openDocks.includes(dock)) {
    return false
  }

  const savedState = collapsedState[dock]

  if (savedState) {
    collapsedState[dock] = null
    weights[dock] += takeFullscreenDockWeight(
      openDocks,
      dock,
      savedState.weight - weights[dock],
      weights,
      containerHeight,
      savedState.neighbor
    )

    return true
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
