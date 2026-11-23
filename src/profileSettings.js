// @ts-check
import { MAIN_PROFILE_ID } from './constants.js'
import { isValidSeparateProfileId, profileDatastorePrefix } from './datastores/profileDatastoreNames.js'
import { NON_TRANSFERABLE_SETTINGS } from './nonTransferableSettings.js'

/*
 * A profile can use its own settings instead of the shared ones. It saves only
 * the values that differ, in the setting `profileSettings-<hex profile ID>`,
 * which also syncs under that key. Every other setting uses the shared value.
 * The ID holds no dot, as it also names its edit time in
 * `syncServerSettingUpdatedAt`, whose field names can't.
 */

const PROFILE_SETTINGS_PREFIX = 'profileSettings-'

/**
 * Settings that stay the same in every profile. They describe this device,
 * the app's windows or background work rather than how a profile browses, or
 * they hold data the profiles share, which a profile's own settings must not
 * change for the others.
 */
export const SHARED_ONLY_SETTINGS = new Set([
  // Credentials, paths, proxies, backups, the sync server, accounts, tray and
  // window options, and other settings that don't leave this device.
  ...NON_TRANSFERABLE_SETTINGS,
  // App startup, windows and memory
  'defaultProfile',
  'checkForUpdates',
  'internetConnectivityChecks',
  'startupBehavior',
  'customTitleBar',
  'confirmCloseApp',
  'confirmCloseWindowWithMultipleTabs',
  'closeWindowWithLastTab',
  'openDeepLinksInNewWindow',
  'autoUnloadTabs',
  'autoUnloadMemoryThreshold',
  'autoUnloadTabPercentage',
  'scrollMiniPlayerSavedRect',
  'crossTabMiniPlayerSavedRect',
  // The main process reads these when it opens a window, before a profile is
  // active, and its zoom commands change the shared scale.
  'hideStartupSplash',
  'uiScale',
  // The main process applies these to every window, or reads them for its
  // own menus, tabs and downloads.
  'contextMenuSearchEngines',
  'keyboardShortcuts',
  'tabCloseFocus',
  'newTabPosition',
  'rememberTabNavigationHistory',
  'currentLocale',
  'useAITranslationCompletions',
  'enableDownloads',
  'showSkipSilenceButton',
  'enableSkipSilenceByDefault',
  // Notifications, background refreshes and downloads run for every profile.
  'notificationMode',
  'enableUploadNotifications',
  'commentReplyNotifications',
  'twitchLiveNotifications',
  'enableClosedAppSubscriptionRefresh',
  'ytDlpMaxConcurrentDownloads',
  'ytDlpDownloadBandwidthLimit',
  'ytDlpSelectedTemplate',
  'ytDlpAutomaticDownloadRules',
  'ytDlpAutomaticDownloadsRequireUnmetered',
  'ytDlpAutomaticDownloadsRequireCharging',
  // Retention deletes the history and searches that other profiles may share,
  // and the video metadata history, which the main process also records, is
  // one for all profiles.
  'historyRetentionDays',
  'searchHistoryRetentionDays',
  'enableVideoMetadataCache',
  // Identities and drafts
  'sponsorBlockUserId',
  'sponsorBlockGeneratedUserId',
  'sponsorBlockDraftSegmentsByVideoId',
  // The Invidious credentials are saved for the shared instance.
  'defaultInvidiousInstance',
  // Data kept with the settings
  'channelsHidden',
  'forbiddenTitles',
  'sponsorBlockChannelWhitelist',
  'followedRssFeeds',
  'followedChannels',
  'subscriptionGroups',
  'subscribedChannelsCustomOrder',
  'pinnedChannels',
  'pinnedChannelMetadata',
  'pinnedPlaylistIds',
  'playlistBookmarks',
  'playlistReverseStates',
  'quickBookmarkTargetPlaylistId',
  'userPlaylistsCustomOrder',
  'userPlaylistsPinnedIds',
  'channelPlaybackSpeeds',
  'channelVideoQualities',
  'channelSubtitlesStates',
  'channelVolumes',
])

/**
 * Whether a profile can use its own settings. The main profile always uses
 * the shared ones, and other IDs can't name the setting, see
 * `isValidSeparateProfileId`.
 * @param {unknown} profileId
 * @returns {profileId is string}
 */
export function canHaveOwnSettings(profileId) {
  // `__proto__` can't key the own settings of each profile in plain objects.
  return profileId !== MAIN_PROFILE_ID && profileId !== '__proto__' && isValidSeparateProfileId(profileId)
}

/**
 * The ID of the setting that holds a profile's own settings, which is also
 * their key on the sync server.
 * @param {string} profileId
 */
export function profileSettingsId(profileId) {
  return PROFILE_SETTINGS_PREFIX + profileDatastorePrefix(profileId).slice('profile-'.length)
}

/**
 * @param {unknown} settingId
 * @returns {settingId is string}
 */
export function isProfileSettingsId(settingId) {
  return typeof settingId === 'string' && settingId.startsWith(PROFILE_SETTINGS_PREFIX)
}

// Keeps a leading U+FEFF, which profile IDs can start with.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * The profile whose own settings a setting holds, or null for other settings.
 * @param {unknown} settingId a saved setting's ID, or a key from the server
 * @returns {string | null}
 */
export function profileIdFromSettingsId(settingId) {
  if (!isProfileSettingsId(settingId)) return null
  const hex = settingId.slice(PROFILE_SETTINGS_PREFIX.length)
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[\da-f]+$/.test(hex)) return null
  try {
    const bytes = Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16))
    const profileId = decoder.decode(new Uint8Array(bytes))
    return canHaveOwnSettings(profileId) && profileSettingsId(profileId) === settingId ? profileId : null
  } catch {
    return null
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

/**
 * The own settings of a profile in a map of them by profile ID, which keys
 * like `__proto__` can't reach through the prototype.
 * @param {Record<string, unknown> | undefined} overrides
 * @param {string} profileId
 */
export function ownSettingsOf(overrides, profileId) {
  return overrides && Object.hasOwn(overrides, profileId) ? overrides[profileId] : undefined
}

/**
 * The own settings of each profile in saved settings, by profile ID.
 * @param {Iterable<{ _id: string, value: unknown }>} records
 * @returns {Record<string, Record<string, unknown>>}
 */
export function collectProfileSettings(records) {
  /** @type {Record<string, Record<string, unknown>>} */
  const profiles = {}
  for (const { _id, value } of records) {
    const profileId = profileIdFromSettingsId(_id)
    if (profileId !== null && isPlainObject(value)) profiles[profileId] = { ...value }
  }
  return profiles
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameSettingValue(a, b) {
  return Object.is(a, b) || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null &&
    JSON.stringify(a) === JSON.stringify(b))
}

/**
 * A copy of a saved setting value, also of one in a reactive store.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function copySettingValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

/**
 * The settings of a profile that `isProfileSpecific` lets it have.
 * @param {unknown} settings
 * @param {(settingId: string) => boolean} isProfileSpecific
 * @returns {Record<string, unknown>}
 */
export function profileSettingsOf(settings, isProfileSpecific) {
  if (!isPlainObject(settings)) return {}
  return Object.fromEntries(Object.entries(settings).filter(([key]) => isProfileSpecific(key)))
}

/**
 * The own settings of a profile that sync uploads: those that `isSynced`
 * accepts, sorted so that equal settings compare equal.
 * @param {unknown} settings the profile's own settings, or null if it uses the shared ones
 * @param {(settingId: string) => boolean} isSynced
 * @returns {Record<string, unknown> | null}
 */
export function syncedProfileSettingsOf(settings, isSynced) {
  if (!isPlainObject(settings)) return null
  return Object.fromEntries(Object.entries(profileSettingsOf(settings, isSynced))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, copySettingValue(value)]))
}

/**
 * The shared value of a setting, also while the active profile replaces it.
 * @param {Record<string, any>} settings the settings state
 * @param {string} settingId
 */
export function sharedSettingValue(settings, settingId) {
  const shared = settings.profileSettingsState?.shared
  return shared && Object.hasOwn(shared, settingId) ? shared[settingId] : settings[settingId]
}

/**
 * What showing the settings of `target` changes, from the settings state,
 * whose `profileSettingsState` holds each profile's own settings and the
 * shared values the shown ones replace.
 * @param {Record<string, any>} settings
 * @param {string | null} target the profile whose own settings to show, or null for the shared ones
 * @param {(settingId: string) => boolean} isProfileSpecific
 * @param {(settingId: string, value: unknown) => unknown} [normalize] gives a profile's own value as the setting saves it
 * @returns {{ applied: string | null, shared: Record<string, unknown>, values: Record<string, unknown>, changed: string[] }}
 *   `shared` holds the shared values that `values` replace, and `changed` the settings whose value changes
 */
export function planProfileSettingsOf(settings, target, isProfileSpecific, normalize = (_, value) => value) {
  const current = settings.profileSettingsState
  const own = Object.fromEntries(Object.entries(profileSettingsOf(target === null ? null : ownSettingsOf(current.overrides, target), isProfileSpecific))
    .map(([key, value]) => [key, normalize(key, value)]))
  /** @type {Record<string, unknown>} */
  const shared = {}
  /** @type {Record<string, unknown>} */
  const values = {}
  for (const [key, value] of Object.entries(current.shared)) {
    if (!Object.hasOwn(own, key)) values[key] = value
  }
  for (const [key, value] of Object.entries(own)) {
    shared[key] = Object.hasOwn(current.shared, key) ? current.shared[key] : settings[key]
    values[key] = value
  }
  const changed = Object.keys(values).filter(key => !sameSettingValue(settings[key], values[key]))
  return {
    applied: target,
    shared,
    values: Object.fromEntries(changed.map(key => [key, copySettingValue(values[key])])),
    changed,
  }
}
