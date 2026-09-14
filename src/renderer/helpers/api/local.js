import { createLocalFeedParsers } from './local-feed-parsers'
import { ClientType, Constants, Innertube, Mixins, Parser, Platform, Player, Session, UniversalCache, Utils, YT, YTNodes } from 'youtubei.js'
import Autolinker from 'autolinker'
import { parseLooseJSON } from 'bgutils-js/utils'

import { SEARCH_CHAR_LIMIT } from '../../../constants'
import store from '../../store/index'
import { PlayerCache } from './PlayerCache'
import { loadSearchContinuation } from '../search-continuation'
import {
  getCommentTranslationSource,
  requestCommentTranslation
} from '../comment-translations'
import { parseLocalShortLinkedVideo } from '../player/shorts'
import { getPaidPromotionDurationMs } from '../player/paidPromotion'
import { classifyMusicMediaType, MUSIC_MEDIA_TYPE } from '../player/musicMediaType'
import { getLocalPremiereState } from '../premiere'
import { getAndroidLiveHlsManifestUrl } from '../player/liveManifest'
import { shouldHideMembersOnlyContent } from '../restricted-playback'
import { getThumbnailPreviewUrl } from '../thumbnailPreview'
import { parseLocalVideoChannels } from '../video-collaborators'

import { evaluatePlayerScript, generateContentPoToken } from './local-api-platform'
import { calculatePublishedDate, deepCopy, extractNumberFromString, getChannelPlaylistId, getRelativeTimeFromDate } from '../utils'

const {
  normalizeLocalSubscriptionFeed,
  parseLocalPlaylistVideos,
  parseLocalPlaylistVideo,
  parseLockupView,
  parseLocalSubscriberCount,
  parseLocalChannelHeader,
  parseLocalChannelShorts,
  parseShort,
  parseLocalCommunityPosts,
  parseLocalCommunityPost,
  parseLocalTextRuns,
  parseLocalListVideo,
  parseLocalListPlaylist,
  parseLocalChannelVideos
} = createLocalFeedParsers(isMembersOnly => shouldHideMembersOnlyContent(isMembersOnly, store.getters))
export { normalizeLocalSubscriptionFeed, parseLocalPlaylistVideos, parseLocalPlaylistVideo, parseLocalSubscriberCount, parseLocalChannelHeader, parseLocalChannelShorts, parseShort, parseLocalCommunityPosts, parseLocalTextRuns, parseLocalListVideo, parseLocalListPlaylist, parseLocalChannelVideos }

/**
 * Uses native HTTP on Android, where YouTube does not allow WebView CORS access.
 * @param {RequestInfo | URL} input
 * @param {RequestInit & { nativeTimeoutMs?: number }} [init]
 */
export async function localApiFetch(input, init) {
  if (process.env.IS_CAPACITOR) {
    const { capacitorHttpFetch } = await import('./capacitor-http')
    return await capacitorHttpFetch(input, init)
  }

  return await fetch(input, init)
}

if (process.env.SUPPORTS_LOCAL_API) {
  Platform.shim.eval = evaluatePlayerScript
}

/**
 * Creates a lightweight Innertube instance, which is faster to create or
 * an instance that can decode the streaming URLs, which is slower to create
 * the lightweight one only needs a single web request to create the new session
 * the full one needs 3 (or 2 if the player is cached) web requests to create:
 * 1. the request for the session
 * 2. fetch a page that contains a link to the player
 * 3. if the player isn't cached, it is downloaded and transformed
 * @param {object} options
 * @param {boolean} options.withPlayer set to true to get an Innertube instance that can decode the streaming URLs
 * @param {string|undefined} options.location the geolocation to pass to YouTube get different content
 * @param {boolean} options.safetyMode whether to hide mature content
 * @param {import('youtubei.js').ClientType} options.clientType use an alterate client
 * @param {boolean} options.generateSessionLocally generate the session locally or let YouTube generate it (local is faster, remote is more accurate)
 * @param {?import('youtubei.js').FetchFunction} options.fetchFunc optional custom fetch function
 * @param {AbortSignal} [options.signal] cancels requests made by this instance
 * @returns the Innertube instance
 */
async function createInnertube({ withPlayer = false, location = undefined, safetyMode = false, clientType = undefined, generateSessionLocally = true, fetchFunc = null, signal } = {}) {
  let cache
  if (withPlayer) {
    if (process.env.IS_ELECTRON) {
      cache = new PlayerCache()
    } else {
      cache = new UniversalCache(false)
    }
  }

  const fetch = fetchFunc ?? localApiFetch

  return await Innertube.create({
    // This setting is enabled by default and results in YouTube.js reusing the same session across different Innertube instances.
    // That behavior is highly undesirable for OpenTubeX, as we want to create a new session every time to limit tracking.
    enable_session_cache: false,
    retrieve_innertube_config: !generateSessionLocally,
    user_agent: navigator.userAgent,

    retrieve_player: !!withPlayer,
    location: location,
    enable_safety_mode: !!safetyMode,
    client_type: clientType,

    // Use native HTTP in Capacitor without patching global fetch.
    fetch: signal ? (input, init) => fetch(input, { ...init, signal }) : fetch,
    cache,
    generate_session_locally: !!generateSessionLocally
  })
}

/** @type {Innertube | null} */
let searchSuggestionsSession = null

export async function getLocalSearchSuggestions(query) {
  // The search suggestions endpoint does not like search queries larger than SEARCH_CHAR_LIMIT
  // so return an empty array instead
  if (query.length > SEARCH_CHAR_LIMIT) {
    return []
  }

  // reuse innertube instance to keep the search suggestions snappy
  if (searchSuggestionsSession === null) {
    searchSuggestionsSession = await createInnertube()
  }

  return await searchSuggestionsSession.getSearchSuggestions(query)
}

/**
 * Translate comment text with YouTube's comment translation service.
 * @param {string} text
 * @param {string} targetLanguage
 * @returns {Promise<string>}
 */
export async function translateCommentText(text, targetLanguage) {
  return await requestCommentTranslation(text, targetLanguage, async (source, language) => {
    const innertube = await createInnertube()
    return await innertube.interact.translate(source, language)
  })
}

export function clearLocalSearchSuggestionsSession() {
  searchSuggestionsSession = null
}

export async function getLocalPlaylist(id, signal) {
  const innertube = await createInnertube({ signal })
  return await innertube.getPlaylist(id)
}

/**
 * @typedef {object} SerializedContinuation
 * @property {import('youtubei.js').Context} context
 * @property {string} path
 * @property {any} payload
 */

/**
 * @param {import('youtubei.js').YTNodes.ContinuationItem | import('youtubei.js').YTNodes.ContinuationItemView} continuationItemOrView
 * @param {import('youtubei.js').Actions} actions
 */
function serializeContinuation(continuationItemOrView, actions) {
  let path, payload

  // Based on YouTube.js' NavigationEndpoint#call()
  if (continuationItemOrView.endpoint.command.is(YTNodes.CommandExecutorCommand)) {
    /** @type {import('youtubei.js').Helpers.YTNode & import('youtubei.js').APIResponseTypes.IEndpoint} */
    const command = continuationItemOrView.endpoint.command.commands.at(-1)

    path = command.getApiPath()
    payload = command.buildRequest()
  } else {
    path = continuationItemOrView.endpoint.metadata.api_url
    payload = continuationItemOrView.endpoint.payload
  }

  /** @type {SerializedContinuation} */
  const data = {
    path,
    payload: payload,
    context: actions.session.context
  }

  return JSON.stringify(data)
}

/**
 * @template {import('youtubei.js').YTNodes} N
 * @param {import('youtubei.js').Mixins.Feed} feed
 * @param {import('youtubei.js').YTNodeConstructor<N>[]} types
 * @return {N}
 */
function extractFeedContinuation(feed, types) {
  let continuationItem

  if (feed.page.header_memo) {
    const headerContinuations = feed.page.header_memo.getType(...types)
    continuationItem = feed.memo.getType(...types).find(
      (continuation) => !headerContinuations.includes(continuation)
    )
  } else {
    continuationItem = feed.memo.getType(types)[0]
  }

  if (!continuationItem) {
    throw new Utils.InnertubeError('There are no continuations.')
  }

  return continuationItem
}

/**
 * Based on YouTube.js' YT.Playlist.getContinuationData method
 * @param {import('youtubei.js').YT.Playlist} playlist
 */
export function extractLocalCacheablePlaylistContinuation(playlist) {
  const sectionList = playlist.memo.getType(YTNodes.SectionList)[0]

  let continuationItemOrView

  // No section list means there can't be additional continuation nodes here,
  // so no need to check.
  if (!sectionList) {
    continuationItemOrView = extractFeedContinuation(playlist, [YTNodes.ContinuationItem, YTNodes.ContinuationItemView])
  } else {
    continuationItemOrView = playlist.memo.getType(YTNodes.ContinuationItem, YTNodes.ContinuationItemView)
      .find((node) => !sectionList.contents.includes(node))
  }

  if (!continuationItemOrView) {
    throw new Utils.InnertubeError('There are no continuations.')
  }

  return serializeContinuation(continuationItemOrView, playlist.actions)
}

/**
 * Based on YouTube.js' YT.Search.getContinuationData method
 * @param {import('youtubei.js').YT.Search} search
 * @returns {SerializedContinuation}
 */
export function extractLocalCacheableSearchContinuation(search) {
  const continuationItem = extractFeedContinuation(search, [YTNodes.ContinuationItem])

  return serializeContinuation(continuationItem, search.actions)
}

/**
 * @overload
 * @param {'playlist'} type
 * @param {string} continuation
 * @returns {Promise<import('youtubei.js').YT.Playlist>}
 */

/**
 * @overload
 * @param {'search'} type
 * @param {string} continuation
 * @returns {Promise<import('youtubei.js').YT.Search>}
 */

/**
 * @param {'playlist' | 'search'} type
 * @param {string} continuation
 */
export async function getLocalCachedFeedContinuation(type, continuation) {
  /** @type {SerializedContinuation} */
  const data = JSON.parse(continuation)

  const innertube = await createInnertube()
  innertube.session.context = data.context

  const page = await innertube.actions.execute(data.path, { ...data.payload, parse: true })

  if (!page) {
    throw new Utils.InnertubeError('Could not get continuation data')
  }

  if (type === 'playlist') {
    return new YT.Playlist(innertube.actions, page, true)
  } else {
    return new YT.Search(innertube.actions, page, true)
  }
}

export async function getLocalPlaylistContinuation(playlist) {
  try {
    return await playlist.getContinuation()
  } catch (error) {
    const isExpectedContinuationError = error.message.includes('Got empty continuation response.') ||
      error.message.includes('There are no continuations.') ||
      error.message.includes('Continuation not found.')

    if (!isExpectedContinuationError) {
      throw error
    }

    return null
  }
}

/**
 * Callback for processing a Local playlist.
 *
 * @callback untilEndOfLocalPlayListCallback
 * @param {import('youtubei.js').YT.Playlist} playlist
 */

/**
 * @param {import('youtubei.js').YT.Playlist} playlist
 * @param {untilEndOfLocalPlayListCallback} callback
 * @param {object} options
 * @param {boolean} options.runCallbackOnceFirst
 */
export async function untilEndOfLocalPlayList(playlist, callback, options = { runCallbackOnceFirst: true }) {
  if (options.runCallbackOnceFirst) { callback(playlist) }

  while (playlist != null && playlist.has_continuation) {
    playlist = await getLocalPlaylistContinuation(playlist)

    if (playlist != null) { callback(playlist) }
  }
}

/**
 * @param {string} location
 * @param {'gaming' | 'sports' | 'podcasts'} tab
 */
export async function getLocalTrending(location, tab) {
  const innertube = await createInnertube({ location })

  let args

  switch (tab) {
    case 'gaming':
      // https://www.youtube.com/gaming/trending
      args = {
        browseId: 'UCOpNcN46UbXVtpKMrmU4Abg',
        params: 'Egh0cmVuZGluZ7gBAJIDAPIGBAoCMgA'
      }
      break
    case 'sports':
      // https://www.youtube.com/channel/UCEgdi0XIXXZ-qJOFPf4JSKw/sportstab?ss=CMMG
      args = {
        browseId: 'UCEgdi0XIXXZ-qJOFPf4JSKw',
        params: 'EglzcG9ydHN0YWK4AQCSAwDyBgQKAjIA'
      }
      break
    case 'podcasts':
      // https://www.youtube.com/podcasts/popularepisodes
      args = {
        browseId: 'FEpodcasts_destination',
        params: 'qgcCCAM%3D'
      }
      break
    default:
      throw new Error('Unknown trending tab')
  }

  const response = await innertube.actions.execute('/browse', args)
  const feed = new Mixins.Feed(innertube.actions, response)

  return feed.videos.map(video => parseLocalListVideo(video)).filter(_ => _)
}

/**
 * @param {string} query
 * @param {object} filters
 * @param {boolean} safetyMode
 * @param {AbortSignal} [signal]
 */
export async function getLocalSearchResults(query, filters, safetyMode, signal) {
  const innertube = await createInnertube({
    safetyMode,
    signal,
  })
  const response = await innertube.search(query, convertSearchFilters(filters))

  return handleSearchResponse(response)
}

/**
 * @param {YT.Search | SerializedContinuation} continuationData
 */
export async function getLocalSearchContinuation(continuationData) {
  const response = await loadSearchContinuation(() => continuationData instanceof YT.Search
    ? continuationData.getContinuation()
    : getLocalCachedFeedContinuation('search', continuationData))

  if (response === null) {
    return {
      results: [],
      continuationData: null
    }
  }

  return handleSearchResponse(response)
}

/**
 * @param {string} url
 * @param {string} kind
 * @param {(input, init) => Promise<Response>} fetchFunc
 */
async function getHTMLPage(url, kind, fetchFunc) {
  // This returns session/tracking cookies but they get removed in onHeadersReceived in the main process before they are saved by Electron
  const htmlResponse = await fetchFunc(url,
    {
      headers: {
        // We need to be able to parse the localised strings in the /next response data (e.g. view counts and published dates)
        'Accept-Language': 'en-US'
      }
    }
  )

  const isIpBlockResponse = htmlResponse.status === 429 || htmlResponse.url.startsWith('https://www.google.com/sorry/')

  if (!htmlResponse.ok) {
    const error = new Error(`YouTube returned HTTP ${htmlResponse.status} for the ${kind} HTML page`)
    error.isIpBlock = isIpBlockResponse
    throw error
  }

  const htmlPage = await htmlResponse.text()

  const ytConfigStr = htmlPage.match(/ytcfg\.set\(({.+?})\);/s)?.[1]
  if (!ytConfigStr) {
    // required for botguard
    const error = new Error(`Could not find ytcfg in the ${kind} HTML page`)
    error.isIpBlock = isIpBlockResponse
    throw error
  }

  const ytConfig = JSON.parse(ytConfigStr)

  const initialAttestationDataMatch = htmlPage.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)

  if (!initialAttestationDataMatch) {
    // required for botguard
    throw new Error(`Could not find challenge in the ${kind} HTML page`)
  }

  let initialAttestationData

  try {
    initialAttestationData = parseLooseJSON(initialAttestationDataMatch[1])
  } catch (e) {
    const error = new Error(`Failed to parse the ${kind} page initial attestation data`, { cause: e })
    console.error(error, initialAttestationDataMatch[1])
    throw error
  }

  let playerId = ytConfig.PLAYER_JS_URL?.match(/player\/([^/]+)\//)?.[1]

  playerId ??= htmlPage.match(/<script[^>]+src="[^">]+player\/([^/]+)\/[^"]+\/base.js"/)?.[1]

  return {
    htmlPage,
    ytConfig,
    initialAttestationData,
    playerId
  }
}

/**
 * @param {string} videoId
 * @param {(input, init) => Promise<Response>} fetchFunc
 */
async function getWatchHTMLWatchPage(videoId, fetchFunc) {
  let htmlPage, ytConfig, initialAttestationData

  let playerResponse, nextResponse
  /** @type {string | undefined} */
  let playerId

  if (sessionStorage.getItem('playerHtmlHomepageFallback') === '1') {
    ({ ytConfig, initialAttestationData, playerId } = await getHTMLPage('https://www.youtube.com', 'home', fetchFunc))
  } else {
    try {
      ({ htmlPage, ytConfig, initialAttestationData, playerId } = await getHTMLPage(`https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`, 'watch', fetchFunc))

      const playerResponseStr = htmlPage.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/)?.[1]

      // not fatal if it is missing as we can retrieve it from Innertube ourselves
      if (playerResponseStr) {
        try {
          playerResponse = JSON.parse(playerResponseStr)
        } catch (e) {
          console.warn('/player response extracted from the HTML page is invalid JSON', e)
        }
      } else {
        console.warn('Could not find /player response in the HTML page')
      }

      const nextResponseStr = htmlPage.match(/(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*(\{.+?\});/)?.[1]

      // not fatal if it is missing as we can retrieve it from Innertube ourselves
      if (nextResponseStr) {
        try {
          nextResponse = JSON.parse(nextResponseStr)
        } catch (e) {
          console.warn('/next response extracted from the HTML page is invalid JSON', e)
        }
      } else {
        console.warn('Could not find /next response in the HTML page')
      }
    } catch (watchError) {
      console.warn('Falling back to the YT home page for the rest of the session because of:', watchError)

      // Fall back to the home page for the rest of the session/until OpenTubeX is restarted
      // assuming that getting the watch page captcha once is a sign that it will continue happening
      sessionStorage.setItem('playerHtmlHomepageFallback', '1')

      ;({ ytConfig, initialAttestationData, playerId } = await getHTMLPage('https://www.youtube.com', 'home', fetchFunc))
    }
  }

  const session = buildSessionFromYtConfig(ytConfig, fetchFunc)

  return {
    ytConfig,
    initialAttestationData,
    session,
    playerId,
    playerResponse,
    nextResponse
  }
}

/**
 * @param {object} ytConfig
 * @param {(input, init) => Promise<Response>} fetchFunc
 */
function buildSessionFromYtConfig(ytConfig, fetchFunc) {
  const context = deepCopy(ytConfig.INNERTUBE_CONTEXT)

  if (context.clickTracking) {
    delete context.clickTracking
  }

  context.client.timeZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone
  context.client.screenDensityFloat ??= 1
  context.client.screenHeightPoints ??= 1440
  context.client.screenPixelDensity ??= 1
  context.client.screenWidthPoints ??= 2560
  context.client.utcOffsetMinutes ??= -Math.floor((new Date()).getTimezoneOffset())
  context.client.memoryTotalKbytes ??= '8000000'

  context.client.mainAppWebInfo ??= {
    graftUrl: Constants.URLS.YT_BASE,
    pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
    webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
    isWebNativeShareAvailable: true
  }

  context.client.configInfo ??= {}
  context.client.configInfo.coldConfigData ??= ytConfig.RAW_COLD_CONFIG_GROUP?.configData
  context.client.configInfo.coldHashData ??= ytConfig.SERIALIZED_COLD_HASH_DATA
  context.client.configInfo.hotHashData ??= ytConfig.SERIALIZED_HOT_HASH_DATA

  context.user = {
    enableSafetyMode: false,
    lockedSafetyMode: false,
  }

  return new Session(
    context, ytConfig.INNERTUBE_API_KEY, ytConfig.INNERTUBE_API_VERSION,
    0, undefined, undefined, undefined, fetchFunc
  )
}

async function resolveMusicMediaType(playerResponse, actions, videoId) {
  const directType = classifyMusicMediaType(playerResponse.data?.videoDetails?.musicVideoType)
  const category = playerResponse.data?.microformat?.playerMicroformatRenderer?.category

  if (directType !== MUSIC_MEDIA_TYPE.UNKNOWN || category !== 'Music') {
    return directType
  }

  try {
    const musicPlayerResponse = await actions.execute('/player', {
      videoId,
      client: 'YTMUSIC',
      parse: false,
      racyCheckOk: true,
      contentCheckOk: true,
    })
    return classifyMusicMediaType(musicPlayerResponse.data?.videoDetails?.musicVideoType)
  } catch {
    return directType
  }
}

/**
 * @param {string} id
 * @returns {Promise<{
 *   info: import('youtubei.js').YT.VideoInfo,
 *   poToken: string | undefined,
 *   clientInfo: {
 *     clientName: number,
 *     clientVersion: string,
 *     osName: string,
 *     osVersion: string
 *   },
 *   adEndTimeUnixMs: number,
 *   paidPromotionDurationMs: number | null,
 *   isPremiere: boolean | undefined,
 *   watchPageIpBlocked: boolean,
 *   androidLiveHlsManifestUrl: string | null,
 *   musicMediaType: import('../player/musicMediaType').MusicMediaType
 * }>}
 */
export async function getLocalVideoInfo(id) {
  let responseTime
  let paidPromotionDurationMs = null
  let isPremiere
  let watchPageIpBlocked = false

  const fetchFunc = async (input, init) => {
    if (!(input.url?.startsWith('https://www.youtube.com/youtubei/v1/player'))) {
      return localApiFetch(input, init)
    }

    const response = await localApiFetch(input, init)
    const responseText = await response.text()

    responseTime = Date.now()

    const json = JSON.parse(responseText)

    paidPromotionDurationMs ??= getPaidPromotionDurationMs(json)
    isPremiere ??= getLocalPremiereState(json.videoDetails)

    // Need to return a new response object, as you can only read the response body once.
    return new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  let htmlExtracts
  let player

  try {
    htmlExtracts = await getWatchHTMLWatchPage(id, fetchFunc)
    responseTime = Date.now()
  } catch (error) {
    if (!error.isIpBlock) {
      throw error
    }

    watchPageIpBlocked = true

    try {
      const innertube = await createInnertube({
        withPlayer: true,
        generateSessionLocally: false,
        fetchFunc,
      })

      htmlExtracts = { session: innertube.session }
      player = innertube.session.player
    } catch (fallbackError) {
      fallbackError.isIpBlock = true
      throw fallbackError
    }
  }

  if (htmlExtracts.playerResponse) {
    paidPromotionDurationMs ??= getPaidPromotionDurationMs(htmlExtracts.playerResponse)
    isPremiere ??= getLocalPremiereState(htmlExtracts.playerResponse.videoDetails)
  }

  player ??= await Player.create(
    process.env.IS_ELECTRON ? new PlayerCache() : new UniversalCache(false),
    localApiFetch,
    undefined,
    // If we found the player ID in the HTML we can pass it in to save one request inside Player.create()
    htmlExtracts.playerId
  )
  htmlExtracts.session.player = player

  // based on the videoId
  let contentPoToken

  if ((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && !watchPageIpBlocked) {
    try {
      contentPoToken = await generateContentPoToken(
        id,
        htmlExtracts.session.context,
        htmlExtracts.initialAttestationData,
        htmlExtracts.ytConfig
      )

      player.po_token = contentPoToken
    } catch (error) {
      console.error('Local API, poToken generation failed', error)
      throw error
    }
  }

  // The current WEB player response does not include the paid-promotion
  // disclosure. ANDROID exposes it as a lightweight player overlay, so fetch
  // that metadata in parallel; a failure must not fail the video load.
  const paidPromotionRequest = htmlExtracts.session.actions.execute('/player', {
    videoId: id,
    client: 'ANDROID',
    racyCheckOk: true,
    contentCheckOk: true,
    playbackContext: {
      contentPlaybackContext: {
        signatureTimestamp: player.signature_timestamp
      }
    },
    parse: false,
  }).catch(() => null)

  let playerResponse
  let nextResponse
  const context = htmlExtracts.session.context

  if (htmlExtracts.playerResponse) {
    playerResponse = { data: htmlExtracts.playerResponse }
  } else {
    playerResponse = await htmlExtracts.session.actions.execute('/player', {
      videoId: id,
      racyCheckOk: true,
      contentCheckOk: true,
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: '-1',
          signatureTimestamp: player.signature_timestamp
        }
      },
      serviceIntegrityDimensions: {
        poToken: contentPoToken
      }
    })
  }

  const musicMediaTypeRequest = resolveMusicMediaType(
    playerResponse,
    htmlExtracts.session.actions,
    id
  )

  if (htmlExtracts.nextResponse) {
    nextResponse = { data: htmlExtracts.nextResponse }
  } else {
    nextResponse = await htmlExtracts.session.actions.execute('/next', {
      videoId: id,
      racyCheckOk: true,
      contentCheckOk: true
    })
  }

  const cpn = Utils.generateRandomString(16)

  const info = new YT.VideoInfo([playerResponse, nextResponse], htmlExtracts.session.actions, cpn)
  const musicMediaType = await musicMediaTypeRequest
  const androidPlayerResponse = await paidPromotionRequest
  let androidLiveHlsManifestUrl = getAndroidLiveHlsManifestUrl(androidPlayerResponse)
  if (androidLiveHlsManifestUrl !== null) {
    try {
      androidLiveHlsManifestUrl = await decipherManifestUrl(
        androidLiveHlsManifestUrl,
        player,
        contentPoToken,
        false
      )
    } catch (error) {
      console.warn('Failed to decipher the Android live HLS fallback', error)
      androidLiveHlsManifestUrl = null
    }
  }
  const totalAdTimeMilliseconds = extractTotalAdTimeMilliseconds(playerResponse.data)

  // Some time would be used for parsing and maybe additional requests so end time should be calculated sooner to reduce actual waiting time
  // Legacy format requires this
  const adEndTimeUnixMs = responseTime + totalAdTimeMilliseconds

  let { clientName, clientVersion, osName, osVersion } = context.client

  let hasTrailer = info.has_trailer
  let trailerIsAgeRestricted = info.getTrailerInfo() === null

  if (
    ((info.playability_status.status === 'UNPLAYABLE' || info.playability_status.status === 'LOGIN_REQUIRED') &&
      info.playability_status.reason === 'Sign in to confirm your age') ||
    (hasTrailer && trailerIsAgeRestricted)
  ) {
    try {
      const webEmbeddedInnertube = await createInnertube({ clientType: ClientType.WEB_EMBEDDED })
      webEmbeddedInnertube.session.context.client.visitorData = context.client.visitorData

      const videoId = hasTrailer && trailerIsAgeRestricted ? info.playability_status.error_screen.video_id : id

      // getBasicInfo needs the signature timestamp (sts) from inside the player
      webEmbeddedInnertube.session.player = player

      const bypassedInfo = await webEmbeddedInnertube.getBasicInfo(videoId, { client: 'WEB_EMBEDDED', po_token: contentPoToken })

      if (bypassedInfo.playability_status.status === 'OK' && bypassedInfo.streaming_data) {
        info.playability_status = bypassedInfo.playability_status
        info.streaming_data = bypassedInfo.streaming_data
        info.basic_info.start_timestamp = bypassedInfo.basic_info.start_timestamp
        info.basic_info.duration = bypassedInfo.basic_info.duration
        info.captions = bypassedInfo.captions
        info.storyboards = bypassedInfo.storyboards

        hasTrailer = false
        trailerIsAgeRestricted = false;

        ({ clientName, clientVersion, osName, osVersion } = webEmbeddedInnertube.session.context.client)
      }
    } catch (error) {
      console.warn('WEB_EMBEDDED fallback errored, using the original response instead', error)
    }
  }

  const clientInfo = {
    clientName: Constants.CLIENT_NAME_IDS[clientName],
    clientVersion,
    osName,
    osVersion
  }

  if ((info.playability_status.status === 'UNPLAYABLE' && (!hasTrailer || trailerIsAgeRestricted)) ||
    info.playability_status.status === 'LOGIN_REQUIRED') {
    return {
      info,
      poToken: undefined,
      clientInfo,
      paidPromotionDurationMs,
      isPremiere,
      androidLiveHlsManifestUrl,
      watchPageIpBlocked,
      musicMediaType,
    }
  }

  if (hasTrailer && info.playability_status.status !== 'OK') {
    const trailerInfo = info.getTrailerInfo()

    // don't override the timestamp of when the video will premiere for upcoming videos
    if (info.playability_status.status !== 'LIVE_STREAM_OFFLINE') {
      info.basic_info.start_timestamp = trailerInfo.basic_info.start_timestamp
    }

    info.playability_status = trailerInfo.playability_status
    info.streaming_data = trailerInfo.streaming_data
    info.basic_info.duration = trailerInfo.basic_info.duration
    info.captions = trailerInfo.captions
    info.storyboards = trailerInfo.storyboards
  }

  if (info.streaming_data) {
    await decipherFormats(info.streaming_data.formats, player)

    if (info.streaming_data.server_abr_streaming_url) {
      info.streaming_data.server_abr_streaming_url = await player.decipher(info.streaming_data.server_abr_streaming_url)
    }

    if (info.streaming_data.dash_manifest_url) {
      info.streaming_data.dash_manifest_url = await decipherManifestUrl(
        info.streaming_data.dash_manifest_url,
        player,
        contentPoToken,
        true
      )
    }

    if (info.streaming_data.hls_manifest_url) {
      info.streaming_data.hls_manifest_url = await decipherManifestUrl(
        info.streaming_data.hls_manifest_url,
        player,
        contentPoToken,
        false
      )
    }
  }

  if (info.captions?.caption_tracks) {
    for (const captionTrack of info.captions.caption_tracks) {
      const url = new URL(captionTrack.base_url)

      url.searchParams.set('potc', '1')
      url.searchParams.set('pot', contentPoToken)
      url.searchParams.set('c', clientName)

      // Remove &xosf=1 as it adds `position:63% line:0%` to the subtitle lines
      // placing them in the top right corner
      url.searchParams.delete('xosf')

      captionTrack.base_url = url.toString()
    }
  }

  return {
    info,
    poToken: contentPoToken,
    clientInfo,
    adEndTimeUnixMs,
    paidPromotionDurationMs,
    isPremiere,
    androidLiveHlsManifestUrl,
    watchPageIpBlocked,
    musicMediaType,
  }
}

/**
 * @type {object}
 */
function extractTotalAdTimeMilliseconds(json) {
  let totalAdTimeMilliseconds = 0

  if (Array.isArray(json.adSlots)) {
    for (const adSlot of json.adSlots) {
      if (adSlot.adSlotRenderer?.adSlotMetadata?.triggerEvent === 'SLOT_TRIGGER_EVENT_BEFORE_CONTENT') {
        const instreamVideoAdRenderer = adSlot.adSlotRenderer.fulfillmentContent?.fulfilledLayout?.playerBytesAdLayoutRenderer
          ?.renderingContent?.instreamVideoAdRenderer

        if (instreamVideoAdRenderer) {
          if (typeof instreamVideoAdRenderer.skipOffsetMilliseconds === 'number') {
            totalAdTimeMilliseconds += instreamVideoAdRenderer.skipOffsetMilliseconds
          } else if (instreamVideoAdRenderer.playerVars) {
            const match = instreamVideoAdRenderer.playerVars.match(/length_seconds=([\d.]+)/)

            if (match) {
              totalAdTimeMilliseconds += parseFloat(match[1]) * 1000
            }
          }
        }
      }
    }
  }

  return totalAdTimeMilliseconds
}

/**
 * @param {string} id
 * @returns {Promise<{videoId: string, title: string} | null>}
 */
export async function getLocalShortLinkedVideo(id) {
  const innertube = await createInnertube()
  const response = await innertube.actions.execute('/reel/reel_item_watch', {
    playerRequest: { videoId: id },
    disablePlayerResponse: true,
    parse: false,
  })

  return parseLocalShortLinkedVideo(response)
}

/** Fetch related metadata without player or stream setup. */
export async function getLocalRelatedVideos(id, safetyMode = false, signal) {
  const innertube = await createInnertube({
    safetyMode,
    signal,
  })
  const response = await innertube.actions.execute('/next', { videoId: id, parse: true })
  return response.contents_memo?.getType(YTNodes.CompactVideo, YTNodes.CompactMovie, YTNodes.LockupView)
    .filter(video => video.type !== 'LockupView' || ['VIDEO', 'STATION'].includes(video.content_type))
    .map(parseLocalWatchNextVideo).filter(Boolean) ?? []
}

const LOCAL_VIDEO_CHANNELS_CACHE_SIZE = 100
const LOCAL_VIDEO_CHANNELS_TIMEOUT_MS = 15_000
const localVideoChannelsCache = new Map()

/**
 * Loads only the watch-next metadata needed to resolve a video's channels.
 * Unlike getLocalVideoInfo, this avoids player setup, proof-token generation,
 * playback requests, and paid-promotion metadata.
 * @param {string} id
 * @returns {Promise<ReturnType<typeof parseLocalVideoChannels>>}
 */
export function getLocalVideoChannels(id) {
  const cachedRequest = localVideoChannelsCache.get(id)
  if (cachedRequest) {
    return cachedRequest
  }

  const request = (async () => {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), LOCAL_VIDEO_CHANNELS_TIMEOUT_MS)

    try {
      const innertube = await createInnertube({
        fetchFunc: (input, init) => localApiFetch(input, { ...init, signal: abortController.signal })
      })
      const response = await innertube.actions.execute('/next', {
        videoId: id,
        racyCheckOk: true,
        contentCheckOk: true,
        parse: true,
      })
      const secondaryInfo = response.contents_memo
        ?.getType(YTNodes.VideoSecondaryInfo)[0]

      return parseLocalVideoChannels({ secondary_info: secondaryInfo })
    } finally {
      clearTimeout(timeout)
    }
  })().catch((error) => {
    if (localVideoChannelsCache.get(id) === request) {
      localVideoChannelsCache.delete(id)
    }
    throw error
  })

  localVideoChannelsCache.set(id, request)
  if (localVideoChannelsCache.size > LOCAL_VIDEO_CHANNELS_CACHE_SIZE) {
    localVideoChannelsCache.delete(localVideoChannelsCache.keys().next().value)
  }
  return request
}

export { parseLocalVideoCollaborators } from '../video-collaborators'

/**
 * @param {string} id
 * @param {'TOP_COMMENTS' | 'NEWEST_FIRST' | undefined} sortBy
 * @param {string | undefined} commentId
 */
export async function getLocalComments(id, sortBy = undefined, commentId = undefined) {
  const innertube = await createInnertube({ generateSessionLocally: false })
  return innertube.getComments(id, sortBy, commentId)
}

/**
 * When the uploader turns comments off, YouTube replaces the comment section's
 * continuation with a message ("Comments are turned off."), so requesting the
 * comments would only ever return an empty page.
 *
 * @param {import('youtubei.js').YT.VideoInfo} videoInfo
 */
export function areLocalCommentsDisabled(videoInfo) {
  const itemSections = videoInfo.page[1]?.contents_memo?.get('ItemSection') ?? []

  const commentSection = itemSections.find(itemSection => {
    return itemSection.target_id === 'comments-section' || itemSection.target_id === 'comment-item-section'
  })

  if (!commentSection) {
    return false
  }

  return !commentSection.contents.some(node => node.type === 'ContinuationItem')
}

// I know `type & type` is typescript syntax and not valid jsdoc but I couldn't get @extends or @augments to work

/**
 * @typedef {object} _LocalFormat
 * @property {string} freeTubeUrl deciphered streaming URL, stored in a custom property so the DASH manifest generation doesn't break
 *
 * @typedef {Misc.Format & _LocalFormat} LocalFormat
 */

/**
 * @param {Misc.Format[]} formats
 * @param {import('youtubei.js').Player} player
 */
async function decipherFormats(formats, player) {
  for (const format of formats) {
    // toDash deciphers the format again, so if we overwrite the original URL,
    // it breaks because the n param would get deciphered twice and then be incorrect
    format.freeTubeUrl = await format.decipher(player)
  }
}

/**
 * @param {string} url
 * @param {import('youtubei.js').Player} player
 * @param {string} poToken
 * @param {boolean} isDash
 */
async function decipherManifestUrl(url, player, poToken, isDash) {
  const urlObject = new URL(url)

  if (urlObject.searchParams.size > 0) {
    urlObject.searchParams.set('pot', poToken)

    if (isDash) {
      urlObject.searchParams.set('mpd_version', '7')
    }

    return await player.decipher(urlObject.toString())
  }

  const pathPrefix = isDash ? '/api/manifest/dash' : '/api/manifest/hls_variant'

  // Convert path params to query params
  const pathParts = urlObject.pathname
    .replace(pathPrefix, '')
    .split('/')
    .filter(part => part.length > 0)

  urlObject.pathname = pathPrefix

  for (let i = 0; i + 1 < pathParts.length; i += 2) {
    urlObject.searchParams.set(pathParts[i], decodeURIComponent(pathParts[i + 1]))
  }

  // decipher
  const deciphered = await player.decipher(urlObject.toString())

  // convert query parameters back to path parameters
  const decipheredUrlObject = new URL(deciphered)

  for (const [key, value] of decipheredUrlObject.searchParams) {
    decipheredUrlObject.pathname += `/${key}/${encodeURIComponent(value)}`
  }

  decipheredUrlObject.search = ''
  decipheredUrlObject.pathname += `/pot/${encodeURIComponent(poToken)}`

  if (isDash) {
    decipheredUrlObject.pathname += '/mpd_version/7'
  }

  return decipheredUrlObject.toString()
}

/**
 * @param {string} url
 * @param {boolean} doLogError
 */
export async function getLocalChannelId(url, doLogError = false) {
  try {
    const innertube = await createInnertube()

    // Resolve URL and allow 1 redirect, as YouTube should just do 1
    // We want to avoid an endless loop
    for (let i = 0; i < 2; i++) {
      // resolveURL throws an error if the URL doesn't exist
      const navigationEndpoint = await innertube.resolveURL(url)

      if (navigationEndpoint.metadata.page_type === 'WEB_PAGE_TYPE_CHANNEL') {
        return navigationEndpoint.payload.browseId
      } else if (navigationEndpoint.metadata.page_type === 'WEB_PAGE_TYPE_UNKNOWN' && navigationEndpoint.payload.url?.startsWith('https://www.youtube.com/')) {
        // handle redirects like https://www.youtube.com/@wanderbots, which resolves to https://www.youtube.com/Wanderbots, which we need to resolve again
        url = navigationEndpoint.payload.url
      } else if (navigationEndpoint.payload.browseId === 'FEpost_detail') {
        // convert base64 params to string and get the channelid
        return atob(navigationEndpoint.payload.params).replaceAll(/[^\d\sA-Za-z-]/g, ' ').trim().split(' ').at(-1)
      }
    }
  } catch (e) {
    if (doLogError) {
      console.error(e)
    }
  }

  return null
}

/**
 * Returns the channel or the channel termination reason
 * @param {string} id
 * @param {AbortSignal} [signal]
 */
export async function getLocalChannel(id, signal) {
  const innertube = await createInnertube({ signal })
  let result
  try {
    result = await innertube.getChannel(id)
  } catch (error) {
    if (error instanceof Utils.ChannelError) {
      result = {
        alert: error.message
      }
    } else {
      throw error
    }
  }
  return result
}

/**
 * @param {string} id
 * @param {boolean} [safetyMode]
 * @param {AbortSignal} [signal]
 */
export async function getLocalChannelVideos(id, safetyMode = false, signal) {
  const innertube = await createInnertube({
    safetyMode,
    signal,
  })

  try {
    const response = await innertube.actions.execute('/browse', {
      browseId: id,
      params: 'EgZ2aWRlb3PyBgQKAjoA'
      // protobuf for the videos tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    const videosTab = new YT.Channel(null, response)
    const { id: channelId = id, name, thumbnailUrl } = parseLocalChannelHeader(videosTab, true)

    let videos

    // if the channel doesn't have a videos tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (videosTab.current_tab?.endpoint.metadata.url?.endsWith('/videos')) {
      videos = parseLocalChannelVideos(videosTab.videos, channelId, name)
    } else if (name.endsWith('- Topic') && !!videosTab.metadata.music_artist_name) {
      try {
        const playlist = await innertube.getPlaylist(getChannelPlaylistId(channelId, 'videos', 'newest'))

        videos = parseLocalPlaylistVideos(playlist.items)
      } catch (error) {
        // If the channel doesn't exist, the API call to channel page above would have already failed,
        // so if we get an error that the playlist doesn't exist here, it just means that this artist topic channel
        // doesn't have any videos.
        if (error.message === 'The playlist does not exist.') {
          videos = []
        } else {
          throw error
        }
      }
    } else {
      videos = []
    }

    return {
      name,
      thumbnailUrl,
      videos
    }
  } catch (error) {
    if (!signal?.aborted) console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

/**
 * @param {string} id
 * @param {AbortSignal} [signal]
 */
export async function getLocalChannelLiveStreams(id, signal) {
  const innertube = await createInnertube({ signal })

  try {
    const response = await innertube.actions.execute('/browse', {
      browseId: id,
      params: 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D'
      // protobuf for the live tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    let liveStreamsTab = new YT.Channel(innertube.actions, response)
    const { id: channelId = id, name, thumbnailUrl } = parseLocalChannelHeader(liveStreamsTab, true)

    let videos

    // if the channel doesn't have a live tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (liveStreamsTab.current_tab?.endpoint.metadata.url?.endsWith('/streams')) {
      // work around YouTube bug where it will return a bunch of responses with only continuations in them
      // e.g. https://www.youtube.com/@TWLIVES/streams

      let tempVideos = liveStreamsTab.videos
      while (tempVideos.length === 0 && liveStreamsTab.has_continuation) {
        liveStreamsTab = await liveStreamsTab.getContinuation()
        tempVideos = liveStreamsTab.videos
      }

      videos = parseLocalChannelVideos(tempVideos, channelId, name)
    } else {
      videos = []
    }

    return {
      name,
      thumbnailUrl,
      videos
    }
  } catch (error) {
    console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

export async function getLocalChannelCommunity(id, signal) {
  const innertube = await createInnertube({ signal })

  try {
    const response = await innertube.actions.execute('/browse', {
      browseId: id,
      params: 'EgVwb3N0c_IGBAoCSgA%3D'
      // protobuf for the community tab (this is the one that YouTube uses,
      // it has some empty fields in the protobuf but it doesn't work if you remove them)
    })

    const communityTab = new YT.Channel(null, response)

    // if the channel doesn't have a community tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (communityTab.current_tab?.endpoint.metadata.url?.endsWith('/posts')) {
      return parseLocalCommunityPosts(communityTab.posts)
    } else {
      return []
    }
  } catch (error) {
    console.error(error)
    if (error instanceof Utils.ChannelError) {
      return null
    } else {
      throw error
    }
  }
}

/**
 * @param {YT.Channel} channel
 */
export async function getLocalArtistTopicChannelReleases(channel) {
  const rawEngagementPanel = channel.shelves[0]?.menu?.top_level_buttons?.[0]?.endpoint.payload?.engagementPanel

  if (!rawEngagementPanel) {
    return {
      releases: channel.playlists.map(playlist => parseLocalListPlaylist(playlist)),
      continuationData: null
    }
  }

  /** @type {import('youtubei.js').YTNodes.EngagementPanelSectionList} */
  const engagementPanelSectionList = Parser.parseItem(rawEngagementPanel)

  /** @type {import('youtubei.js').YTNodes.ContinuationItem|undefined} */
  const continuationItem = engagementPanelSectionList?.content?.contents?.[0]?.contents?.[0]

  if (!continuationItem) {
    return {
      releases: channel.playlists.map(playlist => parseLocalListPlaylist(playlist)),
      continuationData: null
    }
  }

  return await getLocalArtistTopicChannelReleasesContinuation(channel, continuationItem)
}

/**
 * @param {YT.Channel} channel
 * @param {import('youtubei.js').YTNodes.ContinuationItem} continuationData
 */
export async function getLocalArtistTopicChannelReleasesContinuation(channel, continuationData) {
  const response = await continuationData.endpoint.call(channel.actions, { parse: true })

  const memo = response.on_response_received_endpoints_memo

  const playlists = memo.get('GridPlaylist') ?? memo.get('LockupView') ?? memo.get('Playlist')

  /** @type {import('youtubei.js').YTNodes.ContinuationItem | null} */
  const continuationItem = memo.get('ContinuationItem')?.[0] ?? null

  return {
    releases: playlists ? playlists.map(playlist => parseLocalListPlaylist(playlist)) : [],
    continuationData: continuationItem
  }
}

/**
 * @param {YT.Search} response
 */
function handleSearchResponse(response) {
  if (!response.results) {
    return {
      results: [],
      continuationData: null
    }
  }

  const results = response.results
    .filter((item) => {
      return item.type === 'Video' || item.type === 'Channel' || item.type === 'Playlist' || item.type === 'HashtagTile' || item.type === 'Movie' || item.type === 'LockupView'
    })
    .map((item) => {
      const parsedItem = parseListItem(item)

      return parsedItem?.type === 'video' && typeof parsedItem.isShort !== 'boolean'
        ? { ...parsedItem, isShort: false }
        : parsedItem
    })
    .filter((item) => item)

  return {
    results,
    // check the length of the results, as there can be continuations for things that we've filtered out, which we don't want
    continuationData: response.has_continuation && results.length > 0 ? response : null
  }
}

/**
 * @param {import('youtubei.js').YT.Channel} homeTab
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
export function parseChannelHomeTab(homeTab, channelId, channelName) {
  /**
   * @type {import('youtubei.js').YTNodes.ItemSection | import('youtubei.js').YTNodes.RichSection}
   */
  let section
  const shelves = []
  for (section of homeTab.current_tab.content.contents) {
    if (section.type === 'ItemSection') {
      /**
       * @type {import('youtubei.js').YTNodes.ItemSection}
       */
      const itemSection = section
      if (itemSection.contents.at(0).type === 'Shelf') {
        /** @type {import('youtubei.js').YTNodes.Shelf} */
        const shelf = itemSection.contents.at(0)

        const playlistId = shelf.play_all_button?.endpoint.payload.playlistId

        const isMembersOnly = playlistId?.startsWith('UUMO') ?? false
        if (!shouldHideMembersOnlyContent(isMembersOnly, store.getters)) {
          shelves.push({
            title: shelf.title.text,
            content: shelf.content.items
              .map((item) => parseListItem(item, channelId, channelName))
              .filter(_ => _)
              .map(item => isMembersOnly && item.type === 'video'
                ? { ...item, isMembersOnly: true }
                : item),
            playlistId,
            subtitle: shelf.subtitle?.text
          })
        }
      } else if (itemSection.contents.at(0).type === 'ReelShelf') {
        /** @type {import('youtubei.js').YTNodes.ReelShelf} */
        const shelf = itemSection.contents.at(0)
        shelves.push({
          title: shelf.title.text,
          content: shelf.items.map((item) => parseListItem(item, channelId, channelName)).filter(_ => _)
        })
      } else if (itemSection.contents.at(0).type === 'HorizontalCardList') {
        /** @type {import('youtubei.js').YTNodes.HorizontalCardList} */
        const shelf = itemSection.contents.at(0)
        shelves.push({
          title: shelf.header.title.text,
          content: shelf.cards.map((item) => parseListItem(item, channelId, channelName)).filter(_ => _),
          subtitle: shelf.header.subtitle.text
        })
      }
    } else if (section.type === 'RichSection') {
      if (section.content.type === 'RichShelf') {
        /** @type {import('youtubei.js').YTNodes.RichShelf} */
        const shelf = section.content
        shelves.push({
          title: shelf.title?.text,
          content: shelf.contents.map(e => parseListItem(e.content, channelId, channelName)).filter(_ => _),
          subtitle: shelf.subtitle?.text,
          playlistId: shelf.endpoint?.metadata.url.includes('/playlist') ? shelf.endpoint?.metadata.url.replace('/playlist?list=', '') : null
        })
      }
    }
  }

  shelves.forEach(e => {
    e['isCommunity'] = e.content.at(0)?.type === 'community'
  })
  return shelves
}

// Sometimes got `Streamed N (unit) ago`

/**
 * @param {import('youtubei.js').Helpers.YTNode} item
 * @param {string} [channelId]
 * @param {string} [channelName]
 */
function parseListItem(item, channelId, channelName) {
  switch (item.type) {
    case 'Movie':
    case 'Video':
    case 'GridVideo':
    case 'GridMovie':
    case 'VideoCard':
      return parseLocalListVideo(item, channelId, channelName)
    case 'GameCard': {
      /** @type {import('youtubei.js').YTNodes.GameCard} */
      const channel = item
      /** @type {import('youtubei.js').YTNodes.GameDetails} */
      const game = channel.game
      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: game.box_art.at(0).url.replace(/^\/\//, 'https://'),
        name: game.title.text,
        id: game.endpoint.payload.browseId,
        isGame: true
      }
    }
    case 'GridChannel': {
      /** @type {import('youtubei.js').YTNodes.GridChannel} */
      const channel = item
      let subscribers = null

      if (channel.subscribers?.text) {
        subscribers = parseLocalSubscriberCount(channel.subscribers.text)
      }

      const videos = extractNumberFromString(channel.video_count.text)

      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: channel.author.best_thumbnail?.url.replace(/^\/\//, 'https://'),
        name: channel.author.name,
        id: channel.author.id,
        subscribers,
        videos,
        handle: null,
        descriptionShort: channel.description_snippet?.text
      }
    }
    case 'Channel': {
      /** @type {import('youtubei.js').YTNodes.Channel} */
      const channel = item

      // see upstream TODO: https://github.com/LuanRT/YouTube.js/blob/main/src/parser/classes/Channel.ts#L33

      // according to https://github.com/iv-org/invidious/issues/3514#issuecomment-1368080392
      // the response can be the new or old one, so we currently need to handle both here
      let subscribers = null
      let videos = null
      let handle = null
      if (channel.subscriber_count.text?.startsWith('@')) {
        handle = channel.subscriber_count.text

        if (!channel.video_count.isEmpty()) {
          subscribers = parseLocalSubscriberCount(channel.video_count.text)
        }
      } else {
        videos = extractNumberFromString(channel.video_count.text)

        if (!channel.subscriber_count.isEmpty()) {
          subscribers = parseLocalSubscriberCount(channel.subscriber_count.text)
        }
      }

      return {
        type: 'channel',
        dataSource: 'local',
        thumbnail: channel.author.best_thumbnail?.url.replace(/^\/\//, 'https://'),
        name: channel.author.name,
        id: channel.author.id,
        subscribers,
        videos,
        handle,
        descriptionShort: channel.description_snippet.text
      }
    }
    case 'HashtagTile': {
      /** @type {import('youtubei.js').YTNodes.HashtagTile} */
      const hashtag = item

      return {
        type: 'hashtag',
        title: hashtag.hashtag.text,
        videoCount: hashtag.hashtag_video_count.isEmpty() ? null : parseLocalSubscriberCount(hashtag.hashtag_video_count.text),
        channelCount: hashtag.hashtag_channel_count.isEmpty() ? null : parseLocalSubscriberCount(hashtag.hashtag_channel_count.text)
      }
    }
    case 'ReelItem':
    case 'ShortsLockupView': {
      return parseShort(item, channelId, channelName)
    }
    case 'CompactStation':
    case 'GridPlaylist':
    case 'Playlist': {
      return parseLocalListPlaylist(item, channelId, channelName)
    }
    case 'Post': {
      return parseLocalCommunityPost(item)
    }
    case 'LockupView':
      return parseLockupView(item, channelId, channelName)
  }
}

/**
 * @param {YTNodes.CompactVideo | YTNodes.CompactMovie | YTNodes.LockupView} video
 */
export function parseLocalWatchNextVideo(video) {
  if (video.is(YTNodes.CompactMovie)) {
    return {
      type: 'video',
      videoId: video.id,
      thumbnailPreviewUrl: getThumbnailPreviewUrl(video),
      title: video.title.text?.trim(),
      author: video.author.name,
      authorId: video.author.id,
      lengthSeconds: video.duration.seconds
    }
  } else if (video.is(YTNodes.LockupView)) {
    return parseLockupView(video)
  } else {
    let publishedText

    if (video.published != null && !video.published.isEmpty()) {
      publishedText = video.published.text
    }

    const published = calculatePublishedDate(publishedText, video.is_live, video.is_premiere)

    return {
      type: 'video',
      videoId: video.video_id,
      thumbnailPreviewUrl: getThumbnailPreviewUrl(video),
      title: video.title.text?.trim(),
      author: video.author.name,
      authorId: video.author.id,
      viewCount: video.view_count == null ? null : extractNumberFromString(video.view_count.text),
      published,
      lengthSeconds: isNaN(video.duration.seconds) ? '' : video.duration.seconds,
      liveNow: video.is_live,
      isPremiere: video.is_premiere,
      isUpcoming: video.is_premiere
    }
  }
}

/**
 * @param {YTNodes.Endscreen | undefined} endscreen
 */
export function parseLocalEndscreen(endscreen) {
  if (!endscreen) {
    return []
  }

  return endscreen.elements.map((element) => {
    const payload = element.endpoint.payload
    let route

    if (element.style === 'PLAYLIST' && payload.playlistId) {
      route = `/playlist/${payload.playlistId}`
    } else if (element.endpoint.name === 'watchEndpoint' && payload.videoId) {
      route = {
        path: `/watch/${payload.videoId}`,
        query: payload.playlistId ? { playlistId: payload.playlistId } : undefined
      }
    } else if (element.endpoint.name === 'watchEndpoint' && payload.playlistId) {
      route = `/playlist/${payload.playlistId}`
    } else if (element.endpoint.name === 'watchPlaylistEndpoint' && payload.playlistId) {
      route = `/playlist/${payload.playlistId}`
    } else if (element.endpoint.name === 'browseEndpoint' && payload.browseId) {
      route = element.style === 'CHANNEL'
        ? `/channel/${payload.browseId}`
        : `/playlist/${payload.browseId}`
    }

    const startTime = element.start_ms / 1000
    const endTime = element.end_ms / 1000
    const thumbnail = element.image?.find((image) => image.width <= 480)?.url ?? element.image?.at(-1)?.url
    const hasValidGeometry = [element.left, element.top, element.width, element.aspect_ratio]
      .every((value) => Number.isFinite(value))

    if (!route || !thumbnail || !hasValidGeometry || element.width <= 0 || element.aspect_ratio <= 0 ||
        !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
      return null
    }

    const durationOverlay = element.thumbnail_overlays
      ?.find((overlay) => overlay.is(YTNodes.ThumbnailOverlayTimeStatus))

    return {
      id: element.id,
      type: element.style,
      title: element.title.text,
      videoId: element.style === 'VIDEO' ? payload.videoId : undefined,
      thumbnail,
      channelId: element.style === 'CHANNEL' ? payload.browseId : undefined,
      description: element.style === 'CHANNEL' ? element.metadata?.text ?? '' : '',
      badge: durationOverlay?.text ?? element.playlist_length?.text ?? '',
      route,
      left: element.left,
      top: element.top,
      width: element.width,
      aspectRatio: element.aspect_ratio,
      startTime,
      endTime
    }
  }).filter((annotation) => annotation !== null)
}

function convertSearchFilters(filters) {
  const convertedFilters = {}

  // some of the fields have different names and
  // others have empty strings that we don't want to pass to youtubei.js

  if (filters) {
    if (filters.prioritize) {
      convertedFilters.prioritize = filters.prioritize
    }

    if (filters.time) {
      convertedFilters.upload_date = filters.time
    }

    if (filters.type) {
      convertedFilters.type = filters.type
    }

    if (filters.duration) {
      convertedFilters.duration = filters.duration
    }

    if (filters.features) {
      convertedFilters.features = filters.features
    }
  }

  return convertedFilters
}

/**
 * Recreates the audio track information that YouTube's local API returns for videos
 * with multiple audio tracks, for backends that don't provide it themselves.
 * @param {import('youtubei.js').Misc.Format} format
 * @param {Intl.DisplayNames} languageNames
 */
export function generateAudioTrackField(format, languageNames) {
  // `Intl.DisplayNames` throws for anything that isn't a valid language tag.
  // YouTube leaves the track information off the audio streams it can't label
  // either, which players treat as the track to ignore.
  if (!format.language) {
    return
  }

  let type

  // use the same id numbers as YouTube (except -1, when we aren't sure what it is)
  let idNumber

  if (format.is_descriptive) {
    type = ' descriptive'
    idNumber = 2
  } else if (format.is_dubbed) {
    type = ''
    idNumber = 3
  } else if (format.is_original) {
    type = ' original'
    idNumber = 4
  } else if (format.is_secondary) {
    type = ' secondary'
    idNumber = 6
  } else if (format.is_auto_dubbed) {
    type = ''
    idNumber = 10
  } else {
    type = ' alternative'
    idNumber = -1
  }

  const languageName = languageNames.of(format.language)

  format.audio_track = {
    audio_is_default: !!format.is_original,
    id: `${format.language}.${idNumber}`,
    display_name: `${languageName}${type}`
  }
}

/**
 * @param {LocalFormat} format
 */
export function mapLocalLegacyFormat(format) {
  return {
    itag: format.itag,
    qualityLabel: format.quality_label,
    fps: format.fps,
    bitrate: format.bitrate,
    mimeType: format.mime_type,
    height: format.height,
    width: format.width,
    url: format.freeTubeUrl
  }
}

/**
 * The complete Triforce, or one or more components of the Triforce.
 * @typedef {object} LocalComment
 * @property {string} id
 * @property {string} dataType
 * @property {string} authorLink
 * @property {string} author
 * @property {string} authorId
 * @property {string} authorThumb
 * @property {boolean} isPinned
 * @property {boolean} isOwner
 * @property {boolean} isMember
 * @property {string} text
 * @property {string} translationText
 * @property {boolean} isHearted
 * @property {boolean} hasOwnerReplied
 * @property {boolean} hasReplyToken
 * @property {CommentThread} replyToken
 * @property {boolean} showReplies
 * @property {LocalComment[]} replies
 * @property {string} memberIconUrl
 * @property {string} time
 * @property {number} published
 * @property {boolean} isEdited
 * @property {number} likes
 * @property {number} numReplies
 */
/**
 * @param {import('youtubei.js').YTNodes.CommentView} comment
 * @param {import('youtubei.js').YTNodes.CommentThread} commentThread
 * @return LocalComment
 */
export function parseLocalComment(comment, commentThread = undefined) {
  let hasOwnerReplied = false
  let replyToken = null
  let hasReplyToken = false

  if (commentThread?.has_replies) {
    hasOwnerReplied = !!commentThread.comment_replies_data?.has_channel_owner_replied
    replyToken = commentThread
    hasReplyToken = true
  }

  const commentTextRuns = comment.voice_reply_container?.transcript_text?.runs ?? comment.content?.runs ?? []
  const publishedText = comment.published_time ?? ''
  const published = calculatePublishedDate(publishedText.replace('(edited)', '').trim())
  const authorId = comment.author?.id ?? ''

  return {
    id: comment.comment_id,
    dataType: 'local',
    authorLink: authorId,
    author: comment.author?.name ?? '',
    authorId,
    authorThumb: comment.author?.best_thumbnail?.url ?? '',
    isPinned: comment.is_pinned,
    isOwner: !!comment.author_is_channel_owner,
    isMember: !!comment.is_member,
    text: Autolinker.link(parseLocalTextRuns(commentTextRuns, 16, { looseChannelNameDetection: true })),
    translationText: getCommentTranslationSource(commentTextRuns),
    isHearted: !!comment.is_hearted,
    hasOwnerReplied,
    hasReplyToken,
    replyToken,
    showReplies: false,
    replies: [],
    memberIconUrl: comment.member_badge?.url ?? '',
    time: getRelativeTimeFromDate(published, false),
    published,
    isEdited: publishedText.includes('(edited)'),
    likes: parseLocalSubscriberCount(String(comment.like_count ?? '0').trim() || '0'),
    numReplies: hasReplyToken
      ? parseLocalSubscriberCount(String(comment.reply_count_a11y ?? comment.reply_count ?? '0'))
      : 0
  }
}

export async function getHashtagLocal(hashtag) {
  const innertube = await createInnertube()
  return await innertube.getHashtag(hashtag)
}

export async function getLocalCommunityPost(postId, channelId) {
  const innertube = await createInnertube()
  if (channelId == null) {
    channelId = await getLocalChannelId('https://www.youtube.com/post/' + postId, true)
  }

  const postPage = await innertube.getPost(postId, channelId)
  return parseLocalCommunityPost(postPage.posts[0])
}

/**
 * @param {string} postId
 * @param {string} channelId
 */
export async function getLocalCommunityPostComments(postId, channelId) {
  const innertube = await createInnertube({ generateSessionLocally: false })

  return await innertube.getPostComments(postId, channelId)
}
