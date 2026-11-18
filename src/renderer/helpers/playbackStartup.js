// Starting a video needs the renderer thread, which a large subscription
// refresh keeps busy parsing and storing feeds. Refreshes wait between channels
// while a player loads its first media. A load that never settles releases its
// hold after this long, so it cannot stop the refresh.
const MAX_HOLD_MS = 15_000

/** @type {Map<object, string | null>} each hold and the tab that owns it */
const holds = new Map()
/** @type {Set<() => void>} */
const waiters = new Set()

// Hidden tabs share the renderer and network with the shown one. Starting
// several of their videos at once delays the one the user switches to, so
// they start one at a time.
/** @type {string | null} */
let turnOwner = null
/** @type {ReturnType<typeof setTimeout> | undefined} */
let turnTimer
/** @type {{ owner: string, grant: () => void }[]} */
const turnQueue = []

/**
 * Pauses subscription refreshes between channels until the returned function
 * is called, or until the hold expires.
 * @param {string | null} [owner] the tab whose video is starting
 * @returns {() => void} releases the hold
 */
export function holdForPlaybackStartup(owner = null) {
  const hold = {}
  holds.set(hold, owner)
  const timer = setTimeout(release, MAX_HOLD_MS)

  function release() {
    clearTimeout(timer)
    if (!holds.delete(hold)) return
    if (owner !== null && owner === turnOwner) checkTurnAfterHandoff()
    if (holds.size > 0) return
    for (const resume of waiters) resume()
    waiters.clear()
  }

  return release
}

/**
 * Resolves once no player is loading its first media, or when the signal aborts.
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function waitForPlaybackStartup(signal) {
  // The Watch page hands its hold to the player in the same tick it releases
  // it, so check again after waking up.
  while (holds.size > 0 && !signal?.aborted) {
    await new Promise(resolve => {
      const resume = () => {
        waiters.delete(resume)
        signal?.removeEventListener('abort', resume)
        resolve()
      }
      waiters.add(resume)
      signal?.addEventListener('abort', resume, { once: true })
    })
  }
}

/**
 * Waits until no other hidden tab is starting its video. The turn passes on
 * once the owner's startup holds are released, or after the hold timeout.
 * @param {string} owner the hidden tab
 * @param {AbortSignal} signal stops waiting, e.g. once the tab is shown
 * @returns {Promise<void>}
 */
export function waitForBackgroundPlaybackTurn(owner, signal) {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    // A replacement load keeps the current turn, so it cannot extend it
    if (turnOwner === owner) {
      resolve()
      return
    }
    if (turnOwner === null) {
      takeTurn(owner)
      resolve()
      return
    }

    const entry = {
      owner,
      grant: () => {
        signal.removeEventListener('abort', cancel)
        takeTurn(owner)
        resolve()
      }
    }
    function cancel() {
      turnQueue.splice(turnQueue.indexOf(entry), 1)
      resolve()
    }
    turnQueue.push(entry)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

/** @param {string} owner */
function takeTurn(owner) {
  clearTimeout(turnTimer)
  turnOwner = owner
  turnTimer = setTimeout(passTurn, MAX_HOLD_MS)
  // A load that ends before it holds, e.g. a replaced one, must not keep the turn
  checkTurnAfterHandoff()
}

function checkTurnAfterHandoff() {
  // The Watch page hands its hold to the player in the same tick it releases it
  const owner = turnOwner
  setTimeout(() => {
    if (turnOwner === owner && ![...holds.values()].includes(owner)) passTurn()
  })
}

function passTurn() {
  clearTimeout(turnTimer)
  turnOwner = null
  turnQueue.shift()?.grant()
}
