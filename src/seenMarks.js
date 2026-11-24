// @ts-check

/**
 * Lists of seen marks that sync, such as those of subscription videos, posts
 * and RSS feed items. Each is saved as one setting, a JSON array that holds a
 * mark per item and keeps the most recently marked items. A merge reports
 * what it changed, which windows apply instead of reading the whole list again.
 */

/**
 * How one kind of marks is read and combined.
 * @template {SeenMarkEntry} T
 * @typedef {object} SeenMarkKind
 * @property {string} idKey the field that identifies the marked item
 * @property {number} max how many marks the list keeps
 * @property {(entries: unknown[]) => T[]} parse the valid marks of a list
 * @property {(previous: T | undefined, entry: T) => T} merge combines a mark
 *   with an earlier result of this function for the same item
 * @property {(entry: T) => number} latest the time of the mark's latest action
 */

/** @typedef {Record<string, any> & { seenAt?: number, unseenAt?: number }} SeenMarkEntry */

/**
 * What a merge changed in the saved marks: the marks it saved, and the marks
 * it dropped as they were saved before.
 * @template T
 * @typedef {{ upserts: T[], removals: T[] }} SeenMarkChanges
 */

/**
 * The marks the store keeps, see `seenMarksState`.
 * @typedef {{ byId: Map<string, any> }} SeenMarksState
 */

/**
 * @param {unknown} value
 * @returns {value is SeenMarksState}
 */
export function isSeenMarksState(value) {
  return typeof value === 'object' && value !== null && /** @type {any} */ (value).byId instanceof Map
}

/**
 * The entries of a saved value (a JSON string), a list, an index or the store's marks.
 * @param {unknown} value
 * @returns {unknown[]}
 */
function entriesOf(value) {
  if (isSeenMarksState(value)) return [...value.byId.values()]
  if (value instanceof Map) return [...value.values()]
  try {
    const entries = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/**
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {unknown} value see {@link entriesOf}
 * @returns {T[]}
 */
export function parseSeenMarks(kind, value) {
  return kind.parse(entriesOf(value))
}

/**
 * Each item's mark, merged from every mark of it in `value`.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {unknown} value see {@link entriesOf}
 * @returns {Map<string, T>}
 */
export function indexSeenMarks(kind, value) {
  /** @type {Map<string, T>} */
  const byId = new Map()
  for (const entry of parseSeenMarks(kind, value)) {
    const id = /** @type {string} */ (entry[kind.idKey])
    byId.set(id, kind.merge(byId.get(id), entry))
  }
  return byId
}

/**
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 */
function byIdOf(kind) {
  /** @param {T} a @param {T} b */
  return (a, b) => a[kind.idKey] < b[kind.idKey] ? -1 : a[kind.idKey] > b[kind.idKey] ? 1 : 0
}

/**
 * The marks a list keeps, newest first.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {T[]} entries one per item
 * @param {(entry: T) => boolean} keep whether a mark may stay at all
 */
function retainSeenMarks(kind, entries, keep) {
  const byId = byIdOf(kind)
  // Break timestamp ties by ID so devices retain the same set regardless of merge order.
  return entries.filter(keep)
    .sort((a, b) => kind.latest(b) - kind.latest(a) || byId(a, b))
    .slice(0, kind.max)
}

/**
 * Both lists' marks that a list keeps, by ID.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {unknown} local see {@link entriesOf}
 * @param {unknown} remote see {@link entriesOf}
 * @param {(entry: T) => boolean} [keep] whether a mark may stay at all
 * @returns {T[]}
 */
export function mergeSeenMarks(kind, local, remote, keep = () => true) {
  const byId = indexSeenMarks(kind, [...parseSeenMarks(kind, local), ...parseSeenMarks(kind, remote)])
  return retainSeenMarks(kind, [...byId.values()], keep).sort(byIdOf(kind))
}

/**
 * @param {SeenMarkEntry} a
 * @param {SeenMarkEntry} b
 */
function isSameMark(a, b) {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}

/**
 * The changes that merging marks into saved ones makes, without changing them.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {Map<string, T>} saved see {@link indexSeenMarks}
 * @param {unknown} incoming see {@link entriesOf}
 * @param {(ids: string[]) => Promise<(entry: T) => boolean>} [keepFor] which
 *   of the marks of these items may stay at all. It gets the merged items, or
 *   every item once the list is full and evicts marks.
 * @returns {Promise<SeenMarkChanges<T>>}
 */
export async function planSeenMarkChanges(kind, saved, incoming, keepFor = async () => () => true) {
  /** @type {Map<string, T>} */
  const merged = new Map()
  for (const entry of parseSeenMarks(kind, incoming)) {
    const id = /** @type {string} */ (entry[kind.idKey])
    merged.set(id, kind.merge(merged.get(id) ?? saved.get(id), entry))
  }
  let size = saved.size
  for (const id of merged.keys()) if (!saved.has(id)) size++
  const isFull = size > kind.max
  const keep = await keepFor(isFull ? [...new Set([...saved.keys(), ...merged.keys()])] : [...merged.keys()])

  const retained = retainSeenMarks(kind, [...(isFull ? new Map([...saved, ...merged]) : merged).values()], keep)
  const retainedIds = new Set(retained.map(entry => entry[kind.idKey]))
  /** @type {SeenMarkChanges<T>} */
  const changes = { upserts: [], removals: [] }
  for (const id of isFull ? saved.keys() : merged.keys()) {
    const previous = saved.get(id)
    if (previous && !retainedIds.has(id)) changes.removals.push(previous)
  }
  for (const entry of retained) {
    const previous = saved.get(/** @type {string} */ (entry[kind.idKey]))
    if (!previous || !isSameMark(previous, entry)) changes.upserts.push(entry)
  }
  return changes
}

/** @param {SeenMarkChanges<unknown> | null | undefined} changes */
export function hasSeenMarkChanges(changes) {
  return (changes?.upserts?.length ?? 0) > 0 || (changes?.removals?.length ?? 0) > 0
}

/**
 * Applies a merge's changes to marks in place. Windows can receive the
 * changes of concurrent merges in any order, and changes they already have,
 * so applying them is commutative and idempotent: a dropped mark only leaves
 * when no newer mark of the item arrived first.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {Map<string, T>} byId
 * @param {SeenMarkChanges<unknown> | null | undefined} changes
 * @returns {boolean} whether the marks changed
 */
export function applySeenMarkChanges(kind, byId, changes) {
  let changed = false
  for (const removed of parseSeenMarks(kind, changes?.removals)) {
    const id = /** @type {string} */ (removed[kind.idKey])
    const current = byId.get(id)
    if (current && (current.seenAt ?? 0) <= (removed.seenAt ?? 0) && (current.unseenAt ?? 0) <= (removed.unseenAt ?? 0)) {
      byId.delete(id)
      changed = true
    }
  }
  for (const entry of parseSeenMarks(kind, changes?.upserts)) {
    const id = /** @type {string} */ (entry[kind.idKey])
    const previous = byId.get(id)
    const merged = kind.merge(previous, entry)
    if (!previous || !isSameMark(previous, merged)) {
      byId.set(id, merged)
      changed = true
    }
  }
  return changed
}

/**
 * The time of the latest action in the marks.
 * @template {SeenMarkEntry} T
 * @param {SeenMarkKind<T>} kind
 * @param {Iterable<T>} marks
 */
export function latestSeenMarkTimestamp(kind, marks) {
  let latest = 0
  for (const entry of marks) latest = Math.max(latest, kind.latest(entry))
  return latest
}
