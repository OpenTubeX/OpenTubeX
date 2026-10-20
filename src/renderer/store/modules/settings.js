import { createDefaultSettings, resolveDefaultLandingPage } from '../../../settingsDefaults.js'
import { NON_TRANSFERABLE_SETTINGS } from '../../../nonTransferableSettings.js'
import { normalizeMaterialSeedColor } from '../../../materialTheme.js'
import i18n, { loadLocale, setAITranslationCompletionsEnabled } from '../../i18n/index'
import allLocales from '../../../../static/locales/activeLocales.json'
import { applyKeyboardShortcutOverrides, resolveLandingPage, sanitizeKeyboardShortcutOverrides, SyncEvents } from '../../../constants'
import { DBProfileHandlers, DBSettingHandlers } from '../../../datastores/handlers/index'
import { hashPassword } from '../../helpers/passwords'
import { ANDROID_PROXY_SETTING_KEYS, configureAndroidProxy, readAndroidProxySettings } from '../../helpers/androidProxy'
import { ensureAndroidLocalNetworkAccess } from '../../helpers/androidLocalNetwork'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { getSystemLocale, showToast } from '../../helpers/utils'
import { normalizeTabBarPosition } from '../../constants/tabBarPosition'
import { setReducedMotionPreference } from '../../helpers/reducedMotion'
import { setAnimationSpeed } from '../../helpers/animationSpeed'
import { normalizeYouTubeCaptionLanguageCode } from '../../helpers/player/youtubeCaptionLanguages'
import { currentIconPack, isIconPack, setIconPack } from '../../icons/iconPackState'
import { resolveBaseTheme, resolveSystemTheme } from '../../../appearanceSettings.js'
import { resolveColor } from '../../helpers/colors.js'
import { normalizeAppFont } from '../../helpers/appFont.js'
import {
  LAST_USED_VERSION_SETTING_ID,
  TUTORIAL_AUDIENCE_SETTING_ID,
} from '../../helpers/tutorialState.js'
import { terminateCommentTranslationLanguageDetector } from '../../helpers/comment-translations'
import { isSettingSyncableOnPlatform } from '../../helpers/platformSettings.js'
import { SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY } from '../../helpers/subscription-settings-sync'
import { CUSTOM_THEMES_SYNC_KEY } from '../../../customTheme.js'
import { normalizeQuickSettings } from '../../helpers/quickSettings.js'
import { normalizeFullscreenActions } from '../../helpers/fullscreenActions.js'
import { createOptimisticSettingUpdater, createSettingUpdateQueue } from '../../helpers/settingUpdateQueue.js'
import { mergeSubscriptionSeenVideos } from '../../../subscriptionSeenVideos.js'
import { mergeSubscriptionSeenPosts } from '../../../subscriptionSeenPosts.js'
import { filterAvailableNavigationItems } from '../../../navigationAvailability.js'
import { navigationItemsFromLegacySettings, normalizeNavigationItems } from '../../../navigationItems.js'
import { migrateStoredAiVideoSummarySetting, migrateSyncServerUrl } from '../../helpers/settings-migrations.js'
export { NON_TRANSFERABLE_SETTINGS } from '../../../nonTransferableSettings.js'

const CHANNEL_SETTINGS_SYNC_MIGRATION_SETTING = 'channelSettingsSyncMigration'
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

const sideEffectHandlers = {
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
      terminateCommentTranslationLanguageDetector()
    }
  },

  keyboardShortcuts: (_store, value) => {
    applyKeyboardShortcutOverrides(value)
  },

  reducedMotion: (store, value) => {
    setReducedMotionPreference(value)
  },

  animationSpeed: (_store, value) => {
    setAnimationSpeed(value)
  },

  currentLocale: async ({ dispatch }, value) => {
    const fallbackLocale = 'en-US'

    let targetLocale = value
    if (value === 'system') {
      const systemLocaleName = (await getSystemLocale()).replace('_', '-') // ex: en-US
      const systemLocaleSplit = systemLocaleName.split('-') // ex: en
      const targetLocaleOptions = allLocales.filter((locale) => {
        // filter out other languages
        const localeLang = locale.split('-')[0]
        return localeLang.includes(systemLocaleSplit[0])
      }).sort((aLocaleName, bLocaleName) => {
        const aLocale = aLocaleName.split('-') // ex: [en, US]
        const bLocale = bLocaleName.split('-')

        if (aLocaleName === systemLocaleName) { // country & language match, prefer a
          return -1
        } else if (bLocaleName === systemLocaleName) { // country & language match, prefer b
          return 1
        } else if (aLocale.length === 1) { // no country code for a, prefer a
          return -1
        } else if (bLocale.length === 1) { // no country code for b, prefer b
          return 1
        } else { // a & b have different country code from system, sort alphabetically
          return aLocaleName.localeCompare(bLocaleName)
        }
      })

      if (targetLocaleOptions.length > 0) {
        targetLocale = targetLocaleOptions[0]
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

    i18n.global.locale.value = targetLocale
    await dispatch('getRegionData', targetLocale)
  },

  defaultInvidiousInstance: ({ commit, rootState }, value) => {
    if (value !== '' && rootState.invidious.currentInvidiousInstance !== value) {
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
    if (await setIconPack(preferredPack)) {
      return preferredPack
    }

    const fallbackPack = preferredPack === 'material' ? 'remix' : 'material'
    if (await setIconPack(fallbackPack)) {
      return fallbackPack
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
  // These choices describe one physical device, not the user's account.
  'mobileAutoPictureInPicture',
  'capacitorLayoutMode',
  'alwaysShowMobileSearchBar',
  'continuePlaybackWhenScreenIsLocked',
  'uiScale',
  'verticalTabBarWidth',
])

export function isSettingSyncable(settingKey) {
  return settingKey === SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY ||
    (Object.prototype.hasOwnProperty.call(state, settingKey) &&
      !NON_SYNCABLE_SETTINGS.has(settingKey))
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
    !(settingKey === 'pinnedPlaylistIds' && !settings.syncServerSyncPlaylists) &&
    isSettingSyncableOnPlatform(settingKey)
  ))
}

let settingSyncTimestampWrite = Promise.resolve()

function recordSettingSyncTimestamp(commit, settings, settingId) {
  if (!isSettingSyncable(settingId) && settingId !== CUSTOM_THEMES_SYNC_KEY) return

  settingSyncTimestampWrite = settingSyncTimestampWrite.then(async () => {
    const current = settings.syncServerSettingUpdatedAt !== null &&
      typeof settings.syncServerSettingUpdatedAt === 'object' &&
      !Array.isArray(settings.syncServerSettingUpdatedAt)
      ? settings.syncServerSettingUpdatedAt
      : {}
    const updatedAt = {
      ...current,
      [settingId]: Date.now(),
    }
    await DBSettingHandlers.upsert('syncServerSettingUpdatedAt', updatedAt)
    commit('setSyncServerSettingUpdatedAt', updatedAt)
  }).catch(error => {
    console.error('Failed to record the setting sync timestamp', error)
  })

  return settingSyncTimestampWrite
}

const customState = {
}

const customGetters = {
  getEnableDownloads: (state) => state.enableDownloads,
  // A synchronized preference must not expose a service absent on this device.
  getUseVoiceOverTranslation: (state) => !process.env.IS_IOS && state.useVoiceOverTranslation,

  getFullscreenActions: (state) => normalizeFullscreenActions(state.fullscreenActions),
  getQuickSettings: (state) => normalizeQuickSettings(state.quickSettings),

  getNavigationItems: (state) => normalizeNavigationItems(state.navigationItems),

  getLandingPage: (state) => resolveLandingPage(
    state.landingPage,
    filterAvailableNavigationItems(normalizeNavigationItems(state.navigationItems), {
      supportsLocalApi: !!process.env.SUPPORTS_LOCAL_API,
      backendPreference: state.backendPreference,
      backendFallback: state.backendFallback,
      showWatchStats: state.rememberHistory && state.enableWatchStats,
    })
  ),

  getPlaylistBookmarks: (state) => {
    return Array.isArray(state.playlistBookmarks) ? state.playlistBookmarks : []
  },

  getPlaylistBookmark: (state) => (playlistId) => {
    if (!Array.isArray(state.playlistBookmarks)) return undefined
    return state.playlistBookmarks.find(bookmark => bookmark?.playlist?.id === playlistId)
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

  getTransferableSettings: (state) => {
    const transferableSettings = {}
    for (const [key, value] of Object.entries(state)) {
      if (!NON_TRANSFERABLE_SETTINGS.has(key)) {
        transferableSettings[key] = value
      }
    }
    return transferableSettings
  }
}

const customMutations = {
  setPreferredCaptionLocale: (state, value) => {
    state.preferredCaptionLocale = normalizeYouTubeCaptionLanguageCode(value)
  },
  setTabBarPosition: (state, value) => {
    state.tabBarPosition = normalizeTabBarPosition(value)
  }
}

async function updateValidatedSetting(commit, settings, settingId, value) {
  try {
    await DBSettingHandlers.upsert(settingId, value)
    await recordSettingSyncTimestamp(commit, settings, settingId)
    commit(defaultMutationId(settingId), value)
  } catch (error) {
    console.error(error)
  }
}

async function persistPlaylistBookmarks(commit, bookmarks) {
  try {
    await DBSettingHandlers.upsert('playlistBookmarks', bookmarks)
    commit('setPlaylistBookmarks', bookmarks)
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}

const updateOptimisticSetting = createOptimisticSettingUpdater()

function updateOrderedSetting(commit, settings, settingId, value) {
  return updateOptimisticSetting(settingId, value, {
    read: () => settings[settingId],
    commit: nextValue => commit(defaultMutationId(settingId), nextValue),
    persist: async nextValue => {
      await DBSettingHandlers.upsert(settingId, nextValue)
      await recordSettingSyncTimestamp(commit, settings, settingId)
    },
  }).then(() => true).catch(error => {
    console.error(error)
    return false
  })
}

let androidProxyUpdate = Promise.resolve()

const customActions = {
  async updateSyncServerActivityClearedThrough({ commit }, value) {
    const persist = async () => {
      const saved = await DBSettingHandlers.find()
      const cutoffs = { ...saved.find(setting => setting._id === 'syncServerActivityClearedThrough')?.value }
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
  async mergeSubscriptionSeenVideos({ dispatch }, update) {
    const saved = await DBSettingHandlers.mergeSeenVideos(update)
    await dispatch('applySubscriptionSeenVideos', saved)
  },
  async mergeSubscriptionSeenPosts({ dispatch }, update) {
    const saved = await DBSettingHandlers.mergeSeenPosts(update)
    await dispatch('applySubscriptionSeenPosts', saved)
  },
  applySubscriptionSeenPosts({ commit, state }, saved) {
    const value = JSON.stringify(mergeSubscriptionSeenPosts(state.subscriptionSeenPosts, saved))
    if (value !== state.subscriptionSeenPosts) commit('setSubscriptionSeenPosts', value)
  },
  applySubscriptionSeenVideos({ commit, state, rootGetters }, saved) {
    // Another window's newer update may arrive before this request's reply.
    const value = JSON.stringify(mergeSubscriptionSeenVideos(
      state.subscriptionSeenVideos, saved, rootGetters.getHistoryCacheById
    ))
    if (value !== state.subscriptionSeenVideos) commit('setSubscriptionSeenVideos', value)
  },
  recordSyncSettingEdit: ({ commit, state }, settingId) => (
    recordSettingSyncTimestamp(commit, state, settingId)
  ),
  updateFullscreenActions: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'fullscreenActions',
    normalizeFullscreenActions(value)
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

  // Pin toggles build on the previous edit, so commit them before the save finishes.
  updatePinnedPlaylistIds: ({ commit, state }, value) => updateOrderedSetting(commit, state, 'pinnedPlaylistIds', value),
  updatePinnedChannels: async ({ commit, state }, value) => {
    if (!await updateOrderedSetting(commit, state, 'pinnedChannels', value)) return false
    const pinnedIds = new Set(state.pinnedChannels.map(channel => channel.id))
    const entries = Object.entries(state.pinnedChannelMetadata)
    const retained = entries.filter(([id]) => pinnedIds.has(id))
    if (retained.length === entries.length) return true
    return updateOrderedSetting(commit, state, 'pinnedChannelMetadata', Object.fromEntries(retained))
  },
  refreshPinnedChannelMetadata: ({ commit, state }, { id, name, thumbnail }) => {
    const pin = state.pinnedChannels.find(channel => channel.id === id)
    if (!pin) return
    const previous = state.pinnedChannelMetadata[id] ?? pin
    const details = { name: name || previous.name, thumbnail: thumbnail || previous.thumbnail }
    if (details.name === previous.name && details.thumbnail === previous.thumbnail) return
    const metadata = Object.fromEntries(state.pinnedChannels
      .filter(channel => state.pinnedChannelMetadata[channel.id])
      .map(channel => [channel.id, state.pinnedChannelMetadata[channel.id]]))
    metadata[id] = details
    return updateOrderedSetting(commit, state, 'pinnedChannelMetadata', metadata)
  },

  // Home customization edits build on the previous edit, so commit them before the save finishes.
  updateHomeSectionLayout: ({ commit, state }, value) => updateOrderedSetting(
    commit,
    state,
    'homeSectionLayout',
    value
  ),

  updateYtDlpAutomaticDownloadRules: ({ commit, state }, update) => {
    // Capture authorization during the gesture, before earlier saves can delay this one.
    const persist = process.env.IS_ELECTRON
      ? window.ftElectron.prepareAutomaticDownloadRulesWrite()
      : value => DBSettingHandlers.upsert('ytDlpAutomaticDownloadRules', value)
    // Apply every mutation to saved rules so later edits preserve intervening cleanups.
    pendingAutomaticDownloadRuleUpdate = pendingAutomaticDownloadRuleUpdate.then(async () => {
      if (persist === null) throw new Error('Automatic download rules require a user action')
      const value = typeof update === 'function' ? update(state.ytDlpAutomaticDownloadRules) : update
      await persist(value)
      // Publish successful writes even if a later edit is queued and could fail.
      commit('setYtDlpAutomaticDownloadRules', value)
      await recordSettingSyncTimestamp(commit, state, 'ytDlpAutomaticDownloadRules')
    }).catch(error => console.error(error))
    return pendingAutomaticDownloadRuleUpdate
  },

  savePlaylistBookmark: async ({ commit, getters }, bookmark) => {
    const bookmarks = getters.getPlaylistBookmarks
      .filter(entry => entry?.playlist?.id !== bookmark.playlist.id)
    bookmarks.push(bookmark)

    return persistPlaylistBookmarks(commit, bookmarks)
  },

  removePlaylistBookmark: async ({ commit, getters }, playlistId) => {
    const bookmarks = getters.getPlaylistBookmarks
      .filter(bookmark => bookmark?.playlist?.id !== playlistId)

    return persistPlaylistBookmarks(commit, bookmarks)
  },

  replacePlaylistBookmarks: async ({ commit }, bookmarks) => {
    return persistPlaylistBookmarks(commit, bookmarks)
  },

  updatePreferredCaptionLocale: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'preferredCaptionLocale',
    normalizeYouTubeCaptionLanguageCode(value)
  ),

  updateAppFont: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'appFont',
    normalizeAppFont(value)
  ),

  updateMoveDownloadsToAppHeader: async ({ commit, state }, value) => {
    try {
      await DBSettingHandlers.upsert('moveDownloadsToAppHeader', value)
      await recordSettingSyncTimestamp(commit, state, 'moveDownloadsToAppHeader')
      commit('setMoveDownloadsToAppHeader', value)
      await DBSettingHandlers.delete('moveDownloadsToQuickSettings')
    } catch (error) {
      console.error(error)
    }
  },

  updateMaterialSeedColor: ({ commit, state }, value) => updateOrderedSetting(
    commit, state, 'materialSeedColor', normalizeMaterialSeedColor(value)
  ),

  updateBaseTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'baseTheme',
    resolveBaseTheme(value, 'system', rootGetters.getCustomThemes)
  ),

  updateSystemLightTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'systemLightTheme',
    resolveSystemTheme(value, 'light', rootGetters.getCustomThemes)
  ),

  updateSystemDarkTheme: ({ commit, rootGetters, state }, value) => updateValidatedSetting(
    commit,
    state,
    'systemDarkTheme',
    resolveSystemTheme(value, 'dark', rootGetters.getCustomThemes)
  ),

  updateMainColor: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'mainColor',
    resolveColor(value, 'Red')
  ),

  updateSecColor: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'secColor',
    resolveColor(value, 'Blue')
  ),

  updateTabBarPosition: ({ commit, state }, value) => updateValidatedSetting(
    commit,
    state,
    'tabBarPosition',
    normalizeTabBarPosition(value)
  ),

  updateIconPack: async ({ commit, state }, value) => {
    const previousIconPack = currentIconPack.value
    if (!isIconPack(value) || !await setIconPack(value)) {
      return false
    }

    try {
      await DBSettingHandlers.upsert('iconPack', value)
      await recordSettingSyncTimestamp(commit, state, 'iconPack')
      commit('setIconPack', value)
      return true
    } catch (error) {
      if (isIconPack(previousIconPack)) {
        await setIconPack(previousIconPack)
      }
      console.error(error)
      return false
    }
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
        if (settingsWithSideEffects.includes(_id)) {
          if (_id === 'iconPack') {
            resolvedValue = await dispatch(defaultSideEffectsTriggerId(_id), value)
            if (resolvedValue !== value) {
              await DBSettingHandlers.upsert(_id, resolvedValue)
            }
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), value)
            )
          }
          alreadyTriggeredSideEffects.push(_id)
        }

        if (mutationIds.includes(defaultMutationId(_id))) {
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
      const hasScrollMiniSetting = userSettings.some(entry => entry._id === 'scrollMiniPlayerEnabled')
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

      if (legacyHideAiVideoSummariesEntry) {
        if (!hasAiVideoSummaryModeSetting) {
          commit('setAiVideoSummaryMode', legacyHideAiVideoSummariesEntry.value === true ? 'hide' : 'collapsed')
        }
        try {
          await migrateStoredAiVideoSummarySetting({
            legacyValue: legacyHideAiVideoSummariesEntry.value,
            hasCurrentSetting: hasAiVideoSummaryModeSetting,
            saveCurrentSetting: async (value) => {
              await DBSettingHandlers.upsert('aiVideoSummaryMode', value)
              await recordSettingSyncTimestamp(commit, state, 'aiVideoSummaryMode')
              commit('setAiVideoSummaryMode', value)
            },
            deleteLegacySetting: () => DBSettingHandlers.delete('hideAiVideoSummaries'),
          })
        } catch (error) {
          console.error('Failed to migrate AI video summary visibility', error)
        }
      } else if (!hasAiVideoSummaryModeSetting) {
        // Only fresh installations receive the new default. Persist it so
        // their next startup does not mistake them for an existing installation.
        const hasExistingSettings = userSettings.some(({ _id }) => !TUTORIAL_STATE_SETTING_IDS.has(_id))
        const isFreshInstallation = !hasExistingSettings && (await DBProfileHandlers.find()).length === 0
        const mode = isFreshInstallation ? 'collapsed' : 'hide'
        commit('setAiVideoSummaryMode', mode)
        await dispatch('updateAiVideoSummaryMode', mode)
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

      if (legacyAutoPipModeEntry && !hasScrollMiniSetting) {
        await dispatch('updateScrollMiniPlayerEnabled', legacyAutoPipModeEntry.value !== 'never')
      }

      // Existing logged-in sync users keep sync enabled; everyone else starts off
      // so the default server is not contacted until the user opts in.
      const hasSyncServerEnabledSetting = userSettings.some(entry => entry._id === 'syncServerEnabled')
      if (!hasSyncServerEnabledSetting) {
        const token = typeof state.syncServerToken === 'string' ? state.syncServerToken : ''
        await dispatch('updateSyncServerEnabled', token !== '')
      }

      for (const _id of settingsWithSideEffects) {
        if (!alreadyTriggeredSideEffects.includes(_id)) {
          if (_id === 'iconPack') {
            const value = state[_id]
            const resolvedValue = await dispatch(defaultSideEffectsTriggerId(_id), value)
            if (resolvedValue !== value) {
              await DBSettingHandlers.upsert(_id, resolvedValue)
              commit(defaultMutationId(_id), resolvedValue)
            }
          } else {
            sideEffectPromises.push(
              dispatch(defaultSideEffectsTriggerId(_id), state[_id])
            )
          }
        }
      }

      await Promise.allSettled(sideEffectPromises)
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

  // Should be a root action, but we'll tolerate
  setupListenersToSyncWindows: ({ commit, dispatch }) => {
    if (process.env.IS_ELECTRON) {
      window.ftElectron.handleSyncSettings((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.UPSERT:
            if (settingsWithSideEffects.includes(data._id)) {
              dispatch(defaultSideEffectsTriggerId(data._id), data.value)
            }

            commit(defaultMutationId(data._id), data.value)
            if (
              data._id === 'navigationItems' &&
              !normalizeNavigationItems(data.value).includes('home')
            ) {
              dispatch('redirectHomeTabsToLandingPage').catch(error => {
                console.error('Failed to redirect Home tabs after syncing navigation items', error)
              })
            }
            if (data._id === 'syncServerEnabled') {
              dispatch('applySyncServerEnabled', data.value, { root: true })
            } else if (data._id === 'syncServerAutoSync') {
              dispatch(data.value ? 'startSyncServerAutoSync' : 'stopSyncServerAutoSync', null, { root: true })
            } else if (data._id === 'syncServerToken') {
              dispatch('applySyncServerToken', null, { root: true }).catch(error => {
                console.error('Failed to refresh sync after a token change in another window', error)
              })
            }
            break

          default:
            console.error('settings: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncHistory((event, data) => {
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

      window.ftElectron.handleSyncWatchStats((event, data) => {
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
            commit('resetWatchStats')
            break

          default:
            console.error('watch stats: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncRecommendations(data => {
        dispatch('receiveRecommendationUpdate', data).catch(error => console.error('Could not sync recommendation learning', error))
      })

      window.ftElectron.handleSyncSearchHistory((event, data) => {
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

          case SyncEvents.GENERAL.DELETE:
            commit('removeProfileFromList', data)
            break

          default:
            console.error('profiles: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncPlaylists((event, data) => {
        switch (event) {
          case SyncEvents.GENERAL.CREATE:
            commit('addPlaylists', data)
            break

          case SyncEvents.GENERAL.DELETE:
            commit('removePlaylist', data)
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

          default:
            console.error('playlists: invalid sync event received')
        }
      })

      window.ftElectron.handleSyncSubscriptionCache((event, data) => {
        switch (event) {
          case SyncEvents.SUBSCRIPTION_CACHE.MARK_ENTRIES_AS_SEEN:
            commit('markSubscriptionEntriesAsSeenInCache', [data])
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
  const handleUpdateError = error => {
    console.error(error)
    if (['scheduledBackupEnabled', 'scheduledBackupInterval', 'scheduledBackupKeepCount'].includes(settingId)) throw error
  }

  getters[getterId] = (state) => state[settingId]
  mutations[mutationId] = (state, value) => { state[settingId] = value }

  if (settingsWithSideEffects.includes(settingId)) {
    const triggerId = defaultSideEffectsTriggerId(settingId)

    // If setting has side effects, generate action to handle them
    actions[triggerId] = sideEffectHandlers[settingId]

    actions[updaterId] = ({ commit, dispatch, state }, value) => (
      runSettingUpdate(settingId, async isLatest => {
        await DBSettingHandlers.upsert(settingId, value)

        if (!isLatest()) return
        await recordSettingSyncTimestamp(commit, state, settingId)

        if (!isLatest()) return
        dispatch(triggerId, value)

        commit(mutationId, value)
      }).catch(handleUpdateError)
    )
  } else {
    actions[updaterId] = ({ commit, state }, value) => (
      runSettingUpdate(settingId, async isLatest => {
        await DBSettingHandlers.upsert(settingId, value)

        if (!isLatest()) return
        await recordSettingSyncTimestamp(commit, state, settingId)

        if (isLatest()) commit(mutationId, value)
      }).catch(handleUpdateError)
    )
  }
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
