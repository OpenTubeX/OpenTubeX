import { createDefaultSettings, resolveDefaultLandingPage } from '../../../settingsDefaults.js'
import { getTransferableSettings, NON_TRANSFERABLE_SETTINGS } from '../../../nonTransferableSettings.js'
import { splitInvidiousInstanceCredentials } from '../../../apiBackends.js'
import { normalizeMaterialSeedColor } from '../../../materialTheme.js'
import { normalizeSignalAccentColor } from '../../../signalTheme.js'
import i18n, { loadLocale, rememberStartupLocale, setAITranslationCompletionsEnabled } from '../../i18n/index'
import { resolveSystemLocale } from '../../../systemLocale.js'
import { applyKeyboardShortcutOverrides, resolveLandingPage, sanitizeKeyboardShortcutOverrides, SyncEvents } from '../../../constants'
import { DBProfileHandlers, DBSettingHandlers, getDataScope } from '../../../datastores/handlers/index'
import { SCOPED_SEEN_MARK_SETTINGS, seenMarksSettingId, shownSeenMarksSetting } from '../../../subscriptionSeenMarkSettings.js'
import { hashPassword } from '../../helpers/passwords'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { ANDROID_PROXY_SETTING_KEYS, configureAndroidProxy, readAndroidProxySettings } from '../../helpers/androidProxy'
import { ensureAndroidLocalNetworkAccess } from '../../helpers/androidLocalNetwork'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getSystemLocale, showToast } from '../../helpers/utils'
import { normalizeTabBarPosition } from '../../constants/tabBarPosition'
import { setReducedMotionPreference } from '../../helpers/reducedMotion'
import { applyCapacitorNotificationMode } from '../../helpers/liveReminders'
import { setAnimationSpeed } from '../../helpers/animationSpeed'
import { normalizeYouTubeCaptionLanguageCode } from '../../helpers/player/youtubeCaptionLanguages'
import { clearSeekHistories } from '../../helpers/player/seekHistory'
import { isIconPack, loadIconPack, setIconPack } from '../../icons/iconPackState'
import { resolveBaseTheme, resolveSystemTheme } from '../../../appearanceSettings.js'
import { resolveColor } from '../../helpers/colors.js'
import { normalizeAppFont } from '../../helpers/appFont.js'
import {
  LAST_USED_VERSION_SETTING_ID,
  TUTORIAL_AUDIENCE_SETTING_ID,
} from '../../helpers/tutorialState.js'
import { isSettingSyncableOnPlatform } from '../../helpers/platformSettings.js'
import { SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY } from '../../helpers/subscription-settings-sync'
import { PLAYLIST_PREFERENCES_SYNC_KEYS } from '../../helpers/playlist-preferences-sync'
import { CUSTOM_THEMES_SYNC_KEY } from '../../../customTheme.js'
import { normalizeQuickSettings } from '../../helpers/quickSettings.js'
import { normalizeFullscreenActions } from '../../helpers/fullscreenActions.js'
import { normalizeSubscriptionTabs } from '../../helpers/subscriptionTabs.js'
import { normalizeControlBarButtons } from '../../helpers/controlBarButtons.js'
import { normalizeHiddenPlayerMenuControls, normalizePlayerMenuControls, withoutControlBarButtons } from '../../helpers/playerMenuControls.js'
import { createOptimisticSettingUpdater, createSavedSettingEditor, createSettingUpdateQueue, createSettingWriteTracker } from '../../helpers/settingUpdateQueue.js'
import { mergeSubscriptionSeenVideos } from '../../../subscriptionSeenVideos.js'
import { mergeSubscriptionSeenPosts } from '../../../subscriptionSeenPosts.js'
import { mergeRssFeedSeenItems } from '../../helpers/rssFeedSeenItems.js'
import { filterAvailableNavigationItems } from '../../../navigationAvailability.js'
import { navigationItemsFromLegacySettings, normalizeNavigationItems } from '../../../navigationItems.js'
import { migrateStoredAiVideoSummarySetting, migrateSyncServerUrl } from '../../helpers/settings-migrations.js'
import { setDiagnosticLogging } from '../../helpers/diagnostics.js'
import { setAlwaysUseGoogleVideoBackupServer } from '../../helpers/player/googleVideoFallback.js'
import { networkMetered } from '../../helpers/player/meteredNetworkQuality.js'
import {
  SHARED_ONLY_SETTINGS,
  canHaveOwnSettings,
  collectProfileSettings,
  isPlainObject,
  isProfileSettingsId,
  ownSettingsOf,
  planProfileSettingsOf,
  profileIdFromSettingsId,
  profileSettingsId,
  profileSettingsOf,
  sameSettingValue,
  sharedSettingValue,
  syncedProfileSettingsOf,
} from '../../../profileSettings.js'
export { sharedSettingValue } from '../../../profileSettings.js'
export { NON_TRANSFERABLE_SETTINGS } from '../../../nonTransferableSettings.js'

const CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING = 'channelSettingsSyncMigration'
const CONTROL_BAR_BUTTONS_MIGRATION_SETTING = 'controlBarButtonsMigration'
const TUTORIAL_STATE_SETTING_IDS = new Set([
  LAST_USED_VERSION_SETTING_ID,
  TUTORIAL_AUDIENCE_SETTING_ID,
])

/*
 * Due to the complexity of the settings module in FreeTube, a more
 * in-depth explanation for adding new settings is required.
 *
 * The explanation will be written with the assumption that
 * the reader knows how Vuex works.
 *
 * And no, there's no need to read the entire wall of text.
 * We'll direct you where you need to go as we walk you through it.
 * Additionally, the text actually looks bigger than it truly is.
 * Each line has, at most, 72 characters.
 *
 ****
 * Introduction
 *
 * You can add a new setting in two different methods.
 *
 * The first method benefits from the auto-generation of
 * a getter, a mutation and a few actions related to the setting.
 * This method should be preferred whenever possible:
 * - `state`, initialized by `src/settingsDefaults.js`
 *
 * The last one DOES NOT feature any kind of auto-generation and should
 * only be used in scenarios that don't fall under the other 2 options:
 * - `customState`
 *
 ****
 * ASIDE:
 * The aforementioned "side effects" cover a large area
 * of interactions with other modules
 * A good example would be a setting that utilizes the Electron API
 * when its value changes.
 *
 ****
 * First and foremost, you have to understand what type of setting
 * you intend to add to the app.
 *
 * You'll have to select one of these three scenarios:
 *
 * 1) You just want to add a simple setting that does not actively
 *    interact with the Electron API, `localStorage` or
 *    other parts outside of the settings module.
 * -> Please consult the `state` section.
 *
 * 2) You want to add a more complex setting that interacts
 *    with other parts of the app and tech stack.
 * -> Please consult the `state` and `sideEffectHandlers` sections.
 *
 * 3) You want to add a completely custom state based setting
 *    that does not work like the usual settings.
 * -> Please consult the `state` and `customState` sections.
 *
 ****
 * `state`
 * This object contains settings that have NO SIDE EFFECTS.
 *
 * A getter, mutation and an action function is auto-generated
 * for every setting present in the `state` object.
 * They have the following format (exemplified with setting 'example'):
 *
 * Getter: `getExample` (gets the value from current state)
 * Mutation:
 *   `setExample`
 *     (takes a value
 *      and uses it to update the current state)
 * Action:
 *   `updateExample`
 *     (takes a value,
 *      saves it to the database
 *      and calls `setExample` with it)
 *
 ***
 * `sideEffectHandlers`
 * This object contains the side-effect handlers for settings that have SIDE EFFECTS.
 *
 * Each one of these settings must specify a handler,
 *   which should essentially be a callback of type
 *   `(store, value) => void` (the same as you would use for an `action`)
 *   that deals with the side effects for that setting
 *
 * NOTE: Example implementations of such handlers can be found
 * in the `sideEffectHandlers` object in case
 * the explanation isn't clear enough.
 *
 * All functions auto-generated for settings in `state`
 * (if you haven't read the `state` section, do it now),
 * are also auto-generated for settings in `sideEffectHandlers,
 * with a few key differences (exemplified with setting 'example'):
 *
 * - an additional action is auto-generated:
 *   - `triggerExampleSideEffects`
 *       (triggers the `handler` for that setting;
 *        you'll most likely never call this directly)
 *
 * - the behavior of `updateExample` changes a bit:
 *   - `updateExample`
 *       (saves value to the database,
 *        calls `triggerExampleSideEffects` and calls `setExample`)
 *
 ***
 * `customState`
 * This object contains settings that
 * don't linearly fall under the other two options.
 *
 * No auto-generation of any kind is performed
 * when a setting is added to `customState`
 *
 * You must manually add any getters, mutations and actions to
 * `customGetters`, `customMutations` and `customActions` respectively
 * that you find appropriate for that setting.
 *
 * NOTE:
 * When adding a setting to the `customState`,
 * additional consultation with the FreeTube team is preferred
 * to evaluate if it is truly necessary
 * and to ensure that the implementation works as intended.
 *
 ***
 * `NON_TRANSFERABLE_SETTINGS`
 * This set contains setting keys
 * that should not be exported when a user chooses to "Export settings".
 *
 * When adding a new setting, it should be considered
 * whether this setting can be exported or not. For example, settings
 * that are OS or user specific like paths should not be exported.
 *
 ****
 * ENDING NOTES
 *
 * Only two more things that need mentioning.
 *
 * 1) It's perfectly fine to add extra functionality
 *    to the `customGetters`, `customMutations` and `customActions`,
 *    whether it's related to a setting or just serving as
 *    standalone functionality for the module
 *    (e.g. `grabUserSettings` (standalone action))
 *
 * 2) It's also possible to OVERRIDE auto-generated functionality by
 *    adding functions with the same identifier to
 *    the respective `custom__` object,
 *    but you must have an acceptable reason for doing so.
 ****
 */

// HELPERS
const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1)
export const defaultGetterId = settingId => 'get' + capitalize(settingId)
export const defaultMutationId = settingId => 'set' + capitalize(settingId)
export const defaultUpdaterId = settingId => 'update' + capitalize(settingId)
export const defaultSideEffectsTriggerId = settingId =>
  'trigger' + capitalize(settingId) + 'SideEffects'
/*****/

const state = createDefaultSettings({
  supportsLocalApi: process.env.SUPPORTS_LOCAL_API,
  isElectron: process.env.IS_ELECTRON,
})

// Keep a snapshot separate from Vuex's reactive state so settings can reliably
// be compared with and restored to their original values.
export const DEFAULT_SETTINGS = Object.freeze(structuredClone(state))

const runLocaleChange = createSettingUpdateQueue()

const sideEffectHandlers = {
  diagnosticLogging: (_store, value) => {
    setDiagnosticLogging(value === true)
  },

  alwaysUseBackupMediaServer: (_store, value) => {
    setAlwaysUseGoogleVideoBackupServer(value === true)
  },

  useAiSlopList: ({ dispatch }, value) => {
    // The list only matches local API results and the web build hides the setting,
    // so a value synced from another platform must not download anything there
    if (!process.env.SUPPORTS_LOCAL_API) {
      return
    }

    // Not awaited so that downloading the list doesn't delay startup
    dispatch(value ? 'loadAiSlopList' : 'clearAiSlopList')
  },

  useAITranslationCompletions: (_store, value) => {
    return setAITranslationCompletionsEnabled(value)
  },

  enableCommentTranslations: (_store, value) => {
    if (!value) {
      import('../../helpers/comment-translations')
        .then(({ terminateCommentTranslationLanguageDetector }) => terminateCommentTranslationLanguageDetector())
        .catch(() => {})
    }
  },

  showVolumeBoostToggle: ({ commit }, value) => {
    // Turning the toggle back on must not resume an earlier boost
    if (!value) {
      commit('clearTabVolumeBoosts')
    }
  },

  enableSeekHistory: (_store, value) => {
    // Turning seek history back on must not bring back earlier positions
    if (!value) {
      clearSeekHistories()
    }
  },

  showFamilyFriendlyOnly: ({ commit }) => {
    // Cached search results were requested with the previous restriction
    commit('setSessionSearchHistory', [])
  },

  keyboardShortcuts: (_store, value) => {
    applyKeyboardShortcutOverrides(value)
  },

  reducedMotion: (store, value) => {
    setReducedMotionPreference(value)
  },

  notificationMode: (_store, value) => applyCapacitorNotificationMode(value),

  animationSpeed: (_store, value) => {
    setAnimationSpeed(value)
  },

  // Locale changes run in order, and one replaced while its locale loads is
  // skipped, so the last change wins.
  currentLocale: ({ dispatch }, value) => runLocaleChange('currentLocale', async isLatest => {
    const fallbackLocale = 'en-US'

    let targetLocale = value
    if (value === 'system') {
      const systemLocale = resolveSystemLocale(await getSystemLocale())

      if (systemLocale !== null) {
        targetLocale = systemLocale
      } else {
        // Go back to default value if locale is unavailable
        targetLocale = fallbackLocale
        // Translating this string isn't necessary
        // because the user will always see it in the default locale
        // (in this case, English (US))
        showToast({ message: `Locale not found, defaulting to ${fallbackLocale}`, icon: ['fas', 'circle-exclamation'] })
      }
    }

    // Always finish loading the English fallback before the app is ready.
    const loadPromises = [loadLocale(fallbackLocale)]

    // "es" is used as a fallback for "es-AR" and "es-MX"
    if (targetLocale === 'es-AR' || targetLocale === 'es-MX') {
      loadPromises.push(
        loadLocale('es')
      )
    }

    // "pt" is used as a fallback for "pt-PT" and "pt-BR"
    if (targetLocale === 'pt-PT' || targetLocale === 'pt-BR') {
      loadPromises.push(
        loadLocale('pt')
      )
    }

    if (targetLocale !== fallbackLocale) {
      loadPromises.push(
        loadLocale(targetLocale)
      )
    }

    await Promise.allSettled(loadPromises)

    if (!isLatest()) return
    i18n.global.locale.value = targetLocale
    rememberStartupLocale(targetLocale)
    await dispatch('getRegionData', targetLocale)
  }),

  defaultInvidiousInstance: ({ commit, rootState }, value) => {
    // Servers with their own Invidious server always use it, even with synced settings
    if (value !== '' && !process.env.SELF_HOSTED_INVIDIOUS && rootState.invidious.currentInvidiousInstance !== value) {
      commit('setCurrentInvidiousInstance', value)
    }
  },

  enableWatchStats: ({ dispatch }, value) => {
    if (value) {
      dispatch('grabWatchStats')
    }
  },

  uiScale: (_, value) => {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.setZoomFactor(value / 100)
    }
  },

  iconPack: async (_, value) => {
    const preferredPack = isIconPack(value) ? value : 'material'
    const preferred = await loadIconPack(preferredPack)
    // A newer selection, such as that of a profile switch, shows its own pack.
    if (preferred === 'applied' || preferred === 'superseded') {
      return preferredPack
    }

    const fallbackPack = preferredPack === 'material' ? 'remix' : 'material'
    const fallback = await loadIconPack(fallbackPack)
    if (fallback === 'applied') {
      return fallbackPack
    }
    if (fallback === 'superseded') {
      return preferredPack
    }

    throw new Error(`Unable to apply icon pack: ${value}`)
  },

  maxVideoPlaybackRate: ({ dispatch, state }, value) => {
    if (state.defaultPlayback > value) {
      dispatch('updateDefaultPlayback', value)
    }
  },

  videoPlaybackRateInterval: ({ dispatch, state }, value) => {
    const correctedDefaultPlaybackRate = value * Math.round(state.defaultPlayback / value)

    if (state.defaultPlayback !== correctedDefaultPlaybackRate) {
      dispatch('updateDefaultPlayback', correctedDefaultPlaybackRate)
    }
  },

  showSkipSilenceButton: ({ dispatch }, value) => {
    if (!value) {
      dispatch('clearTabSkipSilence')
    }
  },

  rememberTabNavigationHistory: (_, value) => {
    // Sync (or clear) the histories of already-open tabs right away,
    // so toggling doesn't require a navigation in every tab first.
    if (process.env.IS_ELECTRON) {
      getTabNavigationService().publishAllHistories(value === true)
    }
  },
}

const settingsWithSideEffects = Object.keys(sideEffectHandlers)

export const NON_SYNCABLE_SETTINGS = new Set([
  ...NON_TRANSFERABLE_SETTINGS,
  // Playlist bookmarks sync with playlists as their own collection.
  'playlistBookmarks',
  // Automatic metadata refreshes must not compete with user pin edits.
  'pinnedChannelMetadata',
  // Updating is tied to the installed application and operating system.
  'checkForUpdates',
  // Window coordinates are only valid for the display they were saved on.
  'scrollMiniPlayerSavedRect',
  'crossTabMiniPlayerSavedRect',
  // Custom download templates stay on this device, so a selected one may not exist on peers.
  'ytDlpSelectedTemplate',
  // These choices describe one physical device, not the user's account.
  'mobileAutoPictureInPicture',
  'capacitorLayoutMode',
  'alwaysShowMobileSearchBar',
  'continuePlaybackWhenScreenIsLocked',
  'switchToAudioInBackground',
  'ignoreHeadphoneControls',
  'hapticFeedback',
  'hapticFeedbackIgnoresSystemSetting',
  'uiScale',
  'fontSize',
  'verticalTabBarWidth',
  'fullscreenDockWidth',
])

export function isSettingSyncable(settingKey) {
  return settingKey === SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY ||
    PLAYLIST_PREFERENCES_SYNC_KEYS.includes(settingKey) ||
    (Object.prototype.hasOwnProperty.call(state, settingKey) &&
      !NON_SYNCABLE_SETTINGS.has(settingKey) &&
      isSettingSyncableOnPlatform(settingKey))
}

export function isSettingSyncEnabled(settings, settingKey) {
  const excluded = Array.isArray(settings.syncServerSettingsExcluded)
    ? settings.syncServerSettingsExcluded
    : []
  return isSettingSyncable(settingKey) && !excluded.includes(settingKey)
}

export function getSyncableSettingKeys(settings) {
  return Object.keys(state).filter(settingKey => (
    isSettingSyncEnabled(settings, settingKey) &&
    !(settingKey === 'defaultProfile' && !settings.syncServerSyncProfiles) &&
    // Pins name playlist IDs that only exist on peers when playlists sync too.
    !((settingKey === 'pinnedPlaylistIds' || settingKey === 'userPlaylistsPinnedIds') && !settings.syncServerSyncPlaylists)
  ))
}

const SUBSCRIPTION_FEED_CACHE_MUTATIONS = {
  videos: 'updateVideoCacheByChannel',
  shorts: 'updateShortsCacheByChannel',
  liveStreams: 'updateLiveCacheByChannel',
  communityPosts: 'updatePostsCacheByChannel',
}

/**
 * Saves the edit time `update` returns for `settingId`, for sync, or removes it
 * for `undefined`. Windows can edit different settings at once, so it reads the
 * saved times inside a lock they share.
 * @param {Function} commit
 * @param {string} settingId
 * @param {(editedAt: number | undefined) => number | undefined} update
 * @returns {Promise<boolean>} whether the edit time was saved
 */
function updateSettingSyncTimestamp(commit, settingId, update) {
  return runLockedSettingUpdate('syncServerSettingUpdatedAt', async () => {
    // Read the datastore, as the broadcast of another window's edit may still be on its way.
    const saved = await DBSettingHandlers.findValue('syncServerSettingUpdatedAt')
    const updatedAt = { ...(saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) }
    const editedAt = update(updatedAt[settingId])
    if (editedAt === updatedAt[settingId]) return
    if (editedAt === undefined) delete updatedAt[settingId]
    else updatedAt[settingId] = editedAt
    await DBSettingHandlers.upsert('syncServerSettingUpdatedAt', updatedAt)
    commit('setSyncServerSettingUpdatedAt', updatedAt)
  })
}

/**
 * Saves an edit of `settingId` with `save`, and its edit time for sync:
 * - The edit time is saved first, so no window can pair the new value with the
 *   previous edit time.
 * - If either save fails, the edit fails and the previous edit time comes back,
 *   so sync doesn't count the unchanged value as a newer edit. Edits of a
 *   setting take turns in all windows, so the previous edit time is always
 *   that of a saved value.
 * @template T
 * @param {Function} commit
 * @param {string} settingId
 * @param {() => Promise<T>} save
 * @param {number} [editedAt]
 * @returns {Promise<T>}
 */
function saveSettingEdit(commit, settingId, save, editedAt = Date.now()) {
  if (!isSettingSyncable(settingId) && settingId !== CUSTOM_THEMES_SYNC_KEY && !isProfileSettingsId(settingId)) return save()

  return runLocked(`opentubex-setting-edit-${settingId}`, async () => {
    let previous
    const recorded = await updateSettingSyncTimestamp(commit, settingId, saved => {
      previous = saved
      return editedAt
    })
    if (!recorded) throw new Error(`Failed to save when ${settingId} was edited`)
    try {
      return await save()
    } catch (error) {
      // Keep an edit time that something else saved meanwhile.
      await updateSettingSyncTimestamp(commit, settingId, saved => saved === editedAt ? previous : saved)
      throw error
    }
  })
}

const settingWrites = createSettingWriteTracker(settingId => DBSettingHandlers.findValue(settingId))

/**
 * Optimistic edits show their value before their edit time is saved, so sync
 * waits for this window's setting writes.
 * @returns {Promise<unknown> | null} settles once the writes in flight finish,
 * or `null` if there are none
 */
export function settingWritesSettled() {
  return settingWrites.settled()
}

/**
 * Runs a write of a synchronized value saved outside this module, such as
 * custom themes, so sync waits for it too.
 * @template T
 * @param {string} settingId
 * @param {() => Promise<T>} write
 * @returns {Promise<T>}
 */
export function trackSettingWrite(settingId, write) {
  return settingWrites.track(settingId, write)
}

// #region profile settings

/*
 * A profile with its own settings saves only the values that differ from the
 * shared ones, see `profileSettingsId`. While it is active, the state holds
 * its values, so everything that reads a setting sees them, and the shared
 * values they replace wait in `profileSettingsState.shared`:
 * - `set<Setting>` mutations always set the shared value. While the active
 *   profile replaces it, they keep it in `shared` instead.
 * - Updaters save to the active profile instead of the shared settings, unless
 *   they run in `withSharedSettings`, like sync and imports do.
 * - `applyProfileSettings` shows the values of the profile that is active and
 *   runs their side effects, see `profileSettingsPlugin`.
 */

// Settings with their own updater that also save to a profile. The other
// settings with their own updater keep data rather than a preference.
const PROFILE_ROUTED_CUSTOM_SETTINGS = new Set([
  'preferredCaptionLocale', 'baseTheme', 'systemLightTheme', 'systemDarkTheme', 'mainColor', 'secColor',
  'tabBarPosition', 'materialSeedColor', 'signalAccentColor', 'iconPack', 'moveDownloadsToAppHeader',
  'fullscreenActions', 'subscriptionTabs', 'controlBarButtons', 'playerMenuControls', 'hiddenPlayerMenuControls',
  'quickSettings', 'quickPlaybackSpeedBarOptions', 'navigationItems', 'homeSectionLayout',
])

/** @type {Set<string>} Filled once the actions exist, see below. */
const PROFILE_SPECIFIC_SETTINGS = new Set()

/**
 * Whether a profile with its own settings can give the setting its own value.
 * @param {unknown} settingId
 */
export function isProfileSpecificSetting(settingId) {
  return typeof settingId === 'string' && PROFILE_SPECIFIC_SETTINGS.has(settingId)
}

/**
 * The settings of a profile that it can have, from a backup, sync or the datastore.
 * @param {unknown} settings
 * @returns {Record<string, unknown>}
 */
export function sanitizeProfileSettings(settings) {
  return profileSettingsOf(settings, isProfileSpecificSetting)
}

/**
 * The own settings of a profile that sync uploads, see `syncedProfileSettingsOf`.
 * @param {unknown} settings the profile's own settings, or null if it uses the shared ones
 * @param {(settingId: string) => boolean} isSynced whether this device syncs a setting
 */
export function syncedProfileSettings(settings, isSynced) {
  return syncedProfileSettingsOf(settings, settingId => isProfileSpecificSetting(settingId) && isSynced(settingId))
}

/**
 * What showing the settings of `target` changes, see `planProfileSettingsOf`.
 * @param {Record<string, any>} settings the settings state
 * @param {string | null} target
 */
export function planProfileSettings(settings, target) {
  return planProfileSettingsOf(settings, target, isProfileSpecificSetting, normalizeProfileSetting)
}

/**
 * A profile's own value as the setting's mutation would save it, as restored
 * or synced values skip it.
 * @param {string} settingId
 * @param {unknown} value
 */
function normalizeProfileSetting(settingId, value) {
  switch (settingId) {
    case 'preferredCaptionLocale': return normalizeYouTubeCaptionLanguageCode(value)
    case 'tabBarPosition': return normalizeTabBarPosition(value)
    default: return value
  }
}

let sharedSettingWrites = 0

/**
 * Runs `operation` so that the updaters it dispatches save the shared settings
 * even while a profile with its own settings is active, as sync and imports
 * do. Like `withDataScope`, `operation` must dispatch them synchronously.
 * @template T
 * @param {() => T} operation
 * @returns {T}
 */
export function withSharedSettings(operation) {
  sharedSettingWrites++
  try {
    return operation()
  } finally {
    sharedSettingWrites--
  }
}

/**
 * The profile an update of `settingId` saves to, or null for the shared settings.
 * @param {string} settingId
 */
function settingTarget(settingId) {
  const applied = state.profileSettingsState.applied
  return applied !== null && sharedSettingWrites === 0 && PROFILE_SPECIFIC_SETTINGS.has(settingId) ? applied : null
}

/** Whether the active profile replaces the shared value of `settingId` */
function isSettingReplaced(settingId) {
  return Object.hasOwn(state.profileSettingsState.shared, settingId)
}

function assignSharedSetting(settingsState, settingId, value) {
  const shared = settingsState.profileSettingsState.shared
  if (Object.hasOwn(shared, settingId)) shared[settingId] = value
  else settingsState[settingId] = value
}

/**
 * Runs `run` inside the lock that writes of a profile's own settings take, so
 * deleting the profile can't run between a write's read and save.
 * @template T
 * @param {string} profileId
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export function withProfileSettingsLock(profileId, run) {
  return canHaveOwnSettings(profileId) ? runLocked(`opentubex-setting-${profileSettingsId(profileId)}`, run) : run()
}

/**
 * Whether a profile still exists. Writes that can create its settings record
 * check this inside its lock, so they can't recreate the record of a profile
 * deleted meanwhile, see `withProfileSettingsLock`.
 * @param {string} profileId
 */
async function profileExists(profileId) {
  return (await DBProfileHandlers.find()).some(profile => profile._id === profileId)
}

/**
 * Saves the value of `settingId` in the own settings of a profile, or with
 * `undefined` goes back to the shared value. Edits read the saved settings
 * inside a lock all windows share, so they build on each other.
 * @param {Function} commit
 * @param {string} profileId
 * @param {string} settingId
 * @param {unknown} value
 */
function saveProfileSettingValue(commit, profileId, settingId, value) {
  const id = profileSettingsId(profileId)
  return runLocked(`opentubex-setting-${id}`, async () => {
    const saved = await DBSettingHandlers.findValue(id)
    if (!isPlainObject(saved)) throw new Error('The profile no longer has its own settings')
    if (value === undefined ? !Object.hasOwn(saved, settingId) : sameSettingValue(saved[settingId], value)) {
      commit('setProfileOwnSettings', { profileId, settings: saved })
      return
    }
    const settings = { ...saved }
    if (value === undefined) delete settings[settingId]
    else settings[settingId] = value
    await saveSettingEdit(commit, id, () => DBSettingHandlers.upsert(id, settings))
    commit('setProfileOwnSettings', { profileId, settings })
  })
}

const runProfileSettingUpdate = createSettingUpdateQueue()

/**
 * Optimistic edits of profiles' own settings that are still saving, by
 * setting ID and profile. Saved settings that show meanwhile keep them, so the
 * next edit builds on them.
 * @type {Map<string, { profileId: string, settingId: string, value: unknown, count: number }>}
 */
const pendingProfileEdits = new Map()

/**
 * @param {string} profileId
 * @param {Record<string, unknown>} settings saved settings of the profile
 */
function withPendingProfileEdits(profileId, settings) {
  const edits = [...pendingProfileEdits.values()].filter(edit => edit.profileId === profileId)
  if (edits.length === 0) return settings
  const shown = { ...settings }
  for (const { settingId, value } of edits) {
    if (value === undefined) delete shown[settingId]
    else shown[settingId] = value
  }
  return shown
}

/**
 * Saves an edit of `settingId` to the own settings of `profileId`. Optimistic
 * edits show right away, so the next edit builds on them.
 * @returns {Promise<boolean>} whether the edit was saved
 */
function updateProfileSetting(commit, profileId, settingId, value, optimistic = false) {
  // A profile saves only the values that differ from the shared ones, so it
  // follows later changes of the others.
  if (value !== undefined && sameSettingValue(value, sharedSettingValue(state, settingId))) value = undefined
  const id = profileSettingsId(profileId)
  const key = `${id}/${settingId}`
  /** @type {{ profileId: string, settingId: string, value: unknown, count: number, confirmed: unknown } | undefined} */
  let pending
  if (optimistic) {
    // The value saved before these edits, which a failed edit shows again if
    // the saved settings can't be read either
    pending = pendingProfileEdits.get(key) ?? {
      profileId, settingId, value, count: 0, confirmed: ownSettingsOf(state.profileSettingsState.overrides, profileId)?.[settingId],
    }
    pending.value = value
    pending.count++
    pendingProfileEdits.set(key, pending)
    commit('setProfileSettingValue', { profileId, settingId, value })
  }
  const settle = () => {
    if (pending && --pending.count === 0 && pendingProfileEdits.get(key) === pending) pendingProfileEdits.delete(key)
  }
  // The edit stops showing over the saved settings before the write
  // tracker shows those another window saved meanwhile.
  return settingWrites.track(id, async () => {
    try {
      // A newer queued edit skips this one, which then confirms no value.
      await runProfileSettingUpdate(key, async () => {
        await saveProfileSettingValue(commit, profileId, settingId, value)
        if (pending) pending.confirmed = value
      })
    } finally {
      settle()
    }
  }).then(() => true, async error => {
    console.error(error)
    if (optimistic) {
      const saved = await DBSettingHandlers.findValue(id).catch(() => undefined)
      if (saved !== undefined) {
        commit('setProfileOwnSettings', { profileId, settings: isPlainObject(saved) ? saved : null })
      } else if (!pendingProfileEdits.has(key)) {
        commit('setProfileSettingValue', { profileId, settingId, value: pending.confirmed })
      }
    }
    return false
  })
}

/** Mutations that can change which settings show, see `profileSettingsPlugin` */
const PROFILE_SETTINGS_MUTATIONS = new Set([
  'setActiveProfile', 'setProfileList', 'removeProfileFromList', 'setProfileSettingsList', 'setProfileOwnSettings',
  'setProfileSettingValue',
])

/**
 * Shows the settings of the active profile: its own while it has them,
 * otherwise the shared ones. Until the profiles load, the settings stay those
 * that `grabUserSettings` showed for the default profile.
 * @param {import('vuex').Store<any>} store
 */
function applyActiveProfileSettings(store) {
  const settings = store.state.settings
  const { activeProfile, profilesLoaded } = store.state.profiles
  const current = settings.profileSettingsState
  const target = !profilesLoaded
    ? current.applied
    : canHaveOwnSettings(activeProfile) && isPlainObject(ownSettingsOf(current.overrides, activeProfile)) ? activeProfile : null
  const plan = planProfileSettings(settings, target)
  // The replaced settings can change while every value stays the same.
  const replaced = shared => Object.keys(shared).sort().join('\0')
  if (plan.applied === current.applied && plan.changed.length === 0 && replaced(plan.shared) === replaced(current.shared)) return
  // The commit updates `current`.
  const previous = current.applied
  store.commit('applyProfileSettings', plan)
  for (const settingId of plan.changed) {
    applySettingSideEffects(store, settingId, settings[settingId])
  }
  // An icon pack still loading for the previous profile must not show, also
  // when this one uses the same pack.
  if (plan.applied !== previous && !plan.changed.includes('iconPack')) {
    applySettingSideEffects(store, 'iconPack', settings.iconPack)
  }
  reportProfileSettings(settings)
}

/**
 * Tells the main process which own settings this window's active profile
 * shows, as it opens tabs on its landing page and follows its base theme.
 * @param {Record<string, any>} settings the settings state
 */
function reportProfileSettings(settings) {
  if (!process.env.IS_ELECTRON) return
  const shown = Object.fromEntries(Object.keys(settings.profileSettingsState.shared).map(key => [key, settings[key]]))
  // The store's proxies can't be sent.
  window.ftElectron.applyProfileSettings(JSON.parse(JSON.stringify(shown)))
}

/**
 * Runs what a setting does once it shows a new value that came from
 * elsewhere: another window, or a profile switch.
 */
function applySettingSideEffects({ dispatch }, settingId, value) {
  if (settingsWithSideEffects.includes(settingId)) {
    Promise.resolve(dispatch(defaultSideEffectsTriggerId(settingId), value)).catch(error => console.error(error))
  }
  if (settingId === 'navigationItems' && !normalizeNavigationItems(value).includes('home')) {
    dispatch('redirectHomeTabsToLandingPage').catch(error => {
      console.error('Failed to redirect Home tabs after the navigation items changed', error)
    })
  }
}

/**
 * Shows the settings of the active profile whenever it, or the settings of a
 * profile, change.
 * @param {import('vuex').Store<any>} store
 */
export function profileSettingsPlugin(store) {
  store.subscribe(mutation => {
    if (PROFILE_SETTINGS_MUTATIONS.has(mutation.type)) applyActiveProfileSettings(store)
  })
}

// #endregion profile settings

const customState = {
  profileSettingsState: {
    /** The profile whose own settings show, or null for the shared settings */
    applied: null,
    /** The own settings of each profile that has them, by profile ID */
    overrides: {},
    /** The shared values of the settings the applied profile replaces */
    shared: {},
  },
}

const customGetters = {
  getEnableDownloads: (state) => state.enableDownloads,
  // A synchronized preference must not expose a service absent on this device.
  getUseVoiceOverTranslation: (state) => !process.env.IS_IOS && state.useVoiceOverTranslation,
  // The web app loses the local API when its browser extension is removed.
  // Keep the saved choice for when the extension comes back.
  getBackendPreference: (state) => !process.env.SUPPORTS_LOCAL_API && state.backendPreference === 'local'
    ? 'invidious'
    : state.backendPreference,

  // Only Android reports metered networks, so `metered` stays off elsewhere.
  getUseDataSaverThumbnails: (state) => state.thumbnailDataSaverMode === 'always' ||
    (state.thumbnailDataSaverMode === 'metered' && networkMetered.value),

  getFullscreenActions: (state) => normalizeFullscreenActions(state.fullscreenActions),
  getSubscriptionTabs: (state) => normalizeSubscriptionTabs(state.subscriptionTabs),
  getControlBarButtons: (state) => normalizeControlBarButtons(state.controlBarButtons),
  getPlayerMenuControls: (state) => normalizePlayerMenuControls(state.playerMenuControls),
  getHiddenPlayerMenuControls: (state) => withoutControlBarButtons(
    normalizeHiddenPlayerMenuControls(state.hiddenPlayerMenuControls),
    normalizeControlBarButtons(state.controlBarButtons)
  ),
  getQuickSettings: (state) => normalizeQuickSettings(state.quickSettings),

  getNavigationItems: (state) => normalizeNavigationItems(state.navigationItems),

  getLandingPage: (state, getters) => resolveLandingPage(
    state.landingPage,
    filterAvailableNavigationItems(normalizeNavigationItems(state.navigationItems), {
      supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
      backendPreference: getters.getBackendPreference,
      backendFallback: state.backendFallback,
      showWatchStats: state.rememberHistory && state.enableWatchStats,
      supportsYtDlp,
      enableTwitchPage: state.enableTwitchPage,
    })
  ),

  // A separate profile keeps the YouTube playlists it saved to itself.
  getPlaylistBookmarks: (state, _getters, _rootState, rootGetters) => {
    const bookmarks = rootGetters.getActiveDataScope === null
      ? state.playlistBookmarks
      : rootGetters.getActiveProfile.playlistBookmarks
    return Array.isArray(bookmarks) ? bookmarks : []
  },

  getPlaylistBookmark: (_state, getters) => (playlistId) => {
    return getters.getPlaylistBookmarks.find(bookmark => bookmark?.playlist?.id === playlistId)
  },

  // These parsed variants are cached by Vuex,
  // so that list items don't each have to parse the JSON strings themselves

  getChannelsHiddenParsed: (state) => {
    return JSON.parse(state.channelsHidden).map((ch) => {
      // Legacy support
      if (typeof ch === 'string') {
        return { name: ch, preferredName: '', icon: '' }
      }
      return ch
    })
  },

  /** Set of the `name` values in `channelsHidden` for cheap exact-match lookups */
  getChannelsHiddenNames: (_state, getters) => {
    return new Set(getters.getChannelsHiddenParsed.map((ch) => ch.name))
  },

  /** Only showing important notifications moves progress to the progress bar */
  getEffectiveShowProgressBarToast: (state) => {
    return state.showProgressBarToast && !state.onlyShowImportantToasts
  },

  getActiveChannelsHidden: (state, getters) => {
    return state.enableBlockLists ? getters.getChannelsHiddenParsed : []
  },

  getActiveChannelsHiddenNames: (state, getters) => {
    return state.enableBlockLists ? getters.getChannelsHiddenNames : new Set()
  },

  /** Lowercased for case-insensitive matching */
  getForbiddenTitlesParsed: (state) => {
    return JSON.parse(state.forbiddenTitles).map((title) => title.toLowerCase())
  },

  getActiveForbiddenTitles: (state, getters) => {
    return state.enableBlockLists ? getters.getForbiddenTitlesParsed : []
  },

  /** Lists keep block list matches and blur them instead of removing them */
  getBlurBlockedItemsActive: (state) => {
    return state.enableBlockLists && state.blurBlockedItems
  },

  /** Hidden channels that lists remove; autoplay and navigation use `getActiveChannelsHiddenNames` */
  getChannelsHiddenNamesToRemove: (_state, getters) => {
    return getters.getBlurBlockedItemsActive ? new Set() : getters.getActiveChannelsHiddenNames
  },

  /** Forbidden text that lists remove; autoplay and navigation use `getActiveForbiddenTitles` */
  getForbiddenTitlesToRemove: (_state, getters) => {
    return getters.getBlurBlockedItemsActive ? [] : getters.getActiveForbiddenTitles
  },

  // The shared settings, also while the active profile has its own
  getTransferableSettings: (state) => {
    return getTransferableSettings({ ...state, ...state.profileSettingsState.shared })
  },

  getSharedSettingValue: (state) => (settingId) => sharedSettingValue(state, settingId),

  /** The own settings of a profile, or null if it uses the shared settings */
  getProfileOwnSettings: (state) => (profileId) => {
    const settings = ownSettingsOf(state.profileSettingsState.overrides, profileId)
    return isPlainObject(settings) ? settings : null
  },

  /** The profile whose own settings show, or null while the shared settings do */
  getProfileSettingsTarget: (state) => state.profileSettingsState.applied,

  /** Whether the active profile gives the setting its own value */
  isSettingProfileSpecificValue: (state) => (settingId) => (
    state.profileSettingsState.applied !== null && Object.hasOwn(state.profileSettingsState.shared, settingId)
  ),

  getDefaultPlayback(state) {
    return Math.round((state.defaultPlayback + Number.EPSILON) * 100) / 100
  },
}

const customMutations = {
  setPreferredCaptionLocale: (state, value) => {
    assignSharedSetting(state, 'preferredCaptionLocale', normalizeYouTubeCaptionLanguageCode(value))
  },
  setTabBarPosition: (state, value) => {
    assignSharedSetting(state, 'tabBarPosition', normalizeTabBarPosition(value))
  },

  // The own settings of each profile that has them, by profile ID
  setProfileSettingsList: (state, profiles) => {
    state.profileSettingsState.overrides = profiles
  },

  // `settings` is null when the profile uses the shared settings.
  setProfileOwnSettings: (state, { profileId, settings }) => {
    if (isPlainObject(settings)) state.profileSettingsState.overrides[profileId] = withPendingProfileEdits(profileId, settings)
    else delete state.profileSettingsState.overrides[profileId]
  },

  /** Shows an edit of a profile's own setting before it is saved */
  setProfileSettingValue: (state, { profileId, settingId, value }) => {
    const settings = ownSettingsOf(state.profileSettingsState.overrides, profileId)
    if (!isPlainObject(settings)) return
    if (value === undefined) delete settings[settingId]
    else settings[settingId] = value
  },

  // Takes a plan from `planProfileSettings`.
  applyProfileSettings: (state, { applied, shared, values }) => {
    state.profileSettingsState.applied = applied
    state.profileSettingsState.shared = shared
    Object.assign(state, values)
  },
}

function updateValidatedSetting(commit, settingId, value) {
  const target = settingTarget(settingId)
  if (target !== null) return updateProfileSetting(commit, target, settingId, value)
  return settingWrites.track(settingId, async () => {
    await saveSettingEdit(commit, settingId, () => DBSettingHandlers.upsert(settingId, value))
    commit(defaultMutationId(settingId), value)
  }).then(() => true, error => {
    console.error(error)
    return false
  })
}

/** @type {Map<string, Promise<unknown>>} */
const pendingLocks = new Map()

/**
 * Runs `run` inside the lock `name`, which all windows share, or a queue where
 * locks are missing.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
function runLocked(name, run) {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, run)
  const result = (pendingLocks.get(name) ?? Promise.resolve()).catch(() => {}).then(run)
  pendingLocks.set(name, result)
  return result
}

/**
 * Runs `persist` inside a lock all windows share for `settingId`, so
 * read-modify-write updates cannot interleave.
 * @param {string} settingId
 * @param {() => Promise<void>} persist
 * @returns {Promise<boolean>} whether the update was saved
 */
function runLockedSettingUpdate(settingId, persist) {
  return runLocked(`opentubex-setting-${settingId}`, persist).then(() => true, error => {
    console.error(error)
    return false
  })
}

/**
 * Applies `update` to the saved bookmarks. Every bookmark write, including
 * sync's, reads and writes inside one lock shared by all windows, so
 * concurrent edits build on each other instead of overwriting each other.
 * @param {Function} commit
 * @param {(bookmarks: any[]) => any[]} update
 */
function updateSavedPlaylistBookmarks(commit, update) {
  const persist = async () => {
    // Read the datastore, as the broadcast of another window's edit may still be on its way.
    const saved = await DBSettingHandlers.findValue('playlistBookmarks')
    const bookmarks = update(Array.isArray(saved) ? saved : [])
    await DBSettingHandlers.upsert('playlistBookmarks', bookmarks)
    commit('setPlaylistBookmarks', bookmarks)
  }
  return runLockedSettingUpdate('playlistBookmarks', persist)
}

const updateOptimisticSetting = createOptimisticSettingUpdater()

function updateOrderedSetting(commit, settings, settingId, value) {
  const target = settingTarget(settingId)
  if (target !== null) return updateProfileSetting(commit, target, settingId, value, true)
  return settingWrites.track(settingId, () => updateOptimisticSetting(settingId, value, {
    // The shared value, also while the active profile replaces it, so a failed
    // write restores it rather than the profile's.
    read: () => sharedSettingValue(settings, settingId),
    commit: nextValue => commit(defaultMutationId(settingId), nextValue),
    persist: nextValue => saveSettingEdit(commit, settingId, () => DBSettingHandlers.upsert(settingId, nextValue)),
  })).then(() => true).catch(error => {
    console.error(error)
    return false
  })
}

const editSavedSetting = createSavedSettingEditor()

/**
 * Applies `update` to a setting that other windows can change at the same
 * time. A function derives the new value from the current one, so the edit
 * keeps what other windows saved meanwhile. A value (imports, resets) replaces it.
 * @template T
 * @param {Function} commit
 * @param {Record<string, any>} settings
 * @param {string} settingId
 * @param {T | ((value: T) => T)} update
 * @returns {Promise<boolean>} whether the edit was saved
 */
function updateSharedSetting(commit, settings, settingId, update) {
  const edit = typeof update === 'function' ? update : () => update
  return settingWrites.track(settingId, () => editSavedSetting(settingId, edit, {
    read: () => sharedSettingValue(settings, settingId),
    commit: value => commit(defaultMutationId(settingId), value),
    readSaved: async () => (await DBSettingHandlers.findValue(settingId)) ?? structuredClone(DEFAULT_SETTINGS[settingId]),
    write: value => saveSettingEdit(commit, settingId, () => DBSettingHandlers.upsert(settingId, value)),
    lock: run => runLocked(`opentubex-setting-${settingId}`, run),
  })).then(() => true, error => {
    console.error(error)
    return false
  })
}

let androidProxyUpdate = Promise.resolve()

const customActions = {
  async updateSyncServerActivityClearedThrough({ commit }, value) {
    const persist = async () => {
      const cutoffs = { ...await DBSettingHandlers.findValue('syncServerActivityClearedThrough') }
      for (const [account, cutoff] of Object.entries(value)) {
        if (!cutoffs[account] || cutoff > cutoffs[account]) cutoffs[account] = cutoff
      }
      await DBSettingHandlers.upsert('syncServerActivityClearedThrough', cutoffs)
      commit('setSyncServerActivityClearedThrough', cutoffs)
    }
    // Read and merge inside the shared lock so stale windows cannot undo a
    // newer dismissal or drop another account's cutoff during concurrent clears.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('opentubex-sync-server-activity-clear', persist)
    } else await persist()
  },
  ...Object.fromEntries(ANDROID_PROXY_SETTING_KEYS.filter(() => process.env.IS_CAPACITOR).map(settingId => [
    defaultUpdaterId(settingId),
    ({ commit, state }, value) => {
      // Serialize across fields so a fast host/port edit cannot restore stale values.
      androidProxyUpdate = androidProxyUpdate.then(async () => {
        await configureAndroidProxy({ ...state, [settingId]: value })
        // Native persistence is authoritative, including when the renderer's
        // database cannot save its copy of the settings.
        commit(defaultMutationId(settingId), value)
        await DBSettingHandlers.upsert(settingId, value)
        if (state.useProxy) {
          await ensureAndroidLocalNetworkAccess({ hostname: state.proxyHostname, direct: true })
        }
      }).catch(error => {
        showToast({
          message: error?.code === 'LOCAL_ACCESS_DENIED'
            ? error.message
            : i18n.global.t('Settings.Proxy Settings["Error getting network information. Is your proxy configured properly?"]'),
          icon: ['fas', 'circle-exclamation'],
        })
      })
      return androidProxyUpdate
    }
  ])),
  waitForAndroidProxySettings: () => androidProxyUpdate,
  loadAndroidProxySettings: async ({ commit }) => {
    const settings = await readAndroidProxySettings()
    if (settings === null) return
    for (const settingId of ANDROID_PROXY_SETTING_KEYS) {
      commit(defaultMutationId(settingId), settings[settingId])
    }
  },
  // Marks go to the data scope active when they are made: a separate
  // profile's own, or the shared ones.
  async mergeSubscriptionSeenVideos({ dispatch }, update) {
    const scope = getDataScope()
    const saved = await DBSettingHandlers.mergeSeenVideos(update)
    if (scope === getDataScope()) await dispatch('applySubscriptionSeenVideos', saved)
  },
  async mergeSubscriptionSeenPosts({ dispatch }, update) {
    const scope = getDataScope()
    const saved = await DBSettingHandlers.mergeSeenPosts(update)
    if (scope === getDataScope()) await dispatch('applySubscriptionSeenPosts', saved)
  },
  /**
   * Shows the seen marks of the data scope a profile switch shows, which
   * clears the previous profile's first.
   * @returns {Promise<boolean>} whether they loaded
   */
  async grabSubscriptionSeenMarks({ commit }) {
    const scope = getDataScope()
    const values = await Promise.all(SCOPED_SEEN_MARK_SETTINGS.map(setting => DBSettingHandlers.findValue(seenMarksSettingId(setting, scope))))
    if (scope !== getDataScope()) return true
    SCOPED_SEEN_MARK_SETTINGS.forEach((setting, index) => commit(defaultMutationId(setting), values[index] ?? '[]'))
    return true
  },
  applySubscriptionSeenPosts({ commit, state }, saved) {
    const value = JSON.stringify(mergeSubscriptionSeenPosts(state.subscriptionSeenPosts, saved))
    if (value !== state.subscriptionSeenPosts) commit('setSubscriptionSeenPosts', value)
  },
  async mergeRssFeedSeenItems({ dispatch }, update) {
    const saved = await DBSettingHandlers.mergeSeenRssItems(update)
    await dispatch('applyRssFeedSeenItems', saved)
  },
  applyRssFeedSeenItems({ commit, state }, saved) {
    // Another window's newer update may arrive before this request's reply.
    const value = JSON.stringify(mergeRssFeedSeenItems(state.rssFeedSeenItems, saved))
    if (value !== state.rssFeedSeenItems) commit('setRssFeedSeenItems', value)
  },
  applySubscriptionSeenVideos({ commit, state, rootGetters }, saved) {
    // Another window's newer update may arrive before this request's reply.
    const value = JSON.stringify(mergeSubscriptionSeenVideos(
      state.subscriptionSeenVideos, saved, rootGetters.getHistoryCacheById
    ))
    if (value !== state.subscriptionSeenVideos) commit('setSubscriptionSeenVideos', value)
  },
  // Saves an edit of a synced value that is not a setting, such as the custom themes.
  saveSyncSettingEdit: ({ commit }, { settingId, save }) => saveSettingEdit(commit, settingId, save),
  updateFullscreenActions: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'fullscreenActions',
    normalizeFullscreenActions(value)
  ),
  updateSubscriptionTabs: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'subscriptionTabs',
    normalizeSubscriptionTabs(value)
  ),
  updateControlBarButtons: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'controlBarButtons',
    normalizeControlBarButtons(value)
  ),
  updatePlayerMenuControls: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'playerMenuControls',
    normalizePlayerMenuControls(value)
  ),
  updateHiddenPlayerMenuControls: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'hiddenPlayerMenuControls',
    normalizeHiddenPlayerMenuControls(value)
  ),
  updateQuickSettings: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'quickSettings',
    normalizeQuickSettings(value)
  ),

  // Each speed or name edit rewrites the whole list from the current state.
  updateQuickPlaybackSpeedBarOptions: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'quickPlaybackSpeedBarOptions',
    value
  ),

  updateNavigationItems: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'navigationItems',
    normalizeNavigationItems(value)
  ),

  updatePinnedPlaylistIds: ({ commit, state }, update) => updateSharedSetting(commit, state, 'pinnedPlaylistIds', update),
  updateUserPlaylistsPinnedIds: ({ commit, state }, update) => updateSharedSetting(commit, state, 'userPlaylistsPinnedIds', update),
  // Takes the new groups (sync, imports) or a function that derives them from
  // the saved ones. Edits read the saved groups inside a lock all windows
  // share, so an edit in one window cannot undo another's.
  updateSubscriptionGroups: ({ commit, state }, update) => settingWrites.track('subscriptionGroups', () => runLockedSettingUpdate('subscriptionGroups', async () => {
    // Read the datastore, as the broadcast of another window's edit may still be on its way.
    const saved = await DBSettingHandlers.findValue('subscriptionGroups')
    const groups = typeof update === 'function' ? update(saved === undefined ? state.subscriptionGroups : saved) : update
    await saveSettingEdit(commit, 'subscriptionGroups', () => DBSettingHandlers.upsert('subscriptionGroups', groups))
    commit('setSubscriptionGroups', groups)
  })),
  updateSubscribedChannelsCustomOrder: ({ commit, state }, value) => updateOrderedSetting(
    commit, state, 'subscribedChannelsCustomOrder', value
  ),
  updateFollowedRssFeeds: ({ commit, state }, update) => updateSharedSetting(commit, state, 'followedRssFeeds', update),
  updateFollowedChannels: ({ commit, state }, update) => updateSharedSetting(commit, state, 'followedChannels', update),
  updateChannelsHidden: ({ commit, state }, update) => updateSharedSetting(commit, state, 'channelsHidden', update),
  updateForbiddenTitles: ({ commit, state }, update) => updateSharedSetting(commit, state, 'forbiddenTitles', update),
  updateSponsorBlockChannelWhitelist: ({ commit, state }, update) => updateSharedSetting(
    commit, state, 'sponsorBlockChannelWhitelist', update
  ),
  // The settings saved per channel, as JSON strings
  updateChannelPlaybackSpeeds: ({ commit, state }, update) => updateSharedSetting(commit, state, 'channelPlaybackSpeeds', update),
  updateChannelVideoQualities: ({ commit, state }, update) => updateSharedSetting(commit, state, 'channelVideoQualities', update),
  updateChannelSubtitlesStates: ({ commit, state }, update) => updateSharedSetting(commit, state, 'channelSubtitlesStates', update),
  updateChannelVolumes: ({ commit, state }, update) => updateSharedSetting(commit, state, 'channelVolumes', update),
  updatePinnedChannels: async ({ commit, state }, update) => {
    const previousIds = state.pinnedChannels.map(channel => channel.id)
    if (!await updateSharedSetting(commit, state, 'pinnedChannels', update)) return false
    // Only drop unpinned channels, as other windows may have pinned channels this one doesn't show yet.
    const pinnedIds = new Set(state.pinnedChannels.map(channel => channel.id))
    const unpinnedIds = previousIds.filter(id => !pinnedIds.has(id) && state.pinnedChannelMetadata[id])
    if (unpinnedIds.length === 0) return true
    return updateSharedSetting(commit, state, 'pinnedChannelMetadata', saved => Object.fromEntries(
      Object.entries(saved).filter(([id]) => !unpinnedIds.includes(id))
    ))
  },
  refreshPinnedChannelMetadata: ({ commit, state }, { id, name, thumbnail }) => {
    const pin = state.pinnedChannels.find(channel => channel.id === id)
    if (!pin) return
    const previous = state.pinnedChannelMetadata[id] ?? pin
    if ((name || previous.name) === previous.name && (thumbnail || previous.thumbnail) === previous.thumbnail) return
    // Missing details fall back to the saved ones, which another window may have refreshed.
    return updateSharedSetting(commit, state, 'pinnedChannelMetadata', saved => {
      const current = saved[id] ?? pin
      return { ...saved, [id]: { name: name || current.name, thumbnail: thumbnail || current.thumbnail } }
    })
  },

  // Home customization edits build on the previous edit, so commit them before the save finishes.
  updateHomeSectionLayout: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'homeSectionLayout',
    value
  ),

  updateYtDlpAutomaticDownloadRules: ({ commit, state }, update) => {
    // Imports pass a write they authorized when the user started them.
    const authorizedWrite = update?.authorizedWrite
    if (authorizedWrite) update = update.value
    // Capture authorization during the gesture, before earlier saves can delay this one.
    const persist = process.env.IS_ELECTRON
      ? authorizedWrite ?? window.ftElectron.prepareAutomaticDownloadRulesWrite()
      : value => DBSettingHandlers.upsert('ytDlpAutomaticDownloadRules', value)
    // Apply every mutation to saved rules so later edits preserve intervening cleanups.
    pendingAutomaticDownloadRuleUpdate = pendingAutomaticDownloadRuleUpdate.then(async () => {
      if (persist === null) throw new Error('Automatic download rules require a user action')
      const value = typeof update === 'function' ? update(state.ytDlpAutomaticDownloadRules) : update
      await saveSettingEdit(commit, 'ytDlpAutomaticDownloadRules', () => persist(value))
      // Publish successful writes even if a later edit is queued and could fail.
      commit('setYtDlpAutomaticDownloadRules', value)
      return true
    }).catch(error => {
      console.error(error)
      return false
    })
    return settingWrites.track('ytDlpAutomaticDownloadRules', () => pendingAutomaticDownloadRuleUpdate)
  },

  savePlaylistBookmark: ({ dispatch }, bookmark) => dispatch('updateActivePlaylistBookmarks', bookmarks => [
    ...bookmarks.filter(entry => entry?.playlist?.id !== bookmark.playlist.id),
    bookmark,
  ]),

  removePlaylistBookmark: async ({ commit, dispatch, state }, playlistId) => {
    const removed = await dispatch(
      'updateActivePlaylistBookmarks',
      bookmarks => bookmarks.filter(bookmark => bookmark?.playlist?.id !== playlistId)
    )
    if (!removed) return false
    // Saving the playlist again should not bring back an old pin.
    if (state.userPlaylistsPinnedIds.includes(playlistId)) {
      await updateSharedSetting(commit, state, 'userPlaylistsPinnedIds', ids => ids.filter(id => id !== playlistId))
    }
    return true
  },

  // Applies `update` to the bookmarks of the active profile: a separate
  // profile's own, or the shared ones.
  updateActivePlaylistBookmarks: ({ commit, rootGetters }, update) => {
    const scope = rootGetters.getActiveDataScope
    if (scope === null) return updateSavedPlaylistBookmarks(commit, update)
    // Like the shared bookmarks, edits read the saved list inside a lock all windows share.
    return runLockedSettingUpdate(`playlistBookmarks-${scope}`, async () => {
      const profile = (await DBProfileHandlers.find()).find(profile => profile._id === scope)
      if (profile?.separate !== true) throw new Error('The separate profile is gone')
      const bookmarks = update(Array.isArray(profile.playlistBookmarks) ? profile.playlistBookmarks : [])
      const saved = await DBProfileHandlers.updatePlaylistBookmarks(scope, bookmarks)
      if (saved === null) throw new Error('The separate profile is gone')
      commit('setProfilePlaylistBookmarks', { profileId: scope, playlistBookmarks: saved.playlistBookmarks })
    })
  },

  /**
   * Saves the reset of a data scope's watch statistics: the shared reset, or a
   * separate profile's. A null reset deletes a separate profile's. Another
   * window can save a newer one meanwhile, so with `pendingId` it only
   * acknowledges that pending reset, and with `replacingId` it only replaces
   * that reset.
   * @param {{ scope: string | null, reset: object | null, pendingId?: string, replacingId?: string }} payload
   */
  updateWatchStatsReset: ({ commit, dispatch }, { scope, reset, pendingId, replacingId }) => {
    const replaces = saved => (pendingId === undefined || (saved?.pending === true && saved.id === pendingId)) &&
      (replacingId === undefined || saved?.id === replacingId)
    if (scope === null) {
      return runLockedSettingUpdate('syncServerWatchStatsResetUpdate', async () => {
        if (replaces(await DBSettingHandlers.findValue('syncServerWatchStatsReset'))) {
          await dispatch('updateSyncServerWatchStatsReset', reset)
        }
      })
    }
    // Windows that show other separate profiles save theirs meanwhile.
    return runLockedSettingUpdate('syncServerScopedWatchStatsResets', async () => {
      const saved = await DBSettingHandlers.findValue('syncServerScopedWatchStatsResets')
      const resets = { ...(saved && typeof saved === 'object' ? saved : {}) }
      if (!replaces(resets[scope])) return
      if (reset) resets[scope] = reset
      else delete resets[scope]
      await DBSettingHandlers.upsert('syncServerScopedWatchStatsResets', resets)
      commit('setSyncServerScopedWatchStatsResets', resets)
    })
  },

  // Takes the new list (imports, resets) or a function that derives it from the
  // saved one (sync). These are the shared bookmarks, whichever profile is active.
  updatePlaylistBookmarks: ({ commit }, update) => updateSavedPlaylistBookmarks(
    commit,
    typeof update === 'function' ? update : () => update
  ),

  updatePreferredCaptionLocale: ({ commit }, value) => updateValidatedSetting(
    commit,
    'preferredCaptionLocale',
    normalizeYouTubeCaptionLanguageCode(value)
  ),

  updateAppFont: ({ commit }, value) => updateValidatedSetting(
    commit,
    'appFont',
    normalizeAppFont(value)
  ),

  updateMoveDownloadsToAppHeader: ({ commit }, value) => {
    const target = settingTarget('moveDownloadsToAppHeader')
    if (target !== null) return updateProfileSetting(commit, target, 'moveDownloadsToAppHeader', value)
    return settingWrites.track('moveDownloadsToAppHeader', async () => {
      await saveSettingEdit(commit, 'moveDownloadsToAppHeader', () => DBSettingHandlers.upsert('moveDownloadsToAppHeader', value))
      commit('setMoveDownloadsToAppHeader', value)
      await DBSettingHandlers.delete('moveDownloadsToQuickSettings')
    }).then(() => true, error => {
      console.error(error)
      return false
    })
  },

  updateMaterialSeedColor: ({ commit, state }, value) => updateOrderedSetting(
    commit, state, 'materialSeedColor', normalizeMaterialSeedColor(value)
  ),

  updateSignalAccentColor: ({ commit, state }, value) => updateOrderedSetting(
    commit, state, 'signalAccentColor', normalizeSignalAccentColor(value)
  ),

  updateBaseTheme: ({ commit, rootGetters }, value) => updateValidatedSetting(
    commit,
    'baseTheme',
    resolveBaseTheme(value, 'system', rootGetters.getCustomThemes)
  ),

  updateSystemLightTheme: ({ commit, rootGetters }, value) => updateValidatedSetting(
    commit,
    'systemLightTheme',
    resolveSystemTheme(value, 'light', rootGetters.getCustomThemes)
  ),

  updateSystemDarkTheme: ({ commit, rootGetters }, value) => updateValidatedSetting(
    commit,
    'systemDarkTheme',
    resolveSystemTheme(value, 'dark', rootGetters.getCustomThemes)
  ),

  updateMainColor: ({ commit }, value) => updateValidatedSetting(
    commit,
    'mainColor',
    resolveColor(value, 'Red')
  ),

  updateSecColor: ({ commit }, value) => updateValidatedSetting(
    commit,
    'secColor',
    resolveColor(value, 'Blue')
  ),

  updateTabBarPosition: ({ commit }, value) => updateValidatedSetting(
    commit,
    'tabBarPosition',
    normalizeTabBarPosition(value)
  ),

  updateIconPack: async ({ commit, state }, value) => {
    if (!isIconPack(value)) return false
    const target = settingTarget('iconPack')
    // The active profile's own icons keep showing.
    const shown = target !== null || !isSettingReplaced('iconPack')
    if (shown && !await setIconPack(value)) return false
    // The profile's own pack is shown again once it is saved, see `applyActiveProfileSettings`.
    if (target !== null) {
      const saved = await updateProfileSetting(commit, target, 'iconPack', value)
      if (!saved && isIconPack(state.iconPack)) await setIconPack(state.iconPack)
      return saved
    }
    return settingWrites.track('iconPack', async () => {
      try {
        await saveSettingEdit(commit, 'iconPack', () => DBSettingHandlers.upsert('iconPack', value))
        commit('setIconPack', value)
        return true
      } catch (error) {
        // Show the pack of the settings that show now, which a profile switch
        // meanwhile can have changed.
        if (shown && isIconPack(state.iconPack)) {
          await setIconPack(state.iconPack)
        }
        console.error(error)
        return false
      }
    })
  },

  /**
   * Gives a profile its own settings, which start as the shared ones, or
   * deletes them so that it uses the shared settings again.
   * @param {{ profileId: string, enabled: boolean }} payload
   * @returns {Promise<boolean>} whether it was saved
   */
  setProfileOwnSettingsEnabled: ({ commit }, { profileId, enabled }) => {
    if (!canHaveOwnSettings(profileId)) return Promise.resolve(false)
    const id = profileSettingsId(profileId)
    return settingWrites.track(id, () => runLockedSettingUpdate(id, async () => {
      const saved = await DBSettingHandlers.findValue(id)
      if (isPlainObject(saved) === enabled) {
        commit('setProfileOwnSettings', { profileId, settings: enabled ? saved : null })
        return
      }
      if (!isPlainObject(saved) && !await profileExists(profileId)) throw new Error('The profile no longer exists')
      // Turning them off saves null rather than deleting them, so other
      // windows and devices learn about it.
      const settings = enabled ? {} : null
      await saveSettingEdit(commit, id, () => DBSettingHandlers.upsert(id, settings))
      commit('setProfileOwnSettings', { profileId, settings })
    }))
  },

  /**
   * Lets the active profile use the shared values of settings again. They all
   * go to the profile active now, even if another one becomes active meanwhile.
   * @param {string[]} settingIds
   * @returns {Promise<boolean>} whether every one was saved
   */
  useSharedSettingValue: ({ commit, state }, settingIds) => {
    const profileId = state.profileSettingsState.applied
    const ids = settingIds.filter(isProfileSpecificSetting)
    if (profileId === null || ids.length === 0) return Promise.resolve(false)
    return Promise.all(ids.map(settingId => updateProfileSetting(commit, profileId, settingId, undefined)))
      .then(results => results.every(Boolean))
  },

  /**
   * Saves a repaired value of a shown setting, such as a theme that names a
   * deleted custom theme, where its value comes from: the own settings of the
   * active profile, or the shared ones it inherits.
   * @param {{ settingId: string, value: unknown }} payload
   */
  repairShownSetting: ({ dispatch, state }, { settingId, value }) => {
    const update = () => dispatch(defaultUpdaterId(settingId), value)
    return Object.hasOwn(state.profileSettingsState.shared, settingId) ? update() : withSharedSettings(update)
  },

  /**
   * Replaces the own settings of a profile with restored ones, such as those
   * of a backup. They count as a new edit, so sync keeps them.
   * @param {{ profileId: string, settings: unknown }} payload
   * @returns {Promise<boolean>} whether they were saved
   */
  restoreProfileSettings: ({ commit }, { profileId, settings }) => {
    if (!canHaveOwnSettings(profileId) || !isPlainObject(settings)) return Promise.resolve(false)
    const id = profileSettingsId(profileId)
    const restored = sanitizeProfileSettings(settings)
    return settingWrites.track(id, () => runLockedSettingUpdate(id, async () => {
      const saved = await DBSettingHandlers.findValue(id)
      if (!isPlainObject(saved) && !await profileExists(profileId)) throw new Error('The profile no longer exists')
      if (!isPlainObject(saved) || !sameSettingValue(sanitizeProfileSettings(saved), restored)) {
        await saveSettingEdit(commit, id, () => DBSettingHandlers.upsert(id, restored))
      }
      commit('setProfileOwnSettings', { profileId, settings: restored })
    }))
  },

  /**
   * Saves the own settings of a profile from sync, unless they changed since
   * sync read them. Settings this device doesn't sync keep their own value.
   * @param {{ profileId: string, settings: Record<string, unknown> | null, previous: Record<string, unknown> | null, isSynced: (settingId: string) => boolean }} payload
   *   `previous` holds the synced settings as sync read them, null if the profile used the shared settings
   * @returns {Promise<boolean>} false if they changed meanwhile
   */
  saveSyncedProfileSettings: ({ commit }, { profileId, settings, previous, isSynced }) => {
    if (!canHaveOwnSettings(profileId)) return Promise.resolve(false)
    const id = profileSettingsId(profileId)
    let saved = false
    return settingWrites.track(id, () => runLockedSettingUpdate(id, async () => {
      const current = await DBSettingHandlers.findValue(id)
      if (!sameSettingValue(syncedProfileSettings(current, isSynced), previous)) return
      if (!isPlainObject(current) && !await profileExists(profileId)) return
      const next = isPlainObject(settings)
        ? {
            ...Object.fromEntries(Object.entries(sanitizeProfileSettings(current)).filter(([key]) => !isSynced(key))),
            ...Object.fromEntries(Object.entries(sanitizeProfileSettings(settings)).filter(([key]) => isSynced(key))),
          }
        : null
      await DBSettingHandlers.upsert(id, next)
      commit('setProfileOwnSettings', { profileId, settings: next })
      saved = true
    })).then(ok => ok && saved)
  },

  resetSettingToDefault: ({ dispatch }, settingKey) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, settingKey)) {
      return
    }

    return dispatch(defaultUpdaterId(settingKey), structuredClone(DEFAULT_SETTINGS[settingKey]))
  },

  updateSettingsPassword: async ({ commit }, value) => {
    try {
      const hashedPassword = await hashPassword(value)

      await DBSettingHandlers.upsert('settingsPassword', hashedPassword)

      commit('setSettingsPassword', hashedPassword)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  grabUserSettings: async ({ commit, dispatch, state }) => {
    try {
      const userSettings = await DBSettingHandlers.find()
      let landingPageToInitialize = null

      const mutationIds = Object.keys(mutations)

      const alreadyTriggeredSideEffects = []
      const sideEffectPromises = []

      // The icons load alongside the other settings' side effects. A pack that
      // cannot load is replaced by the other one, which is then saved.
      let iconPackApplied
      // `owner` is the profile whose own pack `value` is, or null for the shared one.
      const applyIconPack = (value, owner = null) => {
        iconPackApplied = dispatch(defaultSideEffectsTriggerId('iconPack'), value).then(async (resolvedValue) => {
          if (resolvedValue === value) return
          if (owner !== null) {
            await updateProfileSetting(commit, owner, 'iconPack', resolvedValue)
          } else {
            await DBSettingHandlers.upsert('iconPack', resolvedValue)
            commit('setIconPack', resolvedValue)
          }
        })
        // A failure is handled where the result is awaited below.
        iconPackApplied.catch(() => {})
      }

      // The default profile shows its own settings from the start, so their
      // side effects run once, with its values. Until the profiles load,
      // `applyActiveProfileSettings` keeps them.
      const profileSettings = collectProfileSettings(userSettings)
      const defaultProfile = userSettings.find(entry => entry._id === 'defaultProfile')?.value
      const startupProfile = canHaveOwnSettings(defaultProfile) && Object.hasOwn(profileSettings, defaultProfile)
        ? defaultProfile
        : null
      const startupProfileSettings = sanitizeProfileSettings(profileSettings[startupProfile])

      for (const { _id, value } of userSettings) {
        let resolvedValue = value
        if (_id === 'syncServerUrl') {
          const migratedUrl = migrateSyncServerUrl(value)
          if (migratedUrl !== value) {
            try {
              await DBSettingHandlers.upsert(_id, migratedUrl)
              resolvedValue = migratedUrl
            } catch (error) {
              console.error('Failed to migrate sync server URL', error)
            }
          }
        }
        if (settingsWithSideEffects.includes(_id) && !Object.hasOwn(startupProfileSettings, _id)) {
          if (_id === 'iconPack') {
            applyIconPack(value)
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), value)
            )
          }
          alreadyTriggeredSideEffects.push(_id)
        }

        // A separate profile shows its own seen marks, see `grabSubscriptionSeenMarks`.
        if (mutationIds.includes(defaultMutationId(_id)) && shownSeenMarksSetting(_id, getDataScope()) !== null) {
          commit(defaultMutationId(_id), resolvedValue)
        }
      }

      const hasNavigationItems = userSettings.some(entry => entry._id === 'navigationItems')
      if (!hasNavigationItems && userSettings.length > 0) {
        await dispatch('updateNavigationItems', navigationItemsFromLegacySettings(
          Object.fromEntries(userSettings.map(({ _id, value }) => [_id, value]))
        ))
      }

      const hasPlaylistThumbnailSize = userSettings.some(entry => entry._id === 'playlistThumbnailSize')
      // Playlists inherited the global size before their preference was split out.
      // Persist even the default so later global changes stay independent on restart.
      if (!hasPlaylistThumbnailSize) {
        await dispatch('updatePlaylistThumbnailSize', state.thumbnailSize)
      }

      const preferredCaptionLocaleEntry = userSettings.find(
        entry => entry._id === 'preferredCaptionLocale'
      )
      if (
        preferredCaptionLocaleEntry &&
        preferredCaptionLocaleEntry.value !== state.preferredCaptionLocale
      ) {
        await dispatch('updatePreferredCaptionLocale', preferredCaptionLocaleEntry.value)
      }

      const hasTabBarPosition = userSettings.some(entry => entry._id === 'tabBarPosition')
      const legacyVerticalTabBar = userSettings.find(entry => entry._id === 'useVerticalTabBar')
      if (!hasTabBarPosition && legacyVerticalTabBar?.value === true) {
        await dispatch('updateTabBarPosition', 'left')
      }

      if (state.landingPage === 'settings') {
        await dispatch('updateLandingPage', 'subscriptions')
      }

      const hasLandingPage = userSettings.some(entry => entry._id === 'landingPage')
      if (!hasLandingPage) {
        const profiles = await DBProfileHandlers.find()
        const isFreshInstallation = userSettings.length === 0 && profiles.length === 0
        const resolvedLandingPage = resolveDefaultLandingPage(isFreshInstallation)
        commit('setLandingPage', resolvedLandingPage)
        landingPageToInitialize = isFreshInstallation
          ? resolvedLandingPage
          : null
      }

      const keyboardShortcutsEntry = userSettings.find(entry => entry._id === 'keyboardShortcuts')
      if (keyboardShortcutsEntry) {
        const sanitizedShortcuts = sanitizeKeyboardShortcutOverrides(keyboardShortcutsEntry.value)
        if (sanitizedShortcuts !== keyboardShortcutsEntry.value) {
          await dispatch('updateKeyboardShortcuts', sanitizedShortcuts)
        }
      }

      const legacyAutoPipModeEntry = userSettings.find(entry => entry._id === 'autoPictureInPictureMode')
      const legacyAutoPipTabEntry = userSettings.find(entry => entry._id === 'autoPictureInPictureOnTabChange')
      const legacyDownloadsPlacementEntry = userSettings.find(
        entry => entry._id === 'moveDownloadsToQuickSettings'
      )
      const hasDownloadsHeaderPlacementSetting = userSettings.some(
        entry => entry._id === 'moveDownloadsToAppHeader'
      )
      const hasPipTriggersSetting = userSettings.some(entry => entry._id === 'autoPictureInPictureTriggers')
      const hasScrollPlayerSetting = userSettings.some(entry => entry._id === 'scrollPlayerMode')
      const legacyProgressToastEntry = userSettings.find(entry => entry._id === 'showSubscriptionRefreshToast')
      const hasProgressToastSetting = userSettings.some(entry => entry._id === 'showProgressBarToast')
      const legacyHideLiveChatEntry = userSettings.find(entry => entry._id === 'hideLiveChat')
      const hasHideLiveChatReplaySetting = userSettings.some(entry => entry._id === 'hideLiveChatReplay')
      const legacyHideAiVideoSummariesEntry = userSettings.find(
        entry => entry._id === 'hideAiVideoSummaries'
      )
      const hasAiVideoSummaryModeSetting = userSettings.some(
        entry => entry._id === 'aiVideoSummaryMode'
      )
      const legacyPlaybackSpeedSyncEntry = userSettings.find(
        entry => entry._id === 'syncServerSyncPlaybackSpeeds'
      )
      const hasMigratedChannelSettingsSync = userSettings.some(
        entry => entry._id === CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING
      )

      if (legacyDownloadsPlacementEntry && !hasDownloadsHeaderPlacementSetting) {
        await dispatch(
          'updateMoveDownloadsToAppHeader',
          legacyDownloadsPlacementEntry.value !== true
        )
      }

      if (!hasMigratedChannelSettingsSync) {
        try {
          if (legacyPlaybackSpeedSyncEntry?.value === false) {
            const excluded = Array.isArray(state.syncServerSettingsExcluded)
              ? state.syncServerSettingsExcluded
              : []
            await dispatch('updateSyncServerSettingsExcluded', Array.from(new Set([
              ...excluded,
              'channelPlaybackSpeeds',
            ])))
          }
          await DBSettingHandlers.upsert(CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING, true)
        } catch (error) {
          console.error('Failed to migrate saved channel settings sync', error)
        }
      }

      if (legacyProgressToastEntry && !hasProgressToastSetting) {
        await dispatch('updateShowProgressBarToast', legacyProgressToastEntry.value === true)
      }

      // Hide Live Chat covered both active chats and replays before the replay
      // preference was split out. Preserve that choice for existing profiles.
      if (legacyHideLiveChatEntry && !hasHideLiveChatReplaySetting) {
        await dispatch('updateHideLiveChatReplay', legacyHideLiveChatEntry.value === true)
      }

      // Auto Load Next Page used to control comments too, so they keep its value.
      // Saving it settles the choice, so a later change to Auto Load Next Page is
      // not copied. For sync, the copy keeps the edit time of Auto Load Next Page
      // instead of counting as a new edit, so a newer choice from another device wins.
      if (!userSettings.some(entry => entry._id === 'autoLoadComments')) {
        const autoLoadComments = userSettings.find(
          entry => entry._id === 'generalAutoLoadMorePaginatedItemsEnabled'
        )?.value !== false
        commit('setAutoLoadComments', autoLoadComments)
        await DBSettingHandlers.upsert('autoLoadComments', autoLoadComments)
        const editedAt = userSettings.find(entry => entry._id === 'syncServerSettingUpdatedAt')
          ?.value?.generalAutoLoadMorePaginatedItemsEnabled
        if (typeof editedAt === 'number') {
          await updateSettingSyncTimestamp(commit, 'autoLoadComments', () => editedAt)
        }
      }

      if (legacyHideAiVideoSummariesEntry) {
        if (!hasAiVideoSummaryModeSetting) {
          commit('setAiVideoSummaryMode', legacyHideAiVideoSummariesEntry.value === true ? 'hide' : 'collapsed')
        }
        try {
          await migrateStoredAiVideoSummarySetting({
            legacyValue: legacyHideAiVideoSummariesEntry.value,
            hasCurrentSetting: hasAiVideoSummaryModeSetting,
            saveCurrentSetting: async (value) => {
              await saveSettingEdit(commit, 'aiVideoSummaryMode', () => DBSettingHandlers.upsert('aiVideoSummaryMode', value))
              commit('setAiVideoSummaryMode', value)
            },
            deleteLegacySetting: () => DBSettingHandlers.delete('hideAiVideoSummaries'),
          })
        } catch (error) {
          console.error('Failed to migrate AI video summary visibility', error)
        }
      }

      // Migrate the legacy auto Picture-in-Picture setting to the combinable triggers array.
      // The old behavior fired on both in-app tab changes and window minimize, so preserve both.
      if (!hasPipTriggersSetting) {
        let tabChangeEnabled = null

        if (legacyAutoPipTabEntry) {
          tabChangeEnabled = legacyAutoPipTabEntry.value === true
        } else if (legacyAutoPipModeEntry) {
          tabChangeEnabled = legacyAutoPipModeEntry.value === 'tab' || legacyAutoPipModeEntry.value === 'both'
        }

        if (tabChangeEnabled !== null) {
          await dispatch('updateAutoPictureInPictureTriggers', tabChangeEnabled ? ['tab', 'minimize'] : [])
        }
      }

      if (legacyAutoPipModeEntry && !hasScrollPlayerSetting) {
        await dispatch('updateScrollPlayerMode', legacyAutoPipModeEntry.value === 'never' ? 'off' : 'mini')
      }

      // The chapters and screenshot buttons used to sit on the control bar
      // before its customizable buttons, so saved control bars from before they
      // were customizable keep them there.
      if (!userSettings.some(entry => entry._id === CONTROL_BAR_BUTTONS_MIGRATION_SETTING)) {
        try {
          const savedButtons = userSettings.find(entry => entry._id === 'controlBarButtons')?.value
          if (Array.isArray(savedButtons)) {
            const added = ['chapters', 'screenshot'].filter(id => !savedButtons.includes(id))
            // A failed save leaves the marker unset, so the next launch retries.
            if (added.length > 0 && !await dispatch('updateControlBarButtons', [...added, ...savedButtons])) {
              throw new Error('The control bar buttons were not saved')
            }
          }
          await DBSettingHandlers.upsert(CONTROL_BAR_BUTTONS_MIGRATION_SETTING, true)
        } catch (error) {
          console.error('Failed to migrate the saved control bar buttons', error)
        }
      }

      // Existing logged-in sync users keep sync enabled; everyone else starts off
      // so the default server is not contacted until the user opts in.
      const hasSyncServerEnabledSetting = userSettings.some(entry => entry._id === 'syncServerEnabled')
      if (!hasSyncServerEnabledSetting) {
        const token = typeof state.syncServerToken === 'string' ? state.syncServerToken : ''
        await dispatch('updateSyncServerEnabled', token !== '')
      }

      commit('setProfileSettingsList', profileSettings)
      if (startupProfile !== null) commit('applyProfileSettings', planProfileSettings(state, startupProfile))
      // Also without own settings, so the main process forgets those a
      // reloaded window showed before.
      reportProfileSettings(state)

      for (const _id of settingsWithSideEffects) {
        if (!alreadyTriggeredSideEffects.includes(_id)) {
          if (_id === 'iconPack') {
            applyIconPack(state[_id], Object.hasOwn(startupProfileSettings, 'iconPack') ? startupProfile : null)
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), state[_id])
            )
          }
        }
      }

      await Promise.allSettled(sideEffectPromises)
      await iconPackApplied
      return {
        hasExistingSettings: userSettings.some(({ _id }) => !TUTORIAL_STATE_SETTING_IDS.has(_id)),
        landingPageToInitialize,
        tutorialAudience: userSettings.find(({ _id }) => _id === TUTORIAL_AUDIENCE_SETTING_ID)?.value ?? null,
        lastUsedVersion: userSettings.find(({ _id }) => _id === LAST_USED_VERSION_SETTING_ID)?.value ?? null,
      }
    } catch (errMessage) {
      console.error(errMessage)
      // The renderer no longer preloads a default icon bundle before mounting.
      // Preserve usable fallback icons even when the settings datastore itself
      // cannot be read during startup.
      await sideEffectHandlers.iconPack(null, state.iconPack)
        .then(value => commit('setIconPack', value))
        .catch(console.error)
      return {
        hasExistingSettings: null,
        landingPageToInitialize: null,
        tutorialAudience: null,
        lastUsedVersion: null,
      }
    }
  },

  redirectHomeTabsToLandingPage: async ({ getters }) => {
    if (!process.env.IS_ELECTRON) { return }

    const landingRoute = { path: `/${getters.getLandingPage}` }
    const homeTabs = getters.getTabs.filter(tab => tab.route.path === '/home')
    const navigation = getTabNavigationService()
    await Promise.all(homeTabs.map(tab => navigation.replace(tab.id, landingRoute)))
  },

  // Separate, so the subscription cache sees subscriptions made in other
  // windows while the window starts before it drops unsubscribed channels.
  setupProfileListenerToSyncWindows: ({ commit }) => {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.handleSyncProfiles((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.CREATE:
            commit('addProfileToList', data)
            break

          case SyncEvents.GENERAL.UPSERT:
            commit('upsertProfileToList', data)
            break

          case SyncEvents.PROFILES.ADD_CHANNEL:
            commit('addChannelToProfiles', data)
            break

          case SyncEvents.PROFILES.REMOVE_CHANNEL:
            commit('removeChannelFromProfiles', data)
            break

          case SyncEvents.PROFILES.UPDATE_CHANNEL_SETTINGS:
            commit('updateChannelSettings', data)
            break

          case SyncEvents.PROFILES.UPDATE_SUBSCRIPTION_DETAILS:
            commit('updateSubscriptionDetails', data)
            break

          case SyncEvents.PROFILES.UPDATE_DETAILS:
            commit('updateProfileDetails', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeProfileFromList', data)
            break

          default:
            console.error('profiles: invalid sync event received')
        }
      })
    }
  },

  // Should be a root action, but we'll tolerate
  setupListenersToSyncWindows: ({ commit, dispatch }) => {
    if (process.env.IS_ELECTRON) {
      const applySavedSetting = (settingId, value) => {
        // Other windows can show another profile's seen marks.
        const seenMarks = shownSeenMarksSetting(settingId, getDataScope())
        if (seenMarks !== undefined) {
          if (seenMarks !== null) commit(defaultMutationId(seenMarks), value)
          return
        }
        const profileId = profileIdFromSettingsId(settingId)
        if (profileId !== null) {
          commit('setProfileOwnSettings', { profileId, settings: isPlainObject(value) ? value : null })
          return
        }
        // The active profile's own value keeps showing.
        const replaced = isSettingReplaced(settingId)
        if (settingsWithSideEffects.includes(settingId) && !replaced) {
          dispatch(defaultSideEffectsTriggerId(settingId), value)
        }

        commit(defaultMutationId(settingId), value)
        if (
          settingId === 'navigationItems' && !replaced &&
          !normalizeNavigationItems(value).includes('home')
        ) {
          dispatch('redirectHomeTabsToLandingPage').catch(error => {
            console.error('Failed to redirect Home tabs after syncing navigation items', error)
          })
        }
        if (settingId === 'syncServerEnabled') {
          dispatch('applySyncServerEnabled', value, { root: true })
        } else if (settingId === 'syncServerAutoSync') {
          dispatch(value ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync', null, { root: true })
        } else if (settingId === 'syncServerToken') {
          dispatch('applySyncServerToken', null, { root: true }).catch(error => {
            console.error('Failed to refresh sync after a token change in another window', error)
          })
        }
      }

      window.ftElectron.handleSyncSettings((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            // If this window is writing the setting too, either save can end
            // up last, so this window shows the saved value once its writes finish.
            settingWrites.savedElsewhere(data._id, saved => {
              if (saved !== undefined) applySavedSetting(data._id, saved)
            })
            applySavedSetting(data._id, data.value)
            break

          default:
            console.error('settings: invalid sync event received')
        }
      })

      // Other windows can show another profile's data.
      window.ftElectron.handleSyncHistory((event, data, scope) => {
        if (scope !== getDataScope()) return
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            commit('upsertToHistoryCache', data)
            break

          case SyncEvents.GENERAL.OVERWRITE: {
            const byId = {}
            data.forEach(video => {
              byId[video.videoId] = video
            })

            // It comes pre-sorted, so we don't have to sort it here
            commit('setHistoryCacheSorted', data)
            commit('setHistoryCacheById', byId)
            break
          }

          case SyncEvents.HISTORY.UPDATE_WATCH_PROGRESS:
            commit('updateRecordWatchProgressInHistoryCache', data)
            break

          case SyncEvents.HISTORY.UPDATE_PLAYLIST:
            commit('updateRecordLastViewedPlaylistIdInHistoryCache', data)
            break

          case SyncEvents.HISTORY.APPLY_SYNC_CHANGES:
            commit('applyHistorySyncChanges', data)
            break

          case SyncEvents.HISTORY.UNSET_PLAYLIST_FOR_VIDEOS:
            commit('unsetRecordsLastViewedPlaylistIdInHistoryCache', data)
            break

          case SyncEvents.HISTORY.UNSET_PLAYLISTS:
            commit('unsetRecordsLastViewedPlaylistIdsInHistoryCache', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeFromHistoryCacheById', data)
            break

          case SyncEvents.GENERAL.DELETE_MULTIPLE:
            commit('removeMultipleFromHistoryCache', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('setHistoryCacheSorted', [])
            commit('setHistoryCacheById', {})
            break

          default:
            console.error('history: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncWatchStats((event, data, scope) => {
        if (scope !== getDataScope()) return
        switch (event) {
          case SyncEvents.GENERAL.OVERWRITE:
            commit('setWatchStats', data.records)
            commit('setHasHistoricalWatchTimeEstimate', data.records.some(record => record.historyEstimateApplied === true))
            commit('setHistoricalWatchTimePlaybackSpeed', data.adjustment?.defaultSpeed ?? null)
            break
          case SyncEvents.WATCH_STATS.ADD_WATCH_TIME:
            commit('addWatchTime', data)
            break

          case SyncEvents.WATCH_STATS.ADJUST_HISTORICAL_WATCH_TIME:
            commit('setWatchStats', data.records)
            commit('setHistoricalWatchTimePlaybackSpeed', data.defaultSpeed)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('resetWatchStats', data)
            break

          default:
            console.error('watch stats: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncRecommendations(data => {
        if ((data?.scope ?? null) !== getDataScope()) return
        dispatch('receiveRecommendationUpdate', data).catch(error => console.error('Could not sync recommendation learning', error))
      })

      window.ftElectron.handleSyncSearchHistory((event, data, scope) => {
        if (scope !== getDataScope()) return
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            commit('upsertSearchHistoryEntryToList', data)
            break

          case SyncEvents.GENERAL.OVERWRITE:
            // It comes pre-sorted, so we don't have to sort it here
            commit('setSearchHistoryEntries', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removeSearchHistoryEntryFromList', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('setSearchHistoryEntries', [])
            break

          default:
            console.error('search history: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncPlaylists((event, data, scope) => {
        if (scope !== getDataScope()) return
        switch (event) {
          case SyncEvents.GENERAL.CREATE:
            commit('addPlaylists', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removePlaylist', data)
            break

          case SyncEvents.GENERAL.DELETE_MULTIPLE:
            commit('removePlaylists', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('removeAllPlaylists')
            break

          case SyncEvents.GENERAL.UPSERT:
            commit('upsertPlaylistToList', data)
            break

          case SyncEvents.PLAYLISTS.REPAIR_METADATA:
            commit('applyPlaylistMetadataRepairs', data)
            break

          case SyncEvents.PLAYLISTS.UPSERT_VIDEO:
            commit('addVideo', data)
            break

          case SyncEvents.PLAYLISTS.UPSERT_VIDEOS:
            commit('addVideos', data)
            break

          case SyncEvents.PLAYLISTS.DELETE_VIDEO:
            commit('removeVideo', data)
            break

          case SyncEvents.PLAYLISTS.DELETE_VIDEOS:
            commit('removeVideos', data)
            break

          case SyncEvents.PLAYLISTS.DELETE_ALL_VIDEOS:
            commit('removeAllVideos', data)
            break

          default:
            console.error('playlists: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncSubscriptionCache((event, data) => {
        switch (event) {
          case SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN:
            commit('markSubscriptionEntriesAsSeenInCache', [data])
            break

          case SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN_MANY:
            commit('markSubscriptionEntriesAsSeenInCache', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_FEEDS:
            for (const update of data) {
              commit(SUBSCRIPTION_FEED_CACHE_MUTATIONS[update.field], update)
            }
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_VIDEOS_BY_CHANNEL:
            commit('updateVideoCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_LIVE_STREAMS_BY_CHANNEL:
            commit('updateLiveCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_BY_CHANNEL:
            commit('updateShortsCacheByChannel', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_SHORTS_WITH_CHANNEL_PAGE_SHORTS_BY_CHANNEL:
            commit('updateShortsCacheWithChannelPageShorts', data)
            break

          case SyncEvents.SUBSCRIPTION_CACHE.UPDATE_COMMUNITY_POSTS_BY_CHANNEL:
            commit('updatePostsCacheByChannel', data)
            break

          case SyncEvents.GENERAL.DELETE_MULTIPLE:
            commit('clearCachesForManyChannels', data)
            break

          case SyncEvents.GENERAL.DELETE_ALL:
            commit('clearCaches', data)
            break

          default:
            console.error('subscription-cache: invalid sync event received')
        }
      })
    }
  }
}

/**********************/
/*
 * DO NOT TOUCH ANYTHING BELOW
 * (unless you plan to change the architecture of this module)
 */

const getters = {}
const mutations = {}
const actions = {}
const runSettingUpdate = createSettingUpdateQueue()
let pendingAutomaticDownloadRuleUpdate = Promise.resolve()

// Build default getters, mutations and actions for every setting id
for (const settingId of Object.keys(state)) {
  const getterId = defaultGetterId(settingId)
  const mutationId = defaultMutationId(settingId)
  const updaterId = defaultUpdaterId(settingId)
  // Resolves to whether the write was saved; superseded writes count as saved.
  const handleUpdateError = error => {
    console.error(error)
    if (['scheduledBackupEnabled', 'scheduledBackupInterval', 'scheduledBackupKeepCount'].includes(settingId)) throw error
    return false
  }

  getters[getterId] = (state) => state[settingId]
  // The shared value, see `assignSharedSetting`
  mutations[mutationId] = (state, value) => assignSharedSetting(state, settingId, value)

  if (settingsWithSideEffects.includes(settingId)) {
    const triggerId = defaultSideEffectsTriggerId(settingId)

    // If setting has side effects, generate action to handle them
    actions[triggerId] = sideEffectHandlers[settingId]

    actions[updaterId] = ({ commit, dispatch }, value) => {
      const target = settingTarget(settingId)
      if (target !== null) return updateProfileSetting(commit, target, settingId, value)
      return settingWrites.track(settingId, () => runSettingUpdate(settingId, async isLatest => {
        // Once its edit time is saved, the value must be saved too, even if a newer update replaced it.
        await saveSettingEdit(commit, settingId, () => DBSettingHandlers.upsert(settingId, value))

        if (!isLatest()) return
        // The active profile's own value keeps showing.
        if (!isSettingReplaced(settingId)) dispatch(triggerId, value)

        commit(mutationId, value)
      })).then(() => true, handleUpdateError)
    }
  } else {
    actions[updaterId] = ({ commit }, value) => {
      const target = settingTarget(settingId)
      if (target !== null) return updateProfileSetting(commit, target, settingId, value)
      return settingWrites.track(settingId, () => runSettingUpdate(settingId, async isLatest => {
        // Once its edit time is saved, the value must be saved too, even if a newer update replaced it.
        await saveSettingEdit(commit, settingId, () => DBSettingHandlers.upsert(settingId, value))

        if (isLatest()) commit(mutationId, value)
      })).then(() => true, handleUpdateError)
    }
  }
}

for (const settingId of Object.keys(DEFAULT_SETTINGS)) {
  const ownUpdater = Object.hasOwn(customActions, defaultUpdaterId(settingId))
  if (!SHARED_ONLY_SETTINGS.has(settingId) && (!ownUpdater || PROFILE_ROUTED_CUSTOM_SETTINGS.has(settingId))) {
    PROFILE_SPECIFIC_SETTINGS.add(settingId)
  }
}

// Older versions keep the credentials in the instance URL, and sync and
// export it that way. Save them as their own setting instead.
const saveDefaultInvidiousInstance = actions.updateDefaultInvidiousInstance
actions.updateDefaultInvidiousInstance = async (context, value) => {
  const { instance, credentials } = splitInvidiousInstanceCredentials(value)
  if (credentials && !await context.dispatch('updateInvidiousInstanceCredentials', credentials)) return false
  return saveDefaultInvidiousInstance(context, instance)
}

// Add all custom data/logic to their respective objects
Object.assign(state, customState)
Object.assign(getters, customGetters)
Object.assign(mutations, customMutations)
Object.assign(actions, customActions)

export default {
  state,
  getters,
  actions,
  mutations
}
