// @ts-check
// The web build's library opens every database file exclusively, so only one
// tab can use it. A tab that opens it takes it over: the tab that had it saves
// what it was doing, closes the library and reloads to a page that offers to
// take it back.

// Held by the tab that may use the library, from before the previous tab
// releases it until the page ends. sqliteWorker.js holds its own lock while
// the library is open.
const OWNER_LOCK = 'opentubex-library-owner'
const HANDED_OVER_KEY = 'opentubex-library-handed-over'

let claimed = false
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

/**
 * Whether this tab handed the library over and another tab still has it.
 * Otherwise this tab may take it again, for example after the other tab closed.
 */
export async function libraryInUseElsewhere() {
  if (!readHandedOver()) return false
  const { held = [] } = await navigator.locks.query()
  if (held.some(lock => lock.name === OWNER_LOCK)) return true
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
 * Takes the library from the tab that has it, which hands it over once this
 * tab steals its lock: `release` must finish that tab's requests and close the
 * library, which ends its worker's lock. Of tabs that claim at the same time,
 * the last one keeps the library.
 * @param {() => Promise<void>} release
 */
export function claimLibrary(release) {
  // Without locks (plain http:// addresses), the worker reports why it cannot open the library.
  if (claimed || !navigator.locks) return
  claimed = true
  navigator.locks.request(OWNER_LOCK, { steal: true }, () => new Promise(() => {})).catch(error => {
    if (error?.name === 'AbortError') handOver(release)
    else console.error('Failed to claim the library:', error)
  })
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
