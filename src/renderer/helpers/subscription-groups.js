export const SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS = {
  NameAscending: 'name_ascending',
  NameDescending: 'name_descending',
  Custom: 'custom',
}

/**
 * @typedef {object} SubscriptionGroup
 * @property {string} id
 * @property {string} name
 * @property {string[]} channelIds
 */

/**
 * Groups arrive from sync and settings imports, so only well-formed ones are used.
 * @param {unknown} value
 * @returns {SubscriptionGroup[]}
 */
export function normalizeSubscriptionGroups(value) {
  if (!Array.isArray(value)) return []

  const ids = new Set()
  const groups = []
  for (const group of value) {
    if (group === null || typeof group !== 'object' ||
      typeof group.id !== 'string' || group.id === '' || ids.has(group.id) ||
      typeof group.name !== 'string' || group.name.trim() === '') continue

    ids.add(group.id)
    groups.push({
      id: group.id,
      name: group.name.trim(),
      channelIds: normalizeChannelIds(group.channelIds),
    })
  }
  return groups
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeChannelIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(id => typeof id === 'string' && id !== ''))]
    : []
}

/**
 * @param {SubscriptionGroup[]} groups
 * @param {Intl.Collator} collator
 */
export function sortSubscriptionGroups(groups, collator) {
  return groups.toSorted((a, b) => collator.compare(a.name, b.name))
}

/**
 * @template {{ id: string }} T
 * @param {T[]} subscriptions
 * @param {SubscriptionGroup | null} group
 * @returns {T[]}
 */
export function filterSubscriptionsByGroup(subscriptions, group) {
  if (group == null) return subscriptions

  const channelIds = new Set(group.channelIds)
  return subscriptions.filter(channel => channelIds.has(channel.id))
}

/**
 * @template {{ id: string, name?: string }} T
 * @param {T[]} channels
 * @param {string} sortBy a SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS value
 * @param {string[]} customOrder channel IDs in the custom order
 * @param {Intl.Collator} collator
 * @returns {T[]}
 */
export function sortSubscribedChannels(channels, sortBy, customOrder, collator) {
  const compareNames = (a, b) => collator.compare(a.name ?? '', b.name ?? '')

  if (sortBy === SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS.Custom) {
    const positions = new Map(customOrder.map((id, index) => [id, index]))
    // Channels missing from the saved order, such as new subscriptions, come last.
    return channels.toSorted((a, b) => {
      return (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || compareNames(a, b)
    })
  }

  if (sortBy === SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS.NameDescending) {
    return channels.toSorted((a, b) => compareNames(b, a))
  }

  return channels.toSorted(compareNames)
}
