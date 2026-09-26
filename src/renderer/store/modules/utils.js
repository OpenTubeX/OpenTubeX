import { nextTick } from 'vue'

import i18n from '../../i18n/index'

import { checkYoutubeChannelId } from '../../helpers/channels'
import { parseYoutubeUrlInfo } from '../../helpers/youtubeUrlInfo.js'
import { commitCustomThemesEdit } from '../../helpers/customThemeSync.js'
import {
  createWebURL,
  getVideoParamsFromUrl,
  replaceFilenameForbiddenChars,
  searchFiltersMatch,
} from '../../helpers/utils'
import {
  loadLegacyChannelThumbnailCache,
  loadLegacyVideoAvatarCache,
} from '../../helpers/channelThumbnailStorage'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import {
  mergeYouTubeCaptionLanguageCodes,
  YOUTUBE_CAPTION_LANGUAGE_CODES,
} from '../../helpers/player/youtubeCaptionLanguages'

const CHANNEL_THUMBNAIL_CACHE_LIMIT = 200
const VIDEO_AVATAR_CACHE_LIMIT = 200

async function morphSettingsWindow(commit, update) {
  commit('setSettingsWindowMorphing', true)
  await nextTick()

  const root = document.documentElement
  root.classList.add('utilityWindowMorphActive')

  try {
    if (typeof document.startViewTransition !== 'function' || isReducedMotionEnabled()) {
      update()
      await nextTick()
      return
    }

    const transition = document.startViewTransition(async () => {
      update()
      await nextTick()
    })
    await transition.finished.catch(() => {})
  } finally {
    root.classList.remove('utilityWindowMorphActive')
    commit('setSettingsWindowMorphing', false)
  }
}

function getOrCreateSearchSettings(state, tabId) {
  state.searchSettingsByTabId[tabId] ??= {
    prioritize: 'relevance',
    time: '',
    type: 'all',
    duration: '',
    features: [],
  }
  return state.searchSettingsByTabId[tabId]
}

const state = {
  isSideNavOpen: false,
  outlinesHidden: true,
  sessionSearchHistory: [],
  popularCache: null,
  trendingCache: {
    gaming: null,
    sports: null,
    podcasts: null
  },
  cachedPlaylists: {},
  deArrowCache: {},
  // Seed the in-memory fallback once so upgraded sessions can migrate unloaded
  // tabs to image files without opening every tab first.
  channelThumbnailCache: loadLegacyChannelThumbnailCache(),
  videoAvatarCache: loadLegacyVideoAvatarCache(),
  showProgressBar: false,
  progressBarMessage: '',
  progressBarIcon: ['fas', 'sync'],
  showAddToPlaylistPrompt: false,
  showCreatePlaylistPrompt: false,
  isKeyboardShortcutPromptShown: false,
  settingsWindowOpen: false,
  settingsWindowMinimized: false,
  settingsWindowMorphing: false,
  settingsWindowReturnView: null,
  settingsWindowView: null,
  settingsWindowSection: null,
  customThemeEditorOpen: false,
  customThemes: [],
  showSearchFilters: false,
  searchFilterValueChangedByTabId: {},
  progressBarPercentage: 0,
  toBeAddedToPlaylistVideoList: [],
  newPlaylistDefaultProperties: {},
  newPlaylistVideoObject: [],
  regionNames: [],
  regionValues: [],
  youtubeCaptionLanguageCodes: [...YOUTUBE_CAPTION_LANGUAGE_CODES],
  searchSettingsByTabId: {},
  externalPlayerNames: [],
  externalPlayerValues: [],
  externalPlayerCmdArguments: {},
  lastPopularRefreshTimestamp: '',
  lastTrendingRefreshTimestamp: {
    gaming: '',
    sports: '',
    podcasts: ''
  },
  subscriptionFirstAutoFetchRunData: {
    videos: false,
    liveStreams: false,
    shorts: false,
    posts: false,
  },
  appTitle: '',
  openPrompts: new Set()
}

const getters = {
  getIsSideNavOpen(state) {
    return state.isSideNavOpen
  },

  getOutlinesHidden(state) {
    return state.outlinesHidden
  },

  getSessionSearchHistory(state) {
    return state.sessionSearchHistory
  },

  getDeArrowCache: (state) => {
    return state.deArrowCache
  },

  getChannelThumbnail: (state) => (channelId) => {
    return state.channelThumbnailCache[channelId] ?? null
  },

  getVideoAvatar: (state) => (videoId) => {
    return state.videoAvatarCache[videoId] ?? null
  },

  getPopularCache(state) {
    return state.popularCache
  },

  getTrendingCache(state) {
    return state.trendingCache
  },

  getCachedPlaylist: (state) => (tabId = 'web') => {
    return state.cachedPlaylists[tabId] ?? null
  },

  getSearchSettings: (state) => (tabId = 'web') => {
    return state.searchSettingsByTabId[tabId] ?? {
      prioritize: 'relevance',
      time: '',
      type: 'all',
      duration: '',
      features: [],
    }
  },

  getSearchFilterValueChanged: (state) => (tabId = 'web') => {
    return state.searchFilterValueChangedByTabId[tabId] ?? false
  },

  getIsKeyboardShortcutPromptShown(state) {
    return state.isKeyboardShortcutPromptShown
  },

  getSettingsWindowOpen(state) {
    return state.settingsWindowOpen
  },

  getSettingsWindowMinimized(state) {
    return state.settingsWindowMinimized
  },

  getSettingsWindowMorphing(state) {
    return state.settingsWindowMorphing
  },

  getSettingsWindowReturnView(state) {
    return state.settingsWindowReturnView
  },

  getSettingsWindowView(state) {
    return state.settingsWindowView
  },

  getSettingsWindowSection(state) {
    return state.settingsWindowSection
  },

  getCustomThemeEditorOpen(state) {
    return state.customThemeEditorOpen
  },

  getCustomThemes(state) {
    return state.customThemes
  },

  getShowAddToPlaylistPrompt(state) {
    return state.showAddToPlaylistPrompt
  },

  getShowCreatePlaylistPrompt(state) {
    return state.showCreatePlaylistPrompt
  },

  getShowSearchFilters(state) {
    return state.showSearchFilters
  },

  getToBeAddedToPlaylistVideoList(state) {
    return state.toBeAddedToPlaylistVideoList
  },

  getNewPlaylistDefaultProperties(state) {
    return state.newPlaylistDefaultProperties
  },

  getNewPlaylistVideoObject(state) {
    return state.newPlaylistVideoObject
  },

  getShowProgressBar(state) {
    return state.showProgressBar
  },

  getProgressBarPercentage(state) {
    return state.progressBarPercentage
  },

  getProgressBarMessage(state) {
    return state.progressBarMessage
  },

  getProgressBarIcon(state) {
    return state.progressBarIcon
  },

  getRegionNames(state) {
    return state.regionNames
  },

  getRegionValues(state) {
    return state.regionValues
  },

  getYouTubeCaptionLanguageCodes(state) {
    return state.youtubeCaptionLanguageCodes
  },

  getExternalPlayerNames(state) {
    return state.externalPlayerNames
  },

  getExternalPlayerValues(state) {
    return state.externalPlayerValues
  },

  getExternalPlayerCmdArguments (state) {
    return state.externalPlayerCmdArguments
  },

  getLastTrendingRefreshTimestamp(state) {
    return state.lastTrendingRefreshTimestamp
  },

  getLastPopularRefreshTimestamp(state) {
    return state.lastPopularRefreshTimestamp
  },

  getSubscriptionForVideosFirstAutoFetchRun(state) {
    return state.subscriptionFirstAutoFetchRunData.videos === true
  },
  getSubscriptionForLiveStreamsFirstAutoFetchRun (state) {
    return state.subscriptionFirstAutoFetchRunData.liveStreams === true
  },
  getSubscriptionForShortsFirstAutoFetchRun (state) {
    return state.subscriptionFirstAutoFetchRunData.shorts === true
  },
  getSubscriptionForPostsFirstAutoFetchRun (state) {
    return state.subscriptionFirstAutoFetchRunData.posts === true
  },
  getAppTitle (state) {
    return state.appTitle
  },
  isAnyPromptOpen(state) {
    return state.openPrompts.size > 0
  }
}

const actions = {
  updateCustomThemes: commitCustomThemesEdit,

  showOutlines({ commit }) {
    commit('setOutlinesHidden', false)
  },

  hideOutlines({ commit }) {
    commit('setOutlinesHidden', true)
  },

  parseScreenshotCustomFileName: function({ rootState }, payload) {
    const { pattern = rootState.settings.screenshotFilenamePattern, date, playerTime, videoId } = payload
    const keywords = [
      ['%Y', date.getFullYear()], // year 4 digits
      ['%M', (date.getMonth() + 1).toString().padStart(2, '0')], // month 2 digits
      ['%D', date.getDate().toString().padStart(2, '0')], // day 2 digits
      ['%H', date.getHours().toString().padStart(2, '0')], // hour 2 digits
      ['%N', date.getMinutes().toString().padStart(2, '0')], // minute 2 digits
      ['%S', date.getSeconds().toString().padStart(2, '0')], // second 2 digits
      ['%T', date.getMilliseconds().toString().padStart(3, '0')], // millisecond 3 digits
      ['%s', parseInt(playerTime)], // video position second n digits
      ['%t', (playerTime % 1).toString().slice(2, 5) || '000'], // video position millisecond 3 digits
      ['%i', videoId] // video id
    ]

    let parsedString = pattern
    for (const [key, value] of keywords) {
      parsedString = parsedString.replaceAll(key, value)
    }

    if (parsedString !== replaceFilenameForbiddenChars(parsedString)) {
      throw new Error(i18n.global.t('Settings.Player Settings.Screenshot.Error.Forbidden Characters'))
    }

    if (!parsedString) {
      throw new Error(i18n.global.t('Settings.Player Settings.Screenshot.Error.Empty File Name'))
    }

    return parsedString
  },

  showAddToPlaylistPromptForManyVideos ({ commit }, { videos: videoObjectArray, newPlaylistDefaultProperties }) {
    let videoDataValid = true
    if (!Array.isArray(videoObjectArray)) {
      videoDataValid = false
    }
    let missingKeys = []

    if (videoDataValid) {
      const requiredVideoKeys = [
        'videoId',
        'title',
        'lengthSeconds',

        // These two properties will be missing for shorts added to a playlist from anywhere but the watch page
        // 'author',
        // 'authorId',

        // `timeAdded` should be generated when videos are added
        // Not when a prompt is displayed
        // 'timeAdded',

        // `playlistItemId` should be generated anyway
        // 'playlistItemId',

        // `type` should be added in action anyway
        // 'type',
      ]
      // Using `every` to loop and `return false` to break
      videoObjectArray.every((video) => {
        const videoPropertyKeys = Object.keys(video)
        const missingKeysHere = requiredVideoKeys.filter(x => !videoPropertyKeys.includes(x))
        if (missingKeysHere.length > 0) {
          videoDataValid = false
          missingKeys = missingKeysHere
          return false
        }
        // Return true to continue loop
        return true
      })
    }

    if (!videoDataValid) {
      // Print error and abort
      const errorMsgText = 'Incorrect videos data passed when opening playlist prompt'
      console.error(errorMsgText)
      console.error({
        videoObjectArray,
        missingKeys,
      })
      throw new Error(errorMsgText)
    }

    commit('setShowAddToPlaylistPrompt', true)
    commit('setToBeAddedToPlaylistVideoList', videoObjectArray)
    if (newPlaylistDefaultProperties != null) {
      commit('setNewPlaylistDefaultProperties', newPlaylistDefaultProperties)
    }
  },

  hideAddToPlaylistPrompt ({ commit }) {
    commit('setShowAddToPlaylistPrompt', false)
    // The default value properties are only valid until prompt is closed
    commit('resetNewPlaylistDefaultProperties')
  },

  showCreatePlaylistPrompt ({ commit }, data) {
    commit('setShowCreatePlaylistPrompt', true)
    commit('setNewPlaylistVideoObject', data)
  },

  showKeyboardShortcutPrompt ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', true)
    commit('setSettingsWindowMinimized', false)
    commit('setSettingsWindowOpen', true)
  },

  hideKeyboardShortcutPrompt ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
  },

  showSettingsWindow ({ commit }, view = null) {
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowReturnView', null)
    commit('setSettingsWindowView', view)
    commit('setSettingsWindowMinimized', false)
    commit('setSettingsWindowOpen', true)
  },

  showDownloadsFromSettings ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowReturnView', 'settings')
    commit('setSettingsWindowView', 'downloads')
    commit('setSettingsWindowMinimized', false)
    commit('setSettingsWindowOpen', true)
  },

  toggleSettingsWindow ({ state, commit }) {
    const open = state.settingsWindowMinimized || !state.settingsWindowOpen ||
      state.settingsWindowView !== null ||
      state.isKeyboardShortcutPromptShown
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowReturnView', null)
    commit('setSettingsWindowView', null)
    commit('setSettingsWindowMinimized', false)
    commit('setSettingsWindowOpen', open)
  },

  hideSettingsWindow ({ commit }) {
    commit('setSettingsWindowReturnView', null)
    commit('setSettingsWindowMinimized', false)
    commit('setSettingsWindowOpen', false)
  },

  minimizeSettingsWindow ({ state, commit }) {
    if (!state.settingsWindowOpen || state.settingsWindowMorphing) return
    return morphSettingsWindow(commit, () => {
      commit('setSettingsWindowOpen', false)
      commit('setSettingsWindowMinimized', true)
    })
  },

  restoreSettingsWindow ({ state, commit }) {
    if (!state.settingsWindowMinimized || state.settingsWindowMorphing) return
    return morphSettingsWindow(commit, () => {
      commit('setSettingsWindowMinimized', false)
      commit('setSettingsWindowOpen', true)
    })
  },

  showSettingsWindowRoot ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowReturnView', null)
    commit('setSettingsWindowView', null)
  },

  showSearchFilters ({ commit }) {
    commit('setShowSearchFilters', true)
  },

  hideSearchFilters ({ commit }) {
    commit('setShowSearchFilters', false)
  },

  updateShowProgressBar ({ commit }, value) {
    commit('setShowProgressBar', value)
  },

  async getRegionData ({ commit }, locale) {
    const localePathExists = process.env.GEOLOCATION_NAMES.includes(locale)

    const url = createWebURL(`/static/geolocations/${localePathExists ? locale : 'en-US'}.json`)

    const countries = await (await fetch(url)).json()

    commit('setRegionNames', countries.names)
    commit('setRegionValues', countries.codes)
  },

  async getYoutubeUrlInfo({ rootState, state }, urlStr) {
    return parseYoutubeUrlInfo(urlStr, {
      getVideoParamsFromUrl,
      checkYoutubeChannelId,
      searchSettings: state.searchSettings,
      backendPreference: rootState.settings.backendPreference,
      hideChannelHome: rootState.settings.hideChannelHome,
      supportsLocalApi: process.env.SUPPORTS_LOCAL_API
    })
  },

  clearSessionSearchHistory ({ commit }) {
    commit('setSessionSearchHistory', [])
  },

  async getExternalPlayerCmdArgumentsData ({ commit }) {
    const url = createWebURL('/static/external-player-map.json')
    const externalPlayerMap = await (await fetch(url)).json()
    // Sort external players alphabetically & case-insensitive, keep default entry at the top
    const playerNone = externalPlayerMap.shift()
    externalPlayerMap.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    externalPlayerMap.unshift(playerNone)

    const externalPlayerNames = externalPlayerMap.map((entry) => { return entry.name })
    const externalPlayerValues = externalPlayerMap.map((entry) => { return entry.value })
    const externalPlayerCmdArguments = externalPlayerMap.reduce((result, item) => {
      result[item.value] = item.cmdArguments
      return result
    }, {})

    commit('setExternalPlayerNames', externalPlayerNames)
    commit('setExternalPlayerValues', externalPlayerValues)
    commit('setExternalPlayerCmdArguments', externalPlayerCmdArguments)
  },
}

const mutations = {
  toggleSideNav (state) {
    state.isSideNavOpen = !state.isSideNavOpen
  },

  setOutlinesHidden(state, value) {
    state.outlinesHidden = value
  },

  setShowProgressBar (state, value) {
    state.showProgressBar = value
  },

  setProgressBarPercentage (state, value) {
    state.progressBarPercentage = value
  },

  setProgressBarMessage (state, value) {
    state.progressBarMessage = value
  },

  setProgressBarIcon (state, value) {
    state.progressBarIcon = value
  },

  setSessionSearchHistory (state, history) {
    state.sessionSearchHistory = history
  },

  setDeArrowCache (state, cache) {
    state.deArrowCache = cache
  },

  addVideoToDeArrowCache (state, payload) {
    const sameVideo = state.deArrowCache[payload.videoId]

    if (!sameVideo) {
      state.deArrowCache[payload.videoId] = payload
    }
  },

  addThumbnailToDeArrowCache (state, payload) {
    state.deArrowCache[payload.videoId] = payload
  },

  setChannelThumbnail (state, { channelId, thumbnail }) {
    if (!channelId || !thumbnail) {
      return
    }

    const cache = state.channelThumbnailCache
    if (cache[channelId] === thumbnail) {
      return
    }

    const keys = Object.keys(cache)
    if (!(channelId in cache) && keys.length >= CHANNEL_THUMBNAIL_CACHE_LIMIT) {
      delete cache[keys[0]]
    }

    cache[channelId] = thumbnail
  },

  setVideoAvatar (state, { videoId, avatar }) {
    if (!videoId || !avatar) return

    const cache = state.videoAvatarCache
    if (cache[videoId] === avatar) return

    const keys = Object.keys(cache)
    if (!(videoId in cache) && keys.length >= VIDEO_AVATAR_CACHE_LIMIT) {
      delete cache[keys[0]]
    }

    cache[videoId] = avatar
  },

  removeFromSessionSearchHistory (state, { query, searchSettings }) {
    state.sessionSearchHistory = state.sessionSearchHistory.filter((search) => {
      return search.query !== query || !searchFiltersMatch(search.searchSettings, searchSettings)
    })
  },

  addToSessionSearchHistory (state, payload) {
    const sameSearch = state.sessionSearchHistory.findIndex((search) => {
      return search.query === payload.query && searchFiltersMatch(payload.searchSettings, search.searchSettings)
    })

    if (sameSearch !== -1) {
      state.sessionSearchHistory[sameSearch].data = payload.data
      if (Object.hasOwn(payload, 'nextPageRef')) {
        state.sessionSearchHistory[sameSearch].nextPageRef = payload.nextPageRef
      }
      if (Object.hasOwn(payload, 'searchPage')) {
        state.sessionSearchHistory[sameSearch].searchPage = payload.searchPage
      }
      if (Object.hasOwn(payload, 'hasMoreResults')) {
        state.sessionSearchHistory[sameSearch].hasMoreResults = payload.hasMoreResults
      }
    } else {
      state.sessionSearchHistory.push(payload)
    }
  },

  setShowAddToPlaylistPrompt (state, payload) {
    state.showAddToPlaylistPrompt = payload
  },

  setShowCreatePlaylistPrompt (state, payload) {
    state.showCreatePlaylistPrompt = payload
  },

  setIsKeyboardShortcutPromptShown (state, payload) {
    state.isKeyboardShortcutPromptShown = payload
  },

  setSettingsWindowOpen (state, payload) {
    state.settingsWindowOpen = payload
  },

  setSettingsWindowMinimized (state, payload) {
    state.settingsWindowMinimized = payload
  },

  setSettingsWindowMorphing (state, payload) {
    state.settingsWindowMorphing = payload
  },

  setSettingsWindowReturnView (state, payload) {
    state.settingsWindowReturnView = payload
  },

  setSettingsWindowView (state, payload) {
    state.settingsWindowView = payload
  },

  setSettingsWindowSection (state, payload) {
    state.settingsWindowSection = payload
  },

  setCustomThemeEditorOpen (state, payload) {
    state.customThemeEditorOpen = payload
  },

  setCustomThemes (state, payload) {
    state.customThemes = payload
  },

  setShowSearchFilters (state, payload) {
    state.showSearchFilters = payload
  },

  setToBeAddedToPlaylistVideoList (state, payload) {
    state.toBeAddedToPlaylistVideoList = payload
  },

  setNewPlaylistDefaultProperties (state, payload) {
    state.newPlaylistDefaultProperties = payload
  },
  resetNewPlaylistDefaultProperties (state) {
    state.newPlaylistDefaultProperties = {}
  },

  setNewPlaylistVideoObject (state, payload) {
    state.newPlaylistVideoObject = payload
  },

  setPopularCache (state, value) {
    state.popularCache = value
  },

  setTrendingCache (state, { value, page }) {
    state.trendingCache[page] = value
  },

  /**
   * @param {typeof state} state
   * @param {{page: 'gaming' | 'sports' | 'podcasts', timestamp: Date}} param1
   */
  setLastTrendingRefreshTimestamp (state, { page, timestamp }) {
    state.lastTrendingRefreshTimestamp[page] = timestamp
  },

  setLastPopularRefreshTimestamp (state, timestamp) {
    state.lastPopularRefreshTimestamp = timestamp
  },

  /**
   * @param {typeof state} state
   * @param {'gaming' | 'sports' | 'podcasts'} page
   */
  clearTrendingCache(state, page) {
    state.trendingCache[page] = null
  },

  setCachedPlaylist(state, { tabId = 'web', value }) {
    if (value == null) {
      delete state.cachedPlaylists[tabId]
    } else {
      state.cachedPlaylists[tabId] = value
    }
  },

  setSearchFilterValueChanged (state, { tabId = 'web', value }) {
    state.searchFilterValueChangedByTabId[tabId] = value
  },

  setSearchPrioritize (state, { tabId = 'web', value }) {
    getOrCreateSearchSettings(state, tabId).prioritize = value
  },

  setSearchTime (state, { tabId = 'web', value }) {
    getOrCreateSearchSettings(state, tabId).time = value
  },

  setSearchType (state, { tabId = 'web', value }) {
    getOrCreateSearchSettings(state, tabId).type = value
  },

  setSearchDuration (state, { tabId = 'web', value }) {
    getOrCreateSearchSettings(state, tabId).duration = value
  },

  setSearchFeatures (state, { tabId = 'web', value }) {
    getOrCreateSearchSettings(state, tabId).features = value
  },

  setRegionNames (state, value) {
    state.regionNames = value
  },

  setRegionValues (state, value) {
    state.regionValues = value
  },

  setYouTubeCaptionLanguageCodes(state, languages) {
    state.youtubeCaptionLanguageCodes = mergeYouTubeCaptionLanguageCodes([
      ...state.youtubeCaptionLanguageCodes,
      ...languages,
    ])
  },

  setExternalPlayerNames (state, value) {
    state.externalPlayerNames = value
  },

  setExternalPlayerValues (state, value) {
    state.externalPlayerValues = value
  },

  setExternalPlayerCmdArguments (state, value) {
    state.externalPlayerCmdArguments = value
  },

  // Use this to set the app title / document.title
  setAppTitle (state, value) {
    state.appTitle = value
  },

  addOpenPrompt(state, id) {
    state.openPrompts.add(id)
  },

  removeOpenPrompt(state, id) {
    state.openPrompts.delete(id)
  },

  setSubscriptionForVideosFirstAutoFetchRun (state) {
    state.subscriptionFirstAutoFetchRunData.videos = true
  },
  setSubscriptionForLiveStreamsFirstAutoFetchRun (state) {
    state.subscriptionFirstAutoFetchRunData.liveStreams = true
  },
  setSubscriptionForShortsFirstAutoFetchRun (state) {
    state.subscriptionFirstAutoFetchRunData.shorts = true
  },
  setSubscriptionForPostsFirstAutoFetchRun (state) {
    state.subscriptionFirstAutoFetchRunData.posts = true
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
