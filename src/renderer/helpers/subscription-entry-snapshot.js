import { computed, isReactive } from 'vue'

const snapshots = new WeakMap()

/**
 * Track each channel's reactive entries once, rather than copying every entry
 * in the entire New feed after any channel changes. Replacements, in-place
 * metadata edits and seen-state changes invalidate only the affected snapshot.
 * @param {object[]} entries
 * @returns {object[]}
 */
export function getNewSubscriptionEntriesSnapshot(entries) {
  const select = () => entries.filter(entry => entry.isNewInSubscriptionFeed === true).map(entry => ({
    ...entry,
    hideNewSubscriptionFeedIndicator: true,
    isInNewSubscriptionFeed: true,
  }))
  if (!isReactive(entries)) return select()

  let snapshot = snapshots.get(entries)
  if (!snapshot) {
    snapshot = computed(select)
    snapshots.set(entries, snapshot)
  }
  return snapshot.value
}
