import { areJsonValuesEqual } from './jsonValues.js'
import { resolveBaseTheme, resolveSystemTheme } from '../../appearanceSettings.js'
import { CUSTOM_THEMES_SYNC_KEY, customThemeIdFromValue, normalizeCustomThemes } from '../../customTheme.js'
import {
  blockedItemsModeFromSwitches,
  fixedTabWidthFromSwitch,
  hasReplacedSettingId,
  listFromSwitches,
  SWITCH_LISTS,
  holdPlaybackRateMultiplierFromSwitch,
  keepPlayerVisibleOnScrollFromLegacy,
  migrateSettingIds,
  navigationBarLabelsFromCompactSwitch,
  thumbnailDataSaverModeFromSwitch,
  titleLineLimitFromSwitch,
  ytDlpPreloadCountFromSwitch,
} from '../../datastores/settingsMigrations.js'

export function areSyncSettingValuesEqual(key, left, right) {
  if (key === CUSTOM_THEMES_SYNC_KEY) {
    // Storage order and defaults filled in by different app versions are not edits.
    const normalize = themes => normalizeCustomThemes(themes).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return areJsonValuesEqual(normalize(left), normalize(right))
  }
  return areJsonValuesEqual(left, right)
}

export function resolveMergedThemeEntry(entry, themes, previousThemes, now) {
  let value = entry.value
  if (entry.key === 'baseTheme') {
    const deletedTheme = previousThemes.find(theme => theme.id === customThemeIdFromValue(value))
    value = resolveBaseTheme(value, resolveBaseTheme(deletedTheme?.basedOn, 'system'), themes)
  } else if (entry.key === 'systemLightTheme' || entry.key === 'systemDarkTheme') {
    value = resolveSystemTheme(value, entry.key === 'systemLightTheme' ? 'light' : 'dark', themes)
  }
  return value === entry.value ? entry : { ...entry, value, updatedAt: Math.max(now, entry.updatedAt) }
}

/**
 * Older app versions sync switches that selects replaced, such as Hide Video
 * Description instead of the Video descriptions select. Until a device syncs
 * the select, read it from that entry, so new and upgraded devices keep the
 * account's choice. Pinned Quick Settings follow the new ids. Applies to server
 * entries and the last synced snapshot.
 * @param {Record<string, { key: string, value: unknown, updatedAt: number }>} remote
 */
export function migrateLegacySyncedSettings(remote) {
  const migrated = { ...remote }
  const legacy = remote.hideVideoDescription
  if (legacy && !remote.videoDescriptionMode) {
    migrated.videoDescriptionMode = {
      ...legacy, key: 'videoDescriptionMode', value: legacy.value === true ? 'hide' : 'collapsed',
    }
  }
  const scrollPlayer = remote.scrollPlayerMode ?? remote.scrollMiniPlayerEnabled
  if (scrollPlayer && !remote.keepPlayerVisibleOnScroll) {
    migrated.keepPlayerVisibleOnScroll = {
      ...scrollPlayer, key: 'keepPlayerVisibleOnScroll', value: keepPlayerVisibleOnScrollFromLegacy(scrollPlayer.value),
    }
  }
  const limitTitles = remote.limitTitlesToTwoLines
  if (limitTitles && !remote.titleLineLimit) {
    migrated.titleLineLimit = {
      ...limitTitles, key: 'titleLineLimit', value: titleLineLimitFromSwitch(limitTitles.value),
    }
  }
  const holdToDouble = remote.holdToDoublePlaybackSpeed
  if (holdToDouble && !remote.holdPlaybackRateMultiplier) {
    migrated.holdPlaybackRateMultiplier = {
      ...holdToDouble, key: 'holdPlaybackRateMultiplier', value: holdPlaybackRateMultiplierFromSwitch(holdToDouble.value),
    }
  }
  const thumbnailDataSaver = remote.thumbnailDataSaver
  if (thumbnailDataSaver && !remote.thumbnailDataSaverMode) {
    migrated.thumbnailDataSaverMode = {
      ...thumbnailDataSaver, key: 'thumbnailDataSaverMode', value: thumbnailDataSaverModeFromSwitch(thumbnailDataSaver.value),
    }
  }
  const compactNavigationLabels = remote.compactNavigationLabels
  if (compactNavigationLabels && !remote.navigationBarLabels) {
    migrated.navigationBarLabels = {
      ...compactNavigationLabels, key: 'navigationBarLabels', value: navigationBarLabelsFromCompactSwitch(compactNavigationLabels.value),
    }
  }
  const enableBlockLists = remote.enableBlockLists
  const blurBlockedItems = remote.blurBlockedItems
  if ((enableBlockLists || blurBlockedItems) && !remote.blockedItemsMode) {
    migrated.blockedItemsMode = {
      key: 'blockedItemsMode',
      value: blockedItemsModeFromSwitches(enableBlockLists?.value, blurBlockedItems?.value),
      updatedAt: Math.max(enableBlockLists?.updatedAt ?? -Infinity, blurBlockedItems?.updatedAt ?? -Infinity),
    }
  }
  for (const [listKey, switches] of Object.entries(SWITCH_LISTS)) {
    const entries = Object.keys(switches).map(key => remote[key]).filter(Boolean)
    if (entries.length === 0 || remote[listKey]) continue
    migrated[listKey] = {
      key: listKey,
      value: listFromSwitches(listKey, key => remote[key]?.value),
      updatedAt: Math.max(...entries.map(entry => entry.updatedAt)),
    }
  }
  // Older versions keep syncing the switches that turned these values on and
  // off, so a switch edited after the value decides it.
  for (const [switchKey, valueKey, fromSwitch] of [
    ['useFixedTabWidth', 'fixedTabWidth', fixedTabWidthFromSwitch],
    ['ytDlpPreloadEnabled', 'ytDlpPreloadCount', ytDlpPreloadCountFromSwitch],
  ]) {
    const formerSwitch = remote[switchKey]
    const value = remote[valueKey]
    if (formerSwitch && !(formerSwitch.updatedAt < value?.updatedAt)) {
      migrated[valueKey] = {
        key: valueKey, value: fromSwitch(formerSwitch.value, value?.value), updatedAt: formerSwitch.updatedAt,
      }
    }
  }
  // Auto Load Next Page used to control comments too.
  const autoLoadNextPage = remote.generalAutoLoadMorePaginatedItemsEnabled
  if (autoLoadNextPage && !remote.autoLoadComments) {
    migrated.autoLoadComments = {
      ...autoLoadNextPage, key: 'autoLoadComments', value: autoLoadNextPage.value !== false,
    }
  }
  const quickSettings = remote.quickSettings
  if (hasReplacedSettingId(quickSettings?.value)) {
    migrated.quickSettings = { ...quickSettings, value: migrateSettingIds(quickSettings.value) }
  }
  return migrated
}

export function mergeSettingEntry({ key, value, old, remoteEntry, localUpdatedAt, now }) {
  const localChanged = old !== undefined && !areSyncSettingValuesEqual(key, value, old.value)

  if (!old && remoteEntry) return remoteEntry
  if (localChanged && (!remoteEntry || (localUpdatedAt ?? now) >= remoteEntry.updatedAt)) {
    return { key, value, updatedAt: localUpdatedAt ?? now }
  }
  // Equal edit times can have different storage representations. Keep the
  // server's entry so unchanged device snapshots cannot overwrite each other.
  if (remoteEntry && (!old || remoteEntry.updatedAt >= old.updatedAt)) return remoteEntry
  return old ?? { key, value, updatedAt: now }
}

// Lists whose items devices add and remove one at a time, by how they store an
// item's identity
const LIST_SETTINGS = {
  channelsHidden: { json: true, id: item => typeof item === 'string' ? item : item?.name },
  forbiddenTitles: { json: true, id: item => item },
  sponsorBlockChannelWhitelist: { json: false, id: item => item },
}

export function isListSetting(key) {
  return Object.hasOwn(LIST_SETTINGS, key)
}

function parseListSetting(key, value) {
  if (!LIST_SETTINGS[key].json) return Array.isArray(value) ? value : null
  try {
    const list = JSON.parse(value)
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/**
 * Merges a list setting, such as Hide Channels, by item against the last
 * synced list, so items added or removed on two devices before they synced are
 * all kept. Without a synced list, both devices' items are kept.
 */
export function mergeSettingListEntry(options) {
  const { key, value, old, remoteEntry, localUpdatedAt, now } = options
  const local = parseListSetting(key, value)
  const remote = remoteEntry && parseListSetting(key, remoteEntry.value)
  const base = old ? parseListSetting(key, old.value) : []
  if (!local || !remote || !base) return mergeSettingEntry(options)

  const { id, json } = LIST_SETTINGS[key]
  const baseItems = new Map(base.map(item => [id(item), item]))
  const localItems = new Map(local.map(item => [id(item), item]))
  const merged = new Map(remote.map(item => [id(item), item]))
  for (const itemId of baseItems.keys()) {
    if (!localItems.has(itemId)) merged.delete(itemId)
  }
  for (const [itemId, item] of localItems) {
    // Added here, or edited here (such as a fetched channel name) and still on the server
    if (!baseItems.has(itemId) ||
        (merged.has(itemId) && !areJsonValuesEqual(item, baseItems.get(itemId)))) {
      merged.set(itemId, item)
    }
  }

  const list = [...merged.values()]
  if (areJsonValuesEqual(list, remote)) return remoteEntry
  return {
    key,
    value: json ? JSON.stringify(list) : list,
    updatedAt: Math.max(localUpdatedAt ?? now, remoteEntry.updatedAt),
  }
}

const isSettingsObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * When each of the own settings of a profile in a synced entry was last
 * edited, by setting, also for those that went back to the shared value.
 * Entries from versions that synced no such times count each setting as
 * edited with the entry.
 * @param {{ value: Record<string, unknown>, updatedAt: number, settingsUpdatedAt?: unknown }} entry
 * @returns {Record<string, number>}
 */
export function profileSettingTimesOf(entry) {
  const times = Object.fromEntries(Object.entries(isSettingsObject(entry.settingsUpdatedAt) ? entry.settingsUpdatedAt : {})
    .filter(([, editedAt]) => Number.isFinite(editedAt)))
  for (const settingId of Object.keys(entry.value)) {
    if (!Object.hasOwn(times, settingId)) times[settingId] = entry.updatedAt
  }
  return times
}

/**
 * Merges the own settings of a profile by setting against the last synced
 * ones, so settings edited on two devices before they synced are all kept.
 * When both devices edited the same setting, the later edit of that setting
 * wins, which `settingsUpdatedAt` of the entry and `localSettingUpdatedAt`
 * give. Turning own settings on or off, or merging without synced settings,
 * replaces them all.
 * @param {object} options see `mergeSettingEntry`
 * @param {(settingId: string) => number | undefined} [options.localSettingUpdatedAt]
 *   when this device last edited a setting, if it saved that
 */
export function mergeProfileSettingsEntry(options) {
  const { key, value, old, remoteEntry, localUpdatedAt, localSettingUpdatedAt = () => undefined, now } = options
  if (!isSettingsObject(value) || !isSettingsObject(remoteEntry?.value) || !isSettingsObject(old?.value)) {
    return mergeSettingEntry(options)
  }

  const base = old.value
  const merged = { ...remoteEntry.value }
  const times = profileSettingTimesOf(remoteEntry)
  const baseTimes = profileSettingTimesOf(old)
  // Only times that devices recorded for a setting show an edit that went
  // back to the synced value; fallback times are those of the whole entry.
  const remoteSettingTimes = isSettingsObject(remoteEntry.settingsUpdatedAt) ? remoteEntry.settingsUpdatedAt : {}
  // Remote settings too, which this device may have set and reset since it last synced.
  for (const settingId of new Set([...Object.keys(base), ...Object.keys(value), ...Object.keys(remoteEntry.value)])) {
    const local = Object.hasOwn(value, settingId) ? value[settingId] : undefined
    const synced = Object.hasOwn(base, settingId) ? base[settingId] : undefined
    const remote = Object.hasOwn(merged, settingId) ? merged[settingId] : undefined
    const baseEditedAt = Object.hasOwn(baseTimes, settingId) ? baseTimes[settingId] : old.updatedAt
    const localSettingEditedAt = localSettingUpdatedAt(settingId)
    if (areJsonValuesEqual(local, synced) && !(localSettingEditedAt > baseEditedAt)) continue
    const editedAt = localSettingEditedAt ?? localUpdatedAt ?? now
    const remoteEditedAt = Object.hasOwn(times, settingId) ? times[settingId] : remoteEntry.updatedAt
    const remoteChanged = !areJsonValuesEqual(remote, synced) || remoteSettingTimes[settingId] > baseEditedAt
    if (remoteChanged && editedAt < remoteEditedAt) continue
    if (local === undefined) delete merged[settingId]
    else merged[settingId] = local
    times[settingId] = editedAt
  }

  if (areJsonValuesEqual(merged, remoteEntry.value) && areJsonValuesEqual(times, profileSettingTimesOf(remoteEntry))) return remoteEntry
  return {
    key,
    value: merged,
    updatedAt: Math.max(localUpdatedAt ?? now, remoteEntry.updatedAt),
    settingsUpdatedAt: times,
  }
}

/**
 * Merges a virtual setting that holds `{ value, updatedAt }` records per item,
 * such as a channel or playlist, so edits to different items on two devices
 * never overwrite one another. Items absent from this device are kept.
 */
export function mergeSettingItemsEntry(options) {
  const remote = options.remoteEntry?.value ?? {}
  const value = { ...remote }
  let updatedAt = options.remoteEntry?.updatedAt ?? options.old?.updatedAt ?? 0
  for (const [itemId, local] of Object.entries(options.value)) {
    const localUpdatedAt = local.updatedAt
    const old = localUpdatedAt === undefined ? undefined : options.old?.value?.[itemId]
    const remoteEntry = remote[itemId]
    // A local edit newer than the remote one wins and keeps its edit time, also
    // when it restores the synced value, or when there is no synced baseline.
    const entry = localUpdatedAt !== undefined && (!old || localUpdatedAt > old.updatedAt) &&
      !(localUpdatedAt <= remoteEntry?.updatedAt)
      ? { value: local.value, updatedAt: localUpdatedAt }
      : mergeSettingEntry({
          key: itemId,
          value: local.value,
          old,
          remoteEntry,
          localUpdatedAt,
          now: options.now
        })
    value[itemId] = { value: entry.value, updatedAt: entry.updatedAt }
    updatedAt = Math.max(updatedAt, entry.updatedAt)
  }
  return { key: options.key, value, updatedAt }
}
