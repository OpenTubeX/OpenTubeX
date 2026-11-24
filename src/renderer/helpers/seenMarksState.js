// @ts-check
import { markRaw, shallowReactive } from 'vue'
import { applySeenMarkChanges, isSeenMarksState, mergeSeenMarks } from '../../seenMarks.js'

/**
 * Seen marks as the store keeps them. Merges change `byId` in place, so only
 * what reads a changed item updates, and replace this object, so watchers
 * learn that the marks changed.
 * @param {import('../../seenMarks.js').SeenMarkKind<any>} kind
 * @param {unknown} value a saved value, as a JSON string or an array, or the store's marks
 * @returns {import('../../seenMarks.js').SeenMarksState}
 */
export function seenMarksState(kind, value) {
  if (isSeenMarksState(value)) return value
  return markRaw({
    byId: shallowReactive(new Map(mergeSeenMarks(kind, value, []).map(entry => [entry[kind.idKey], entry])))
  })
}

/**
 * The store's marks after a merge's changes.
 * @param {import('../../seenMarks.js').SeenMarkKind<any>} kind
 * @param {import('../../seenMarks.js').SeenMarksState} marks
 * @param {import('../../seenMarks.js').SeenMarkChanges<unknown> | null | undefined} changes
 * @returns {import('../../seenMarks.js').SeenMarksState}
 */
export function withSeenMarkChanges(kind, marks, changes) {
  return applySeenMarkChanges(kind, marks.byId, changes) ? markRaw({ byId: marks.byId }) : marks
}
