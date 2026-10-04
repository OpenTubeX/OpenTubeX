import { computed, isReactive } from 'vue'

const snapshots = new WeakMap()
const undecoratedSnapshots = new WeakMap()

/**
 * Track each channel's reactive entries once, rather than copying every entry
 * in the entire New feed after any channel changes. Replacements, in-place
 * metadata edits and seen-state changes invalidate only the affected snapshot.
 * @param {object[]} entries
 * @param {boolean} [decorateEntries]
 * @returns {object[]}
 */
export function getNewSubscriptionEntriesSnapshot(entries, decorateEntries = true) {
  const select = () => {
    const selected = entries.filter(entry => entry.isNewInSubscriptionFeed === true)
    if (!decorateEntries) return selected
    return selected.map(entry => ({
      ...entry,
      hideNewSubscriptionFeedIndicator: true,
      isInNewSubscriptionFeed: true,
    }))
  }
  if (!isReactive(entries)) return select()

  const cache = decorateEntries ? snapshots : undecoratedSnapshots
  let snapshot = cache.get(entries)
  if (!snapshot) {
    snapshot = computed(select)
    cache.set(entries, snapshot)
  }
  return snapshot.value
}
