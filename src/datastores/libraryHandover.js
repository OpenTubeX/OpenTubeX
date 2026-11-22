// @ts-check
// The web build's library opens every database file exclusively, so only one
// tab can use it. A tab that opens it takes it over: the tab that had it saves
// what it was doing, closes the library and reloads to a page that offers to
// take it back.

// Held by sqliteWorker.js while it has the library open
const LIBRARY_LOCK = 'opentubex-library'
const HANDED_OVER_KEY = 'opentubex-library-handed-over'

/** @type {{ time: number, id: number } | null} */
let claim = null
/** @type {BroadcastChannel | null} */
let channel = null
/** @type {() => Promise<void> | void} */
let takenOver = () => {}

/** @type {(() => void) | null} */
let resolveAvailable = null
/** Settles once this tab may open the library, or stays pending while another tab has it. */
let available = readHandedOver()
  ? new Promise(resolve => { resolveAvailable = () => resolve(undefined) })
  : Promise.resolve()

function readHandedOver() {
  try {
    return sessionStorage.getItem(HANDED_OVER_KEY) !== null
  } catch {
    return false
  }
}

function clearHandedOver() {
  try {
    sessionStorage.removeItem(HANDED_OVER_KEY)
  } catch {}
  resolveAvailable?.()
  resolveAvailable = null
}

/** @param {{ time: number, id: number }} other */
function isNewer(other) {
  return claim !== null && (other.time > claim.time || (other.time === claim.time && other.id > claim.id))
}

/**
 * Whether this tab handed the library over and another tab still has it.
 * Otherwise this tab may take it again, for example after the other tab closed.
 */
export async function libraryInUseElsewhere() {
  if (!readHandedOver()) return false
  const { held = [] } = await navigator.locks.query()
  if (held.some(lock => lock.name === LIBRARY_LOCK)) return true
  clearHandedOver()
  return false
}

/** Takes the library back from the tab that has it. */
export function useLibraryHere() {
  clearHandedOver()
  location.reload()
}

/**
 * Runs before this tab hands the library over, to save what it was doing.
 * @param {() => Promise<void> | void} callback
 */
export function onLibraryTakenOver(callback) {
  takenOver = callback
}

/** Settles once this tab may open the library. */
export function whenLibraryAvailable() {
  return available
}

/**
 * Tells the other tabs that this one opens the library. A tab that has it, or
 * claimed it before this one, hands it over: `release` must finish its
 * requests and close the library, which ends the worker's lock.
 * @param {() => Promise<void>} release
 */
export function claimLibrary(release) {
  if (typeof BroadcastChannel === 'undefined') return
  // Tabs that claim at the same time agree on the last claim as the winner.
  claim = { time: Date.now(), id: Math.random() }
  if (!channel) {
    channel = new BroadcastChannel(LIBRARY_LOCK)
    channel.onmessage = ({ data }) => {
      if (isNewer(data)) {
        claim = null
        handOver(release)
      } else if (claim) {
        // The older claim's tab may have started listening after this tab's claim.
        channel?.postMessage(claim)
      }
    }
  }
  channel.postMessage(claim)
}

/** @param {() => Promise<void>} release */
async function handOver(release) {
  available = new Promise(() => {})
  try {
    await takenOver()
  } catch (error) {
    console.error('Failed to save before another tab opened the library:', error)
  }
  await release()
  try {
    sessionStorage.setItem(HANDED_OVER_KEY, '')
  } catch {}
  location.reload()
}
