import {
  DEFAULT_LANDING_PAGE,
  LEGACY_DEFAULT_LANDING_PAGE,
  resolveLandingPage,
} from '../../constants.js'
import {
  navigationItemsFromLegacySettings,
  normalizeNavigationItems,
} from '../../navigationItems.js'
import { filterAvailableNavigationItems } from '../../navigationAvailability.js'
import * as baseHandlers from '../../datastores/handlers/base.js'
import { canHaveOwnSettings, isPlainObject, profileSettingsId } from '../../profileSettings.js'
import { normalizeRoutePath } from './tabRoutes.js'

export const DEFAULT_NEW_TAB_POSITION = 'afterCurrentInOrder'
const VALID_NEW_TAB_POSITIONS = new Set(['end', 'afterCurrent', 'afterCurrentInOrder'])
const DEFAULT_TAB_CLOSE_FOCUS = 'lastActiveTab'
const VALID_TAB_CLOSE_FOCUS = new Set(['lastActiveTab', 'previousTab', 'nextTab'])
// Closing a tab has to pick the replacement synchronously, so the preference is
// cached here instead of being read from the settings store on every close.
let tabCloseFocus = DEFAULT_TAB_CLOSE_FOCUS
// Tab creation is also synchronous after its placement preferences have loaded.
// Cache whether silence skipping should start enabled for newly-created tabs.
let enableSkipSilenceByDefault = false
let showSkipSilenceButton = false

/**
 * @param {unknown} value
 * @returns {'end' | 'afterCurrent' | 'afterCurrentInOrder'}
 */
export function normalizeNewTabPosition(value) {
  return VALID_NEW_TAB_POSITIONS.has(value)
    ? value
    : DEFAULT_NEW_TAB_POSITION
}

/**
 * @param {unknown} value
 * @returns {'lastActiveTab' | 'previousTab' | 'nextTab'}
 */
export function normalizeTabCloseFocus(value) {
  return VALID_TAB_CLOSE_FOCUS.has(value)
    ? value
    : DEFAULT_TAB_CLOSE_FOCUS
}

/**
 * @param {unknown} value
 */
export function setTabCloseFocus(value) {
  tabCloseFocus = normalizeTabCloseFocus(value)
}

/**
 * @returns {'lastActiveTab' | 'previousTab' | 'nextTab'}
 */
export function getTabCloseFocus() {
  return tabCloseFocus
}

/**
 * @returns {Promise<void>}
 */
export async function refreshStoredTabCloseFocus() {
  try {
    setTabCloseFocus((await baseHandlers.settings._findOne('tabCloseFocus'))?.value)
  } catch (error) {
    console.error('Failed to load tab close focus preference:', error)
  }
}

/**
 * @param {unknown} value
 */
export function setEnableSkipSilenceByDefault(value) {
  enableSkipSilenceByDefault = value === true
}

/**
 * @param {unknown} value
 */
export function setShowSkipSilenceButton(value) {
  showSkipSilenceButton = value === true
}

/**
 * @returns {boolean} whether newly-created tabs start with silence skipping enabled
 */
export function getNewTabSkipSilence() {
  return showSkipSilenceButton && enableSkipSilenceByDefault
}

/**
 * @returns {Promise<void>}
 */
export async function refreshStoredSkipSilenceSettings() {
  try {
    const [showButtonSetting, defaultSetting] = await Promise.all([
      baseHandlers.settings._findOne('showSkipSilenceButton'),
      baseHandlers.settings._findOne('enableSkipSilenceByDefault')
    ])
    setShowSkipSilenceButton(showButtonSetting?.value)
    setEnableSkipSilenceByDefault(defaultSetting?.value)
  } catch (error) {
    console.error('Failed to load skip silence preferences:', error)
  }
}

/**
 * @returns {Promise<'end' | 'afterCurrent' | 'afterCurrentInOrder'>}
 */
export async function getStoredNewTabPosition() {
  try {
    const value = (await baseHandlers.settings._findOne('newTabPosition'))?.value
    return normalizeNewTabPosition(value)
  } catch (error) {
    console.error('Failed to load new tab position preference:', error)
    return DEFAULT_NEW_TAB_POSITION
  }
}

/**
 * The own settings of the profile a window shows when it opens, its default
 * profile, until its renderer reports the active profile's.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getStoredStartupProfileSettings() {
  try {
    const defaultProfile = (await baseHandlers.settings._findOne('defaultProfile'))?.value
    if (!canHaveOwnSettings(defaultProfile)) return {}
    const settings = (await baseHandlers.settings._findOne(profileSettingsId(defaultProfile)))?.value
    return isPlainObject(settings) ? settings : {}
  } catch (error) {
    console.error('Failed to load the default profile\'s own settings:', error)
    return {}
  }
}

/**
 * @param {Record<string, unknown>} [profileSettings] the own settings of the
 *   window's active profile, which replace the saved ones
 * @returns {Promise<string>}
 */
export async function getStoredLandingRoute(profileSettings = {}) {
  /** @param {string} settingId */
  const findSetting = settingId => Object.hasOwn(profileSettings, settingId)
    ? { value: profileSettings[settingId] }
    : baseHandlers.settings._findOne(settingId)
  try {
    const [
      landingPageSetting,
      navigationItemsSetting,
      hideHomeSetting,
      hidePlaylistsSetting,
      hidePopularVideosSetting,
      hideTrendingVideosSetting,
      backendPreferenceSetting,
      backendFallbackSetting,
      rememberHistorySetting,
      enableWatchStatsSetting,
      enableTwitchPageSetting,
    ] = await Promise.all([
      findSetting('landingPage'),
      findSetting('navigationItems'),
      findSetting('hideHome'),
      findSetting('hidePlaylists'),
      findSetting('hidePopularVideos'),
      findSetting('hideTrendingVideos'),
      findSetting('backendPreference'),
      findSetting('backendFallback'),
      findSetting('rememberHistory'),
      findSetting('enableWatchStats'),
      findSetting('enableTwitchPage'),
    ])

    let landingPage = landingPageSetting?.value
    if (typeof landingPage !== 'string' || landingPage.length === 0) {
      const [settings, profiles] = await Promise.all([
        baseHandlers.settings.find(),
        baseHandlers.profiles.find(),
      ])
      landingPage = settings.length > 0 || profiles.length > 0
        ? LEGACY_DEFAULT_LANDING_PAGE
        : DEFAULT_LANDING_PAGE
    }

    const configuredPages = navigationItemsSetting == null
      ? navigationItemsFromLegacySettings({
          hideHome: hideHomeSetting?.value,
          hidePlaylists: hidePlaylistsSetting?.value,
          hidePopularVideos: hidePopularVideosSetting?.value,
          hideTrendingVideos: hideTrendingVideosSetting?.value,
        })
      : normalizeNavigationItems(navigationItemsSetting.value)
    const supportsLocalApi = !!process.env.SUPPORTS_LOCAL_API
    const availablePages = filterAvailableNavigationItems(configuredPages, {
      supportsLocalApi,
      backendPreference: backendPreferenceSetting?.value ?? (supportsLocalApi ? 'local' : 'invidious'),
      backendFallback: backendFallbackSetting?.value === true,
      showWatchStats: (rememberHistorySetting?.value ?? true) &&
        (enableWatchStatsSetting?.value ?? true),
      // Electron always has yt-dlp
      supportsYtDlp: true,
      enableTwitchPage: enableTwitchPageSetting?.value ?? true,
    })

    return normalizeRoutePath(resolveLandingPage(landingPage, availablePages))
  } catch (error) {
    console.error('Failed to load landing page preference:', error)
    return `/${LEGACY_DEFAULT_LANDING_PAGE}`
  }
}

/**
 * @returns {Promise<boolean>} whether closing every tab of a window also closes the window
 */
export async function getStoredCloseWindowWithLastTab() {
  try {
    return (await baseHandlers.settings._findOne('closeWindowWithLastTab'))?.value !== false
  } catch (error) {
    console.error('Failed to load last tab close preference:', error)
    return true
  }
}

/**
 * @returns {Promise<boolean>}
 */
export async function getStoredRememberTabNavigationHistory() {
  try {
    return (await baseHandlers.settings._findOne('rememberTabNavigationHistory'))?.value === true
  } catch (error) {
    console.error('Failed to load tab navigation history preference:', error)
    return false
  }
}
