import { computed, isReactive } from 'vue'

const snapshots = new WeakMap()

/**
 * Track each channel's New selection once while retaining reactive entries.
 * Display-only overrides belong on rendered cards, not the full cache.
 * Replacements and seen-state changes invalidate only the affected snapshot.
 * @param {object[]} entries
 * @returns {object[]}
 */
export function getNewSubscriptionEntriesSnapshot(entries) {
  const select = () => entries.filter(entry => entry.isNewInSubscriptionFeed === true)
  if (!isReactive(entries)) return select()

  let snapshot = snapshots.get(entries)
  if (!snapshot) {
    snapshot = computed(select)
    snapshots.set(entries, snapshot)
  }
  return snapshot.value
}
