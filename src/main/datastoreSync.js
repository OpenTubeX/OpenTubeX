// @ts-check
import { SyncEvents } from '../constants.js'

let latestRevision = 0

/**
 * Numbers a message that tells windows about a datastore change. Send it right
 * after the change, inside `writeSynced`. Broadcasts and invoke replies reach a
 * window through different Mojo pipes, which can reorder them, and a starting
 * window holds broadcasts back until it listens, so windows use the revision to
 * drop messages that a save or a read they already have contains.
 * @template {object} T
 * @param {T} message
 * @returns {T & { revision: number }}
 */
export function numberSyncMessage(message) {
  return { ...message, revision: ++latestRevision }
}

/**
 * Builds the `SYNC_SETTINGS` message for a saved setting.
 * @param {string} _id
 * @param {unknown} value
 */
export function settingSyncMessage(_id, value) {
  return numberSyncMessage({ event: SyncEvents.GENERAL.UPSERT, data: { _id, value } })
}

/**
 * Lets either full reads or writes of a datastore run, never both at once. A
 * kind waits for the other kind to finish, and an entry that has to wait holds
 * back later ones, so neither kind starves the other.
 */
function createGate() {
  /** @type {'read' | 'write' | null} */
  let runningKind = null
  let running = 0
  /** @type {{ kind: 'read' | 'write', start: () => void }[]} */
  const waiting = []

  /**
   * @template T
   * @param {'read' | 'write'} kind
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  return async (kind, task) => {
    if (waiting.length > 0 || (running > 0 && runningKind !== kind)) {
      await new Promise(resolve => waiting.push({ kind, start: () => resolve(undefined) }))
    } else {
      runningKind = kind
      running++
    }
    try {
      return await task()
    } finally {
      running--
      while (waiting.length > 0 && (running === 0 || runningKind === waiting[0].kind)) {
        const next = /** @type {typeof waiting[number]} */ (waiting.shift())
        runningKind = next.kind
        running++
        next.start()
      }
    }
  }
}

/** @type {Map<string, ReturnType<typeof createGate>>} */
const gates = new Map()

/** @param {string} syncChannel */
function gate(syncChannel) {
  let channelGate = gates.get(syncChannel)
  if (!channelGate) {
    channelGate = createGate()
    gates.set(syncChannel, channelGate)
  }
  return channelGate
}

/**
 * Runs a datastore change and the messages it sends on `syncChannels`. Full
 * reads of those datastores wait for it, so each read reflects exactly the
 * messages up to the revision it returns. `write` must not wait for another
 * `writeSynced` call, which could wait for a read that waits for this one.
 * @template T
 * @param {string[]} syncChannels
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
export function writeSynced(syncChannels, write) {
  // A fixed order keeps writes of several datastores from blocking each other.
  return [...new Set(syncChannels)].sort().reduceRight(
    (task, syncChannel) => () => gate(syncChannel)('write', task),
    write
  )()
}

/**
 * Reads a whole datastore whose changes are sent on `syncChannel`.
 * @template T
 * @param {string} syncChannel
 * @param {() => Promise<T>} read
 * @returns {Promise<{ result: T, revision: number }>}
 */
export function readSynced(syncChannel, read) {
  return gate(syncChannel)('read', async () => {
    // No change of this datastore runs, so later messages get higher revisions.
    const revision = latestRevision
    return { result: await read(), revision }
  })
}
