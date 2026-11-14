import { TAB_GROUP_ICONS } from '../../tabGroupIcons.js'

// The tab group icons, except the default one that stands for the tab organizer
export const SUBSCRIPTION_GROUP_ICONS = TAB_GROUP_ICONS.filter(icon => icon !== 'layer-group')

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
 * @property {string} [icon] a SUBSCRIPTION_GROUP_ICONS value
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
      ...(SUBSCRIPTION_GROUP_ICONS.includes(group.icon) ? { icon: group.icon } : {}),
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

/**
 * The group names of an imported subscription. A cell can list several
 * groups, separated by semicolons.
 * @param {string[]} cells
 * @returns {string[]}
 */
export function parseImportedGroupNames(cells) {
  return [...new Set(cells.flatMap(cell => cell.split(';')).map(name => name.trim()).filter(name => name !== ''))]
}

/**
 * Adds imported channels to the groups they name. Names match existing groups
 * regardless of case, and missing groups are created.
 * @param {SubscriptionGroup[]} groups
 * @param {{ id: string, groups?: string[] }[]} channels
 * @param {() => string} createId
 * @returns {SubscriptionGroup[]}
 */
export function addChannelsToNamedGroups(groups, channels, createId = () => crypto.randomUUID()) {
  const result = groups.map(group => ({ ...group, channelIds: [...group.channelIds] }))
  const byName = new Map(result.map(group => [group.name.toLowerCase(), group]))
  for (const channel of channels) {
    for (const name of channel.groups ?? []) {
      // The group editor limits names to 255 characters
      const groupName = name.slice(0, 255)
      let group = byName.get(groupName.toLowerCase())
      if (group === undefined) {
        group = { id: createId(), name: groupName, channelIds: [] }
        result.push(group)
        byName.set(groupName.toLowerCase(), group)
      }
      if (!group.channelIds.includes(channel.id)) group.channelIds.push(channel.id)
    }
  }
  return result
}
