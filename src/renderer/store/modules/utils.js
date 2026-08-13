import i18n from '../../i18n/index'

import { checkYoutubeChannelId } from '../../helpers/channels'
import {
  CHANNEL_HANDLE_REGEX,
  createWebURL,
  getVideoParamsFromUrl,
  replaceFilenameForbiddenChars,
  searchFiltersMatch,
} from '../../helpers/utils'
import {
  loadLegacyChannelThumbnailCache,
  loadLegacyVideoAvatarCache,
} from '../../helpers/channelThumbnailStorage'

const CHANNEL_THUMBNAIL_CACHE_LIMIT = 200
const VIDEO_AVATAR_CACHE_LIMIT = 200

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
    commit('setSettingsWindowOpen', true)
  },

  hideKeyboardShortcutPrompt ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
  },

  showSettingsWindow ({ commit }, view = null) {
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowView', view)
    commit('setSettingsWindowOpen', true)
  },

  toggleSettingsWindow ({ state, commit }) {
    const open = !state.settingsWindowOpen
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowView', null)
    commit('setSettingsWindowOpen', open)
  },

  hideSettingsWindow ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
    commit('setSettingsWindowOpen', false)
    commit('setSettingsWindowView', null)
  },

  showSettingsWindowRoot ({ commit }) {
    commit('setIsKeyboardShortcutPromptShown', false)
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
    // Returns
    // - urlType [String] `video`, `playlist`
    //
    // If `urlType` is "video"
    // - videoId [String]
    // - timestamp [String]
    //
    // If `urlType` is "playlist"
    // - playlistId [String]
    // - query [Object]
    //
    // If `urlType` is "search"
    // - searchQuery [String]
    // - query [Object]
    //
    // If `urlType` is "hashtag"
    // Nothing else
    //
    // If `urlType` is "channel"
    // - channelId [String]
    //
    // If `urlType` is "unknown"
    // Nothing else
    //
    // If `urlType` is "invalid_url"
    // Nothing else

    if (CHANNEL_HANDLE_REGEX.test(urlStr)) {
      urlStr = `https://www.youtube.com/${urlStr}`
    }

    const { videoId, timestamp, playlistId, commentId, isShort } = getVideoParamsFromUrl(urlStr)
    if (videoId) {
      return {
        urlType: 'video',
        videoId,
        playlistId,
        timestamp,
        commentId,
        isShort
      }
    }

    let url
    try {
      url = new URL(urlStr)
    } catch {
      return {
        urlType: 'invalid_url'
      }
    }
    let urlType = 'unknown'

    const channelPattern =
      /^\/(?:(?:channel|user|c)\/)?(?<channelId>[^/]+)(?:\/(?<tab>join|featured|videos|shorts|live|streams|podcasts|releases|courses|playlists|about|community|channels))?\/?$/

    const hashtagPattern = /^\/hashtag\/(?<tag>[^#&/?]+)$/

    const postPattern = /^\/post\/(?<postId>.+)/
    const feedPattern = /^\/feed\/(?<type>trending|subscriptions|history|playlists|you|library)/
    const typePatterns = new Map([
      ['playlist', /^(\/playlist\/?|\/embed(\/?videoseries)?)$/],
      ['search', /^\/results|search\/?$/],
      ['hashtag', hashtagPattern],
      ['post', postPattern],
      ['feed', feedPattern],
      ['channel', channelPattern],
    ])

    for (const [type, pattern] of typePatterns) {
      const matchFound = pattern.test(url.pathname)
      if (matchFound) {
        urlType = type
        break
      }
    }

    switch (urlType) {
      case 'playlist': {
        if (!url.searchParams.has('list')) {
          return { urlType: 'unknown' }
        }

        const playlistId = url.searchParams.get('list')
        url.searchParams.delete('list')

        const query = {}
        for (const [param, value] of url.searchParams) {
          query[param] = value
        }

        return {
          urlType: 'playlist',
          playlistId,
          query
        }
      }

      case 'search': {
        let searchQuery = null
        if (url.searchParams.has('search_query')) {
          // https://www.youtube.com/results?search_query={QUERY}
          searchQuery = url.searchParams.get('search_query')
          url.searchParams.delete('search_query')
        }
        if (url.searchParams.has('q')) {
          // https://redirect.invidious.io/search?q={QUERY}
          searchQuery = url.searchParams.get('q')
          url.searchParams.delete('q')
        }
        if (searchQuery == null) {
          return { urlType: 'unknown' }
        }

        const searchSettings = state.searchSettings
        const query = {
          prioritize: searchSettings.prioritize,
          time: searchSettings.time,
          type: searchSettings.type,
          duration: searchSettings.duration,
          features: searchSettings.features
        }

        for (const [param, value] of url.searchParams) {
          query[param] = value
        }

        return {
          urlType: 'search',
          searchQuery,
          query
        }
      }

      case 'hashtag': {
        const match = url.pathname.match(hashtagPattern)
        const hashtag = match.groups.tag

        return {
          urlType: 'hashtag',
          hashtag
        }
      }

      case 'post': {
        const match = url.pathname.match(postPattern)
        const postId = match.groups.postId
        const query = { authorId: url.searchParams.get('ucid') }
        return {
          urlType: 'post',
          postId,
          query
        }
      }
      /*
      Using RegExp named capture groups from ES2018
      To avoid access to specific captured value broken

      Channel URL (ID-based)
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/about
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/channels
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/community
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/featured
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/join
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/playlists
      https://www.youtube.com/channel/UCfMJ2MchTSW2kWaT0kK94Yw/videos

      Custom URL

      https://www.youtube.com/c/YouTubeCreators
      https://www.youtube.com/c/YouTubeCreators/about
      etc.

      Legacy Username URL

      https://www.youtube.com/user/ufoludek
      https://www.youtube.com/user/ufoludek/about
      etc.

      */
      case 'channel': {
        const match = url.pathname.match(channelPattern)
        const rawChannelId = match.groups.channelId
        let channelId = rawChannelId
        if (rawChannelId.startsWith('@') && checkYoutubeChannelId(rawChannelId.slice(1))) {
          channelId = rawChannelId.slice(1)
        }
        if (!channelId) {
          return { urlType: 'unknown' }
        }

        let channelUrlPath = url.pathname
        if (channelId !== rawChannelId) {
          channelUrlPath = `/channel/${channelId}${match.groups.tab ? `/${match.groups.tab}` : ''}`
        }

        let subPath
        switch (match.groups.tab) {
          case 'shorts':
            subPath = 'shorts'
            break
          case 'live':
          case 'streams':
            subPath = 'live'
            break
          case 'playlists':
            subPath = 'playlists'
            break
          case 'podcasts':
            subPath = 'podcasts'
            break
          case 'courses':
            subPath = 'courses'
            break
          case 'releases':
            subPath = 'releases'
            break
          case 'channels':
          case 'about':
            subPath = 'about'
            break
          case 'community':
            if (url.searchParams.has('lb')) {
              // if it has the lb search parameter then it is linking a specific community post
              const postId = url.searchParams.get('lb')
              const query = { authorId: channelId }
              return {
                urlType: 'post',
                postId,
                query
              }
            }
            subPath = 'community'
            break
          case 'videos':
            subPath = 'videos'
            break
          default:
            subPath = rootState.settings.backendPreference === 'local' && !rootState.settings.hideChannelHome ? 'home' : 'videos'
            break
        }
        return {
          urlType: 'channel',
          channelId,
          subPath,
          // The original URL could be from Invidious.
          // We need to make sure it starts with youtube.com, so that YouTube's resolve endpoint can recognise it
          url: `https://www.youtube.com${channelUrlPath}`
        }
      }
      case 'feed': {
        /** @type {'trending' | 'subscriptions' | 'history' | 'playlists' | 'you' | 'library'} */
        const feedType = url.pathname.match(feedPattern).groups.type

        if (feedType === 'playlists' || feedType === 'you' || feedType === 'library') {
          return { urlType: 'userplaylists' }
        } else if (process.env.SUPPORTS_LOCAL_API || feedType !== 'trending') {
          return { urlType: feedType }
        }
        // Can fall through if a trending URL is detected in a build without the local API
      }

      default: {
        // Unknown URL type
        return {
          urlType: 'unknown'
        }
      }
    }
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

  removeFromSessionSearchHistory (state, query) {
    state.sessionSearchHistory = state.sessionSearchHistory.filter((search) => search.query !== query)
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
