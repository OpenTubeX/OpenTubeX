import { customThemeIdFromValue } from '../../customTheme.js'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
  SETTINGS_SEARCH_SOURCES,
} from './settings-search-config.js'

const NON_SETTING_MESSAGE_KEY_PATTERN = /(?:^Are you sure\b|^Failed to\b|^Invalid\b|^No\b|^How\b|^Checking\b|^Downloading\b|^Loading\b|^Loaded\b|^Current .+\b(?:has|is|will)\b|\b(?:has|have) been (?:cleared|removed|saved|updated)\b|^Operation in Progress$|(?:Description|Hint|Tooltip|Placeholder|Template|Warning|Error|Status|Message|Not Downloaded|Unavailable|Connected|Connecting|Success|Failed|Failure|Invalid|Saved|Copied|Already Exists)$)/i

/**
 * Builds the localized setting labels used by both Settings search and the
 * command palette. Visibility follows the controls currently rendered by the
 * active settings state.
 * @param {object} options
 * @returns {Map<string, string[]>}
 */
export function createSettingsSearchIndex(options) {
  const {
    sections,
    tm,
  } = options
  const extraValues = {
    privacy: flattenSettingsSearchMessageValues(
      tm('Settings.Password Settings'),
      {},
      [],
      (path, value) => isSearchableSettingsMessage('password', path, value, options)
    )
  }

  return new Map(sections.map((section) => {
    const sources = SETTINGS_SEARCH_SOURCES[section.type] ?? []
    const values = [...new Set([
      section.title,
      section.description,
      ...sources.flatMap(source => getSettingsSearchSourceValues(source, options)),
      ...(extraValues[section.type] ?? [])
    ])]
    return [section.type, values]
  }))
}

export function findSettingsSearchTab(sectionType, label, options) {
  const normalizedLabel = normalizeSettingsSearchText(label, options.locale)
  return SETTINGS_SEARCH_SOURCES[sectionType]?.find(source => (
    source.tab !== undefined &&
    getSettingsSearchSourceValues(source, options)
      .some(value => normalizeSettingsSearchText(value, options.locale) === normalizedLabel)
  ))?.tab
}

function getSettingsSearchSourceValues(source, options) {
  if (source.electronOnly && !options.usingElectron) return []
  return flattenSettingsSearchMessageValues(
    options.tm(source.key),
    SETTINGS_SEARCH_SELECT_GROUP_LABELS[source.type],
    [],
    (path, value) => (
      (source.include === undefined || source.include.has(path[0])) &&
      (source.exclude === undefined || !source.exclude.has(path[0])) &&
      isSearchableSettingsMessage(source.type, path, value, options)
    )
  )
}

function isSearchableSettingsMessage(sectionType, path, value, options) {
  if (/\{[^{}]+\}/.test(value)) return false
  const messagePath = path.join('.')
  const messageKey = path.at(-1) ?? ''
  return !SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[sectionType]?.has(messagePath) &&
    !NON_SETTING_MESSAGE_KEY_PATTERN.test(messageKey) &&
    isSettingsSearchMessageVisible(sectionType, path, options)
}

function isSettingsSearchMessageVisible(sectionType, path, options) {
  const {
    store,
    usingElectron,
    supportsLocalApi,
    isMac,
    isLinuxWayland,
    systemUsesDarkTheme,
  } = options
  const [group, item] = path

  if (sectionType === 'player' && group === 'Screenshot') {
    if (item === 'Enable') return true
    if (!store.getters.getEnableScreenshot) return false
    if (item === 'Mode') return true
    if (['Format Label', 'Quality Label', 'File Name Label'].includes(item)) {
      return store.getters.getScreenshotMode !== 'clipboard'
    }
    if (['Folder Label', 'Folder Button'].includes(item)) {
      return usingElectron && store.getters.getScreenshotMode === 'default_folder'
    }
    return false
  }

  if (sectionType === 'caption-appearance' && group === 'Edge Color') {
    return getCaptionEdgeStyle(store) !== 'none'
  }

  if (sectionType === 'general' && [
    'Current Invidious Instance',
    'View all Invidious instance information',
    'Set Current Instance as Default',
    'Clear Default Instance'
  ].includes(group)) {
    return store.getters.getBackendPreference === 'invidious' ||
      store.getters.getBackendFallback
  }

  if (sectionType === 'general') {
    if (group === 'Minimize to system tray') {
      return usingElectron && !isMac && !isLinuxWayland
    }
    if ([
      'Open Deep Links In New Window',
      'New Tab Position',
      'Tab Close Focus',
      'Startup Behavior',
      'Confirm Before',
      'Confirmation Options',
      'Stream Extraction Method'
    ].includes(group)) {
      return usingElectron
    }
    if (group === 'Fallback to Non-Preferred Backend on Failure') {
      return supportsLocalApi
    }
    if (group === 'Avoid translation') {
      return supportsLocalApi && (
        store.getters.getBackendPreference === 'local' || store.getters.getBackendFallback
      )
    }
  }

  if (sectionType === 'sync') {
    if (['Sync Settings', 'Enable Sync'].includes(group)) return true
    if (!store.getters.getSyncServerEnabled) return false
    const connected = store.getters.getSyncServerToken !== ''
    if (['Password', 'Privacy Passphrase', 'Log In', 'Register'].includes(group)) {
      return !connected
    }
    if ([
      'Automatic Sync',
      'Profiles',
      'Settings',
      'Sync Now',
      'Disconnect',
      'Delete Account'
    ].includes(group)) {
      return connected
    }
    if (group === 'Open Tabs') {
      return connected && usingElectron && store.getters.getSyncServerPrivacyMode === 'enhanced'
    }
    return true
  }

  if (sectionType === 'external-player' && [
    'Custom External Player Executable',
    'Custom External Player Arguments'
  ].includes(group)) {
    return store.getters.getExternalPlayer !== ''
  }

  if (sectionType === 'sponsor-block') {
    const useSponsorBlock = store.getters.getUseSponsorBlock
    const useDeArrowTitles = store.getters.getUseDeArrowTitles
    const useDeArrowThumbnails = store.getters.getUseDeArrowThumbnails
    if (group === 'SponsorBlock API Url (Default is https://sponsor.ajay.app)') {
      return useSponsorBlock || useDeArrowTitles || useDeArrowThumbnails
    }
    if ([
      'Enable SponsorBlock Submission',
      'Notify when sponsor segment is skipped',
      'Skip notification timeout',
      'Skip Options',
      'Category Color'
    ].includes(group)) {
      return useSponsorBlock
    }
    if (group === 'SponsorBlock Private User ID (optional)') {
      return useSponsorBlock && store.getters.getSponsorBlockEnableSubmission
    }
    if (group === 'Generated SponsorBlock User ID') return false
    if (group === 'Export Generated User ID') {
      return useSponsorBlock && store.getters.getSponsorBlockEnableSubmission &&
        store.getters.getSponsorBlockGeneratedUserId !== ''
    }
    if (group === 'DeArrow Thumbnail Generator API Url (Default is https://dearrow-thumb.ajay.app)') {
      return useDeArrowThumbnails
    }
  }

  if (sectionType === 'return-youtube-dislike' && group === 'Return YouTube Dislike Url') {
    return store.getters.getUseReturnYouTubeDislikes
  }

  if (sectionType === 'proxy') {
    if ([
      'Proxy Settings',
      'Enable Tor / Proxy',
      'IP Block Recovery Script Path'
    ].includes(group)) {
      return true
    }
    if (['Proxy Username', 'Proxy Password'].includes(group)) {
      return store.getters.getUseProxy &&
        ['http', 'https'].includes(store.getters.getProxyProtocol)
    }
    return store.getters.getUseProxy && [
      'Proxy Protocol',
      'Proxy Host',
      'Proxy Port Number',
      'Test Proxy'
    ].includes(group)
  }

  if (sectionType === 'download') {
    return ['Download Settings', 'Enable Downloads'].includes(group) ||
      store.getters.getEnableDownloads
  }

  if (sectionType === 'external-software') {
    if (group === 'yt-dlp Channel') return store.getters.getYtDlpSource === 'managed'
    if (group === 'Managed Tool Updates') {
      return store.getters.getYtDlpSource === 'managed' ||
        store.getters.getYtDlpFfmpegSource === 'managed'
    }
    if (group === 'yt-dlp Executable Path') return store.getters.getYtDlpSource === 'system'
    if (group === 'FFmpeg Executable Path') return store.getters.getYtDlpFfmpegSource === 'system'
    if (group === 'Cookie File') return store.getters.getYtDlpPlaybackAuthMode === 'file'
    if (group === 'Browser for Cookies' || group === 'Browser Profile') {
      return store.getters.getYtDlpPlaybackAuthMode === 'browser'
    }
  }

  if (sectionType === 'channel') {
    if (group === 'Auto Update') {
      return store.getters.getRememberPlaybackSpeedPerChannel ||
        store.getters.getRememberVideoQualityPerChannel
    }
    if (group === 'Auto Update Subtitles') {
      return store.getters.getRememberSubtitlesStatePerChannel
    }
    if (group === 'Auto Update Volume') {
      return store.getters.getRememberVolumePerChannel
    }
    return [
      'Channel Settings',
      'Enable Playback Speed',
      'Enable Video Quality',
      'Enable Subtitles State',
      'Enable Volume'
    ].includes(group)
  }

  if (sectionType === 'distraction') {
    if (group === 'Show Added Items') {
      return store.getters.getChannelsHiddenParsed.length > 0 ||
        store.getters.getForbiddenTitlesParsed.length > 0
    }
    if (group === 'Hide Trending Videos') return supportsLocalApi
  }

  if (sectionType === 'theme') {
    if (group === 'Custom Theme' && item === 'Edit Custom Theme') {
      const baseTheme = store.getters.getBaseTheme
      const selectedTheme = baseTheme === 'system'
        ? (systemUsesDarkTheme
            ? store.getters.getSystemDarkTheme
            : store.getters.getSystemLightTheme)
        : baseTheme
      return customThemeIdFromValue(selectedTheme) !== null
    }
    if (group === 'Light Theme' || group === 'Dark Theme') {
      return store.getters.getBaseTheme === 'system'
    }
    if ([
      'Move Downloads to App Header',
      'Disable Smooth Scrolling',
      'Use Fixed Tab Width',
      'Move Settings to App Header',
      'Show Tab Icons',
      'Show Tab Previews',
      'Tab Layout',
      'Tab Width',
      'Load Missing Tab Icons',
      'UI Scale'
    ].includes(group)) {
      return usingElectron && (
        group !== 'Load Missing Tab Icons' || store.getters.getShowTabIcons
      )
    }
  }

  if (sectionType === 'password') {
    const hasStoredPassword = store.getters.getSettingsPassword !== ''
    if (group === 'Remove Password') return hasStoredPassword
    if (['Set Password To Prevent Access', 'Set Password'].includes(group)) {
      return !hasStoredPassword
    }
  }

  return true
}

function getCaptionEdgeStyle(store) {
  const value = store.getters.getDefaultCaptionSettings
  if (value !== null && typeof value === 'object') return value.edgeStyle ?? 'none'
  try {
    return JSON.parse(value).edgeStyle ?? 'none'
  } catch {
    return 'none'
  }
}

export function flattenSettingsSearchMessageValues(
  value,
  selectGroups = {},
  path = [],
  include = () => true
) {
  if (typeof value === 'string') return include(path, value) ? [value] : []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenSettingsSearchMessageValues(
      item,
      selectGroups,
      [...path, index.toString()],
      include
    ))
  }
  if (value !== null && typeof value === 'object') {
    const retainedKeys = selectGroups[path.join('.')]
    return Object.entries(value)
      .filter(([key]) => retainedKeys === undefined || retainedKeys.includes(key))
      .flatMap(([key, childValue]) => flattenSettingsSearchMessageValues(
        childValue,
        selectGroups,
        [...path, key],
        include
      ))
  }
  return []
}

export function removeRedundantSettingsSearchMatches(values, locale) {
  const keptMatches = []
  const normalizedMatches = []
  for (const value of values.toSorted((a, b) => a.length - b.length)) {
    const normalizedValue = normalizeSettingsSearchText(value, locale)
    if (normalizedMatches.some(shorterValue => normalizedValue.includes(shorterValue))) continue
    keptMatches.push(value)
    normalizedMatches.push(normalizedValue)
  }
  return keptMatches
}

export function normalizeSettingsSearchText(value, locale) {
  return value.toLocaleLowerCase(locale).normalize('NFKD').replaceAll(/\s+/g, ' ').trim()
}
