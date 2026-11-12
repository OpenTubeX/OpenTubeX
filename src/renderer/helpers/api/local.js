import { normalizeCommentFetchResponse, parseLocalCommentImageAttachment } from './local-comment-response'
import { createLocalFeedParsers, getAuthorVerification, getChannelHandleFromEndpoint, getLocalMusicChartPlaylistId } from './local-feed-parsers'
import { createOriginalChannelNameResolver } from './original-channel-name'
import { fetchMissingPublicationDates } from './missing-publication.js'
import { runBackgroundJob } from '../background-jobs.js'
import { ClientType, Constants, Innertube, Mixins, Parser, Platform, Player, Session, UniversalCache, Utils, YT, YTNodes } from 'youtubei.js'
import Autolinker from 'autolinker'
import { parseLooseJSON } from 'bgutils-js/utils'

import { checkHistoryRepairResponse } from '../../../historyRepair'

import { SEARCH_CHAR_LIMIT } from '../../../constants'
import store from '../../store/index'
import { PlayerCache } from './PlayerCache'
import { createBackgroundPlayer } from './background-player.js'
import { loadSearchContinuation } from '../search-continuation'
import { disableSearchSpellCorrection, parseSearchCorrection } from '../search-correction'
import {
  getCommentTranslationSource,
  requestCommentTranslation
} from '../comment-translations'
import { parseLocalShortLinkedVideo } from '../player/shorts'
import { getPaidPromotionDurationMs } from '../player/paidPromotion'
import { classifyMusicMediaType, MUSIC_MEDIA_TYPE } from '../player/musicMediaType'
import { getLocalPremiereState } from '../premiere'
import { getAndroidLiveDashManifestUrl, getAndroidLiveHlsManifestUrl, getLiveDvrEnabled } from '../player/liveManifest'
import { shouldHideMembersOnlyContent } from '../restricted-playback'
import { getThumbnailPreviewUrl } from '../thumbnailPreview'
import { normalizeVideoPopularityResponse } from '../player/videoPopularity'
import { parseLocalCollaboratorItems, parseLocalVideoChannels } from '../video-collaborators'

import { evaluatePlayerScript, generateContentPoToken, mintContentPoTokenFromAttestation, prewarmPlayerScriptEvaluator } from './local-api-platform'
import { disableDirectPlayer, getDirectPlayerFallbackReason, isDirectPlayerEnabled } from './direct-player.js'
import { getVisionOsStreamsFallbackReason, isVisionOsStreamsEnabled } from './visionos-streams.js'
import { classifyRequestFailure } from './requestDiagnostics.js'
import { calculatePublishedDate, deepCopy, extractNumberFromString, getChannelPlaylistId, getRelativeTimeFromDate } from '../utils'

const {
  normalizeLocalSubscriptionFeed,
  parseLocalPlaylistVideos,
  parseLocalPlaylistVideo,
  parseLockupView,
  parseLocalSubscriberCount,
  parseLocalHashtagHeader,
  parseLocalChannelHeader,
  parseLocalChannelShorts,
  parseShort,
  parseLocalCommunityPosts,
  parseLocalCommunityPost,
  parseLocalTextRuns,
  parseLocalListVideo,
  parseLocalListPlaylist,
  parseLocalListPlaylists,
  parseLocalChannelVideos
} = createLocalFeedParsers(isMembersOnly => shouldHideMembersOnlyContent(isMembersOnly, store.getters))
export { normalizeLocalSubscriptionFeed, parseLocalPlaylistVideos, parseLocalPlaylistVideo, parseLocalSubscriberCount, parseLocalHashtagHeader, parseLocalChannelHeader, parseLocalChannelShorts, parseShort, parseLocalCommunityPosts, parseLocalTextRuns, parseLocalListVideo, parseLocalListPlaylist, parseLocalListPlaylists, parseLocalChannelVideos }

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

  if (!process.env.IS_ELECTRON) {
    // Firefox sends a script's User-Agent header, which makes every request a
    // preflighted one, and YouTube rejects preflights outside its API.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.delete('user-agent')
    // The browser extension allows any origin to read YouTube's responses,
    // which browsers only accept for requests without credentials. It also
    // keeps the browser's YouTube cookies out of these requests.
    return await fetch(input, { ...init, headers, credentials: 'omit' })
  }

  return await fetch(input, init)
}

export const getOriginalChannelName = createOriginalChannelNameResolver(localApiFetch)

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
  let sessionFetch = fetch
  if (signal) {
    sessionFetch = (input, init) => {
      const requestSignal = init?.signal ?? input?.signal
      return fetch(input, {
        ...init,
        signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal
      })
    }
  }

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
    fetch: sessionFetch,
    cache,
    generate_session_locally: !!generateSessionLocally
  })
}

/**
 * @param {string} query
 * @param {AbortSignal} [signal]
 */
export async function getLocalSearchSuggestions(query, signal) {
  // The suggestions endpoint rejects queries longer than SEARCH_CHAR_LIMIT.
  if (query.length > SEARCH_CHAR_LIMIT) return []

  // Sessions are generated locally. Bind each query's transport to its lifetime
  // so superseded requests can leave the network-recovery queue immediately.
  const innertube = await createInnertube({ signal })
  return await innertube.getSearchSuggestions(query)
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

export async function getLocalPlaylist(id, signal) {
  const innertube = await createInnertube({ signal })
  return await innertube.getPlaylist(id)
}

/**
 * Playlists without an author link name their channel in the subtitle.
 * @param {import('youtubei.js').YT.Playlist['info']} info
 */
export function getLocalPlaylistChannelName(info) {
  if (info.author) return info.author.name

  const subtitle = info.subtitle?.toString()
  if (!subtitle) return ''
  return subtitle.substring(0, subtitle.lastIndexOf('•')).trim()
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
 * @param {string} location
 * @param {'gaming' | 'music' | 'sports' | 'podcasts'} tab
 */
export async function getLocalTrending(location, tab) {
  const innertube = await createInnertube({ location })

  let args

  switch (tab) {
    case 'music': {
      // https://music.youtube.com/charts
      // The charts ignore the session location and use the requester's IP unless a country is selected.
      // Unsupported countries return the global charts.
      const charts = await innertube.actions.execute('/browse', {
        browseId: 'FEmusic_charts',
        formData: { selectedValues: [location] },
        client: 'YTMUSIC',
        parse: true
      })
      const playlistId = getLocalMusicChartPlaylistId(charts)

      if (!playlistId) {
        throw new Error('No music chart found')
      }

      const playlist = await innertube.getPlaylist(playlistId)
      return parseLocalPlaylistVideos(playlist.items)
    }
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
 * @param {boolean} [spellCorrection]
 */
export async function getLocalSearchResults(query, filters, safetyMode, signal, spellCorrection = true) {
  let searchParams = ''
  const innertube = await createInnertube({
    safetyMode,
    signal,
    fetchFunc: (input, init) => {
      if (new URL(input instanceof Request ? input.url : input).pathname === '/youtubei/v1/search') {
        const body = JSON.parse(init.body)
        // Continuation requests carry no params.
        if (!spellCorrection && body.params) {
          body.params = disableSearchSpellCorrection(body.params)
          init = { ...init, body: JSON.stringify(body) }
        }
        // Reuse YouTube.js' encoded filters for an explicit yt-dlp retry.
        searchParams = body.params ?? ''
      }
      return localApiFetch(input, init)
    },
  })
  const response = await innertube.search(query, convertSearchFilters(filters))

  return {
    ...handleSearchResponse(response),
    searchCorrection: parseSearchCorrection(response.results),
    searchParams
  }
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
  const timeZone = process.env.IS_ELECTRON ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined
  // This returns session/tracking cookies but they get removed in onHeadersReceived in the main process before they are saved by Electron
  const htmlResponse = await fetchFunc(url,
    {
      // These pages only redirect to YouTube's rate limit flow. Following it can
      // loop between the captcha and exemption pages, because these requests
      // do not keep cookies, and Electron retries the resulting fetch error as
      // a lost connection, which stalls every YouTube request for minutes.
      redirect: 'manual',
      headers: {
        // We need to be able to parse the localised strings in the /next response data (e.g. view counts and published dates)
        'Accept-Language': 'en-US',
        ...(
          // The "Cookie" header is forbidden by the fetch spec, so we set it as X-Cookie here
          // and then convert it to the Cookie header in the main process
          timeZone
            ? {
                'X-Cookie': `PREF=tz=${timeZone.replace('/', '.')}`
              }
            : {}
        )
      }
    }
  )

  // Browsers hide manual redirects behind an opaque status 0 response.
  const redirected = htmlResponse.type === 'opaqueredirect' || (htmlResponse.status >= 300 && htmlResponse.status < 400)
  const isIpBlockResponse = redirected || htmlResponse.status === 429

  if (!htmlResponse.ok) {
    const error = new Error(redirected
      ? `YouTube redirected the ${kind} HTML page`
      : `YouTube returned HTTP ${htmlResponse.status} for the ${kind} HTML page`)
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
  lastWatchPageClient = { client: ytConfig.INNERTUBE_CONTEXT?.client, playerId }

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
 * Requests the panoramic HLS rendition without changing the metadata session.
 * @param {string} videoId
 * @param {import('youtubei.js').Session} session
 * @param {string | undefined} poToken
 */
async function getLocalVrHlsManifest(videoId, session, poToken) {
  const context = deepCopy(session.context)
  const vrSession = new Session(context, session.api_key, session.api_version,
    0, undefined, session.player, undefined, (input, init) => localApiFetch(input, {
      ...init, signal: AbortSignal.timeout(10000)
    }))
  try {
    const response = await vrSession.actions.execute('/player', {
      videoId,
      client: 'VISIONOS',
      racyCheckOk: true,
      contentCheckOk: true,
      playbackContext: { contentPlaybackContext: { signatureTimestamp: session.player.signature_timestamp } },
      serviceIntegrityDimensions: { poToken },
      parse: false,
    })
    const url = response.data.streamingData?.hlsManifestUrl
    return typeof url === 'string' ? await decipherManifestUrl(url, session.player, poToken, false) : null
  } catch (error) {
    console.warn('Built-in panoramic HLS extraction failed', error)
    return null
  }
}

/**
 * The client build and player of the last watch page. Sessions generated locally
 * copy the build, but not the identifiers that would link them to that session.
 * @type {{ client: any, playerId: string | undefined } | null}
 */
let lastWatchPageClient = null
const DIRECT_PLAYER_CLIENT_FIELDS = ['hl', 'gl', 'clientVersion', 'osName', 'osVersion', 'browserName', 'browserVersion', 'platform', 'clientFormFactor']

// visionOS usually answers within half a second. A slower answer delays the WEB streams' token.
const VISIONOS_STREAMS_TIMEOUT_MS = 5000

/** @type {Promise<string> | null} */
let spareVisitorData = null

/**
 * BotGuard's run for later direct /player requests. Minting from the
 * attestation would wait for it, so loads use the watch page meanwhile.
 * @type {Promise<unknown> | null}
 */
let backgroundAttestation = null

async function fetchVisitorData() {
  const response = await localApiFetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: Constants.CLIENTS.WEB.VERSION } } }),
    signal: AbortSignal.timeout(VISIONOS_STREAMS_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`visitor_id responded with HTTP ${response.status}`)
  const visitorData = (await response.json()).responseContext?.visitorData
  if (typeof visitorData !== 'string') throw new Error('visitor_id responded without visitor data')
  return visitorData
}

/**
 * The visionOS client refuses the visitor data of locally generated sessions,
 * so it uses one that YouTube issued. Each is only used for one video, which
 * keeps the requests of different videos unlinked. The next one is fetched
 * ahead, so only the first video waits for it.
 * @returns {Promise<string>}
 */
function takeVisitorData() {
  const visitorData = spareVisitorData ?? fetchVisitorData()
  spareVisitorData = null
  visitorData.then(() => {
    if (spareVisitorData) return
    const next = fetchVisitorData()
    spareVisitorData = next
    next.catch(() => {
      if (spareVisitorData === next) spareVisitorData = null
    })
  }, () => {})
  return visitorData
}

/**
 * Requests the visionOS client's /player response, whose direct streams need
 * neither a PO token nor the player script.
 * @param {string} videoId
 * @returns {Promise<any | null>} the raw response, `null` when it cannot provide the streams
 */
async function requestVisionOsStreams(videoId) {
  try {
    const signal = AbortSignal.timeout(VISIONOS_STREAMS_TIMEOUT_MS)
    const [visitorData, { session }] = await Promise.all([
      takeVisitorData(),
      createInnertube({ generateSessionLocally: true, signal })
    ])
    session.context.client.visitorData = visitorData
    // Keeps the caption and audio track names in the watch page's language
    for (const field of ['hl', 'gl']) {
      if (lastWatchPageClient?.client?.[field] !== undefined) session.context.client[field] = lastWatchPageClient.client[field]
    }

    const { data } = await session.actions.execute('/player', {
      videoId,
      client: 'VISIONOS',
      racyCheckOk: true,
      contentCheckOk: true,
      parse: false,
    })
    const fallbackReason = getVisionOsStreamsFallbackReason(data, videoId)
    if (fallbackReason !== null) {
      console.warn(`Using the WEB streams for ${videoId}: ${fallbackReason}`)
      return null
    }
    return data
  } catch (error) {
    console.warn(`Using the WEB streams for ${videoId}, as the visionOS request failed`, error)
    return null
  }
}

/**
 * Requests /player and /next directly with a locally generated session. The
 * watch page takes about a second longer, as YouTube only sends its end, with
 * the embedded responses, once /next is ready. Only BotGuard needs the page's
 * challenge, so this works once an attestation exists.
 * @param {string} videoId
 * @param {(input, init) => Promise<Response>} fetchFunc
 * @param {import('googlevideo/protos').ReloadPlaybackContext | undefined} reloadPlaybackContext
 * @returns {Promise<{ session: import('youtubei.js').Session, player: import('youtubei.js').Player, playerResponse: any, poToken: string, nextRequest: Promise<any> } | { fallbackReason: string, sessionWide: boolean } | null>}
 *   `null` without an attestation. A `sessionWide` fallback is YouTube's answer, not a lost connection.
 */
async function requestDirectPlayer(videoId, fetchFunc, reloadPlaybackContext) {
  if (backgroundAttestation) return null
  const poToken = await mintContentPoTokenFromAttestation(videoId).catch(() => null)
  if (!poToken) return null

  // Cancels /next when the watch page has to be loaded instead
  const abortController = new AbortController()
  try {
    const { session } = await createInnertube({ generateSessionLocally: true, fetchFunc, signal: abortController.signal })
    const client = lastWatchPageClient?.client
    for (const field of DIRECT_PLAYER_CLIENT_FIELDS) {
      if (client?.[field] !== undefined) session.context.client[field] = client[field]
    }

    const nextRequest = session.actions.execute('/next', { videoId, racyCheckOk: true, contentCheckOk: true })
    // A late failure is handled by the watch view, and a fallback discards it
    nextRequest.catch(() => {})

    const player = process.env.IS_ELECTRON
      ? await createBackgroundPlayer(new PlayerCache(), localApiFetch, lastWatchPageClient?.playerId, runBackgroundJob)
      : await Player.create(new UniversalCache(false), localApiFetch, undefined, lastWatchPageClient?.playerId)
    session.player = player

    const { data: playerResponse } = await session.actions.execute('/player', {
      videoId,
      racyCheckOk: true,
      contentCheckOk: true,
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          lactMilliseconds: '-1',
          signatureTimestamp: player.signature_timestamp
        },
        ...(reloadPlaybackContext && { reloadPlaybackContext })
      },
      serviceIntegrityDimensions: { poToken }
    })

    const fallbackReason = getDirectPlayerFallbackReason(playerResponse)
    if (fallbackReason !== null) {
      abortController.abort()
      return { fallbackReason, sessionWide: true }
    }
    return { session, player, playerResponse, poToken, nextRequest }
  } catch (error) {
    abortController.abort()
    return { fallbackReason: String(error?.message ?? error), sessionWide: classifyRequestFailure(error) === 'http' }
  }
}

/**
 * Adds the late /next response to a video info that was built without it.
 * @param {import('youtubei.js').YT.VideoInfo} info the processed video info
 * @param {{ data: any }} playerResponse the /player response it was built from
 * @param {{ data: any }} nextResponse
 * @param {import('youtubei.js').Actions} actions
 */
export function mergeLateWatchNext(info, playerResponse, nextResponse, actions) {
  normalizeVideoPopularityResponse(nextResponse.data)
  const merged = new YT.VideoInfo([playerResponse, nextResponse], actions, info.cpn)
  // The playback data was deciphered and adjusted after the player response arrived
  merged.playability_status = info.playability_status
  merged.streaming_data = info.streaming_data
  merged.captions = info.captions
  merged.storyboards = info.storyboards
  merged.basic_info.start_timestamp = info.basic_info.start_timestamp
  merged.basic_info.duration = info.basic_info.duration
  return {
    info: merged,
    contentDisclosures: extractLocalContentDisclosures(merged),
    infoPanels: extractLocalInfoPanels(merged),
  }
}

/**
 * @param {string} id
 * @param {{ shouldGeneratePoToken?: () => boolean, reloadPlaybackContext?: import('googlevideo/protos').ReloadPlaybackContext, lateWatchNext?: boolean }} [options]
 *   With `lateWatchNext`, a load that already has an attestation can skip the watch page.
 *   Its result then lacks the /next data, which `watchNextPromise` resolves to.
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
 *   paidPromotionPromise: Promise<number | null>,
 *   isPremiere: boolean | undefined,
 *   isLiveDvrEnabled: boolean | undefined,
 *   watchPageIpBlocked: boolean,
 *   androidLiveHlsManifestUrl: string | null,
 *   androidLiveDashManifestUrl: string | null,
 *   getVrHlsManifest: () => Promise<string | null>,
 *   refreshVisionOsStreams?: (() => Promise<import('youtubei.js').YT.VideoInfo | null>) | null,
 *   contentDisclosures: { label: string, description: string, attribution: string }[] | null,
 *   infoPanels: LocalInfoPanel[] | null,
 *   musicMediaType: import('../player/musicMediaType').MusicMediaType,
 *   watchNextPromise?: Promise<{ info: import('youtubei.js').YT.VideoInfo, contentDisclosures: { label: string, description: string, attribution: string }[] | null, infoPanels: LocalInfoPanel[] | null }>
 * }>}
 */
export async function getLocalVideoInfo(id, { shouldGeneratePoToken = () => true, reloadPlaybackContext, lateWatchNext = false } = {}) {
  let responseTime
  let paidPromotionDurationMs = null
  let isPremiere
  let watchPageIpBlocked = false

  const fetchFunc = async (input, init) => {
    if (!(input.url?.startsWith('https://www.youtube.com/youtubei/v1/player'))) {
      return localApiFetch(input, init)
    }

    const response = await localApiFetch(input, init)
    // youtubei.js reports a refusal with its HTTP status. An HTML error page
    // would only fail to parse here.
    if (!response.ok) return response
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

  // Deciphering the streams needs the interpreter right after the watch page loads
  prewarmPlayerScriptEvaluator()

  // Playback loads take their streams from visionOS while the metadata loads,
  // unless the user chose SABR. SABR reloads stay with the WEB streams that requested them.
  const visionOsStreamsRequest = lateWatchNext && !reloadPlaybackContext && store.getters.getBuiltInStreams !== 'sabr' &&
    isVisionOsStreamsEnabled() && shouldGeneratePoToken()
    ? requestVisionOsStreams(id)
    : Promise.resolve(null)

  let direct = null
  let directFallback = null
  if (lateWatchNext && isDirectPlayerEnabled() && shouldGeneratePoToken()) {
    direct = await requestDirectPlayer(id, fetchFunc, reloadPlaybackContext)
    if (direct && 'fallbackReason' in direct) {
      directFallback = direct
      console.warn(`Loading ${id} through the watch page instead of /player: ${directFallback.fallbackReason}`)
      direct = null
    }
  }

  try {
    if (direct) {
      htmlExtracts = { session: direct.session, playerResponse: direct.playerResponse }
      player = direct.player
      paidPromotionDurationMs ??= getPaidPromotionDurationMs(direct.playerResponse)
      isPremiere ??= getLocalPremiereState(direct.playerResponse.videoDetails)
    } else {
      htmlExtracts = await getWatchHTMLWatchPage(id, fetchFunc)
    }
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

  // Script setup and /next only depend on the HTML session. Start them together,
  // including when the player script is not cached yet.
  const playerReady = (async () => {
    player ??= process.env.IS_ELECTRON
      ? await createBackgroundPlayer(new PlayerCache(), localApiFetch, htmlExtracts.playerId, runBackgroundJob)
      : await Player.create(new UniversalCache(false), localApiFetch, undefined, htmlExtracts.playerId)
    htmlExtracts.session.player = player
  })()

  // The current WEB player response does not include the paid-promotion
  // disclosure. ANDROID exposes it as a lightweight player overlay. Request it
  // once the script signature timestamp is ready, without waiting for the token.
  // A failure must not fail the load.
  const paidPromotionRequest = playerReady.then(() => htmlExtracts.session.actions.execute('/player', {
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
  })).catch(() => null)
  const paidPromotionPromise = paidPromotionRequest.then(response => {
    if (response?.data) paidPromotionDurationMs ??= getPaidPromotionDurationMs(response.data)
    return paidPromotionDurationMs
  })

  async function loadPlayerResponse() {
    // Recheck load validity after script setup before occupying the token queue.
    await playerReady
    const visionOsStreams = await visionOsStreamsRequest
    let contentPoToken = direct?.poToken
    if (direct) {
      player.po_token = contentPoToken
    } else if ((process.env.IS_ELECTRON || process.env.IS_CAPACITOR) &&
        !watchPageIpBlocked && shouldGeneratePoToken()) {
      const requestToken = () => generateContentPoToken(
        id,
        htmlExtracts.session.context,
        htmlExtracts.initialAttestationData,
        htmlExtracts.ytConfig,
        shouldGeneratePoToken
      )
      if (visionOsStreams && htmlExtracts.playerResponse) {
        // The watch page's metadata and visionOS's streams need no token. Attest
        // anyway, without waiting, so later videos can skip the watch page.
        backgroundAttestation ??= requestToken()
          .catch(error => console.warn('Local API, background attestation failed', error))
          .finally(() => { backgroundAttestation = null })
      } else {
        try {
          contentPoToken = await requestToken()
          player.po_token = contentPoToken
        } catch (error) {
          console.error('Local API, poToken generation failed', error)
          throw error
        }
      }
    }
    // The direct request already sent the reload context
    const playerResponse = htmlExtracts.playerResponse && (!reloadPlaybackContext || direct)
      ? { data: htmlExtracts.playerResponse }
      : await htmlExtracts.session.actions.execute('/player', {
          videoId: id,
          racyCheckOk: true,
          contentCheckOk: true,
          playbackContext: {
            contentPlaybackContext: {
              vis: 0,
              splay: false,
              lactMilliseconds: '-1',
              signatureTimestamp: player.signature_timestamp
            },
            ...(reloadPlaybackContext && { reloadPlaybackContext })
          },
          serviceIntegrityDimensions: {
            poToken: contentPoToken
          }
        })
    const musicMediaType = await resolveMusicMediaType(playerResponse, htmlExtracts.session.actions, id)
    return { playerResponse, contentPoToken, musicMediaType, visionOsStreams }
  }

  // /next needs neither the playback token nor the player script.
  // Without the watch page, playback starts before /next arrives.
  const [{ playerResponse, contentPoToken, musicMediaType, visionOsStreams }, nextResponse] = await Promise.all([
    loadPlayerResponse(),
    direct
      ? null
      : htmlExtracts.nextResponse
        ? Promise.resolve({ data: htmlExtracts.nextResponse })
        : htmlExtracts.session.actions.execute('/next', {
            videoId: id,
            racyCheckOk: true,
            contentCheckOk: true
          })
  ])

  const context = htmlExtracts.session.context

  const cpn = Utils.generateRandomString(16)

  if (nextResponse) normalizeVideoPopularityResponse(nextResponse.data)
  const isLiveDvrEnabled = getLiveDvrEnabled(playerResponse.data.videoDetails)
  const info = new YT.VideoInfo([playerResponse, nextResponse], htmlExtracts.session.actions, cpn)
  // A video that is unavailable either way says nothing about the direct requests
  if (directFallback?.sessionWide && info.playability_status.status === 'OK') {
    disableDirectPlayer(directFallback.fallbackReason)
  }
  // Call it once the playback data below is final, as the merge keeps it
  const getWatchNextPromise = () => {
    if (!direct) return undefined
    const promise = direct.nextRequest.then(next => mergeLateWatchNext(info, playerResponse, next, htmlExtracts.session.actions))
    promise.catch(() => {})
    return promise
  }
  // Live streams can need the Android manifest fallback. Regular videos only
  // need its disclosure metadata, which can arrive after playback has started.
  const androidPlayerResponse = info.basic_info.is_live || info.basic_info.is_post_live_dvr
    ? await paidPromotionRequest
    : null
  /**
   * @param {string | null} manifestUrl
   * @param {boolean} isDash
   * @returns {Promise<string | null>}
   */
  const decipherAndroidManifest = async (manifestUrl, isDash) => {
    if (manifestUrl === null) return null
    try {
      return await decipherManifestUrl(manifestUrl, player, contentPoToken, isDash)
    } catch (error) {
      console.warn(`Failed to decipher the Android live ${isDash ? 'DASH' : 'HLS'} fallback`, error)
      return null
    }
  }
  const [androidLiveHlsManifestUrl, androidLiveDashManifestUrl] = await Promise.all([
    decipherAndroidManifest(getAndroidLiveHlsManifestUrl(androidPlayerResponse), false),
    info.basic_info.is_post_live_dvr
      ? decipherAndroidManifest(getAndroidLiveDashManifestUrl(androidPlayerResponse), true)
      : Promise.resolve(null)
  ])
  const totalAdTimeMilliseconds = extractTotalAdTimeMilliseconds(playerResponse.data)

  // Some time would be used for parsing and maybe additional requests so end time should be calculated sooner to reduce actual waiting time
  // Legacy format requires this
  let adEndTimeUnixMs = responseTime + totalAdTimeMilliseconds

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
      paidPromotionPromise,
      isPremiere,
      isLiveDvrEnabled,
      androidLiveHlsManifestUrl,
      androidLiveDashManifestUrl,
      watchPageIpBlocked,
      musicMediaType,
      contentDisclosures: extractLocalContentDisclosures(info),
      infoPanels: extractLocalInfoPanels(info),
      watchNextPromise: getWatchNextPromise(),
    }
  }

  const usesVisionOsStreams = visionOsStreams !== null && info.playability_status.status === 'OK'
  if (usesVisionOsStreams) {
    const visionOsInfo = new YT.VideoInfo([{ data: visionOsStreams }], htmlExtracts.session.actions, cpn)
    info.streaming_data = visionOsInfo.streaming_data
    // A SABR stream would need the WEB client's token
    info.streaming_data.server_abr_streaming_url = undefined
    // Unlike the WEB captions, these need no token either
    info.captions = visionOsInfo.captions
    // A WEB token would be added to the stream URLs
    player.po_token = undefined
    // The WEB streams' preroll doesn't hold these back
    adEndTimeUnixMs = responseTime + extractTotalAdTimeMilliseconds(visionOsStreams)
  }
  const streamPoToken = usesVisionOsStreams ? undefined : contentPoToken

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
        streamPoToken,
        true
      )
    }

    if (info.streaming_data.hls_manifest_url) {
      info.streaming_data.hls_manifest_url = await decipherManifestUrl(
        info.streaming_data.hls_manifest_url,
        player,
        streamPoToken,
        false
      )
    }
  }

  /**
   * @param {import('youtubei.js').YTNodes.PlayerCaptionsTracklist | undefined} captions
   * @param {string | undefined} poToken
   * @param {string} captionClientName
   */
  const prepareCaptionUrls = (captions, poToken, captionClientName) => {
    for (const captionTrack of captions?.caption_tracks ?? []) {
      const url = new URL(captionTrack.base_url)

      if (poToken) {
        url.searchParams.set('potc', '1')
        url.searchParams.set('pot', poToken)
      }
      url.searchParams.set('c', captionClientName)

      // Remove &xosf=1 as it adds `position:63% line:0%` to the subtitle lines
      // placing them in the top right corner
      url.searchParams.delete('xosf')

      captionTrack.base_url = url.toString()
    }
  }
  prepareCaptionUrls(info.captions, streamPoToken, usesVisionOsStreams ? 'VISIONOS' : clientName)

  return {
    info,
    poToken: streamPoToken,
    clientInfo,
    adEndTimeUnixMs,
    paidPromotionDurationMs,
    paidPromotionPromise,
    isPremiere,
    isLiveDvrEnabled,
    androidLiveHlsManifestUrl,
    androidLiveDashManifestUrl,
    watchPageIpBlocked,
    musicMediaType,
    contentDisclosures: extractLocalContentDisclosures(info),
    infoPanels: extractLocalInfoPanels(info),
    getVrHlsManifest: () => getLocalVrHlsManifest(id, htmlExtracts.session, contentPoToken),
    // Expired visionOS streams only need a new /player response, not the watch page
    refreshVisionOsStreams: usesVisionOsStreams
      ? async () => {
        const data = isVisionOsStreamsEnabled() ? await requestVisionOsStreams(id) : null
        if (!data) return null
        const refreshed = new YT.VideoInfo([{ data }], htmlExtracts.session.actions, cpn)
        prepareCaptionUrls(refreshed.captions, undefined, 'VISIONOS')
        return refreshed
      }
      : null,
    watchNextPromise: getWatchNextPromise(),
  }
}

/**
 * Extracts content disclosures ('How this was made') from YouTube VideoInfo response
 * @param {import('youtubei.js').YT.VideoInfo} info
 * @returns {{ label: string, description: string, attribution: string }[] | null}
 */
export function extractLocalContentDisclosures(info) {
  if (info?.page?.[1]?.engagement_panels) {
    const structuredDescPanel = info.page[1].engagement_panels.find(
      panel => panel.target_id === 'engagement-panel-structured-description'
    )

    if (structuredDescPanel?.content?.is(YTNodes.StructuredDescriptionContent)) {
      const LEARN_MORE_REGEX = /\s*Learn more\.?$/i

      const items = structuredDescPanel.content.items
        .filterType(YTNodes.HowThisWasMadeSectionView)
        .map(item => ({
          label: item.body_header?.text ?? '',
          description: item.body_text?.text?.replace(LEARN_MORE_REGEX, '').trim() ?? '',
          attribution: item.attribution_text?.text ?? '',
        }))

      return items.length > 0 ? items : null
    }
  }

  return null
}

/**
 * @typedef {object} LocalInfoPanel
 * @property {string} title
 * @property {string[]} paragraphs
 * @property {string} source
 * @property {string} disclaimer
 * @property {string} url
 */

// Topic panels start their first paragraph with the source name, e.g. "Wikipedia • The Holocaust was..."
const INFO_PANEL_SOURCE_PREFIX_REGEX = /^([^•]{1,80}?) • /

/**
 * Extracts information panels (publicly funded broadcaster notices, topic context, health sources) from YouTube VideoInfo response
 * @param {import('youtubei.js').YT.VideoInfo} info
 * @returns {LocalInfoPanel[] | null}
 */
export function extractLocalInfoPanels(info) {
  const memo = info?.page?.[1]?.contents_memo
  if (!memo) {
    return null
  }

  const containers = memo.getType(YTNodes.InfoPanelContainer).filter(container => container.content)
  const nestedContents = new Set(containers.map(container => container.content))

  const panels = [
    ...containers.map(container => ({ title: container.title.text, content: container.content })),
    ...memo.getType(YTNodes.InfoPanelContent)
      .filter(content => !nestedContents.has(content))
      .map(content => ({ title: content.title.text, content })),
  ].map(({ title, content }) => {
    const paragraphs = (content.paragraphs ?? content.attributed_paragraphs ?? [])
      .map(paragraph => paragraph.text?.trim())
      .filter(Boolean)
    let source = content.inline_source?.text || content.source.text || ''
    const disclaimer = content.disclaimer?.text ?? ''

    const sourcePrefix = !source && paragraphs.length > 0 ? INFO_PANEL_SOURCE_PREFIX_REGEX.exec(paragraphs[0]) : null
    if (sourcePrefix) {
      source = sourcePrefix[1]
      paragraphs[0] = paragraphs[0].slice(sourcePrefix[0].length)
    }

    let url = content.source_endpoint?.payload?.url ?? content.source_endpoint?.metadata?.url ?? ''
    if (url.startsWith('//')) {
      url = `https:${url}`
    }
    if (!/^https?:\/\//.test(url) || !URL.canParse(url)) {
      url = ''
    } else if (!source && !disclaimer) {
      source = new URL(url).hostname
    }

    return { title: title ?? '', paragraphs, source, disclaimer, url }
  }).filter(panel => panel.title || panel.paragraphs.length > 0)

  return panels.length > 0 ? panels : null
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
  const innertube = await createInnertube({
    generateSessionLocally: false,
    fetchFunc: async (input, init) => normalizeCommentFetchResponse(await localApiFetch(input, init))
  })
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
 * @param {string | undefined} poToken
 * @param {boolean} isDash
 */
async function decipherManifestUrl(url, player, poToken, isDash) {
  const urlObject = new URL(url)

  if (urlObject.searchParams.size > 0) {
    if (poToken) urlObject.searchParams.set('pot', poToken)

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
  if (poToken) decipheredUrlObject.pathname += `/pot/${encodeURIComponent(poToken)}`

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

async function processForegroundSubscriptionResponse(input) {
  try {
    // Passing the raw response through Electron's context bridge copies its
    // entire graph on the renderer thread. Serialize it off-thread instead.
    const data = await runBackgroundJob('stringify', { value: input.data })
    return await window.ftElectron.subscriptionAutoRefresh.processFeed({
      ...input,
      data,
      hideMembersOnly: shouldHideMembersOnlyContent(true, store.getters),
    })
  } catch (error) {
    console.warn('Background feed processing failed; parsing in the renderer:', error)
    return undefined
  }
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

    if (process.env.IS_ELECTRON) {
      const result = await processForegroundSubscriptionResponse({ format: 'local', data: response.data, feedType: 'videos', channelId: id })
      if (result === null) return null
      if (result?.needsUploadsPlaylist) {
        try {
          const playlist = await innertube.getPlaylist(getChannelPlaylistId(result.channelId, 'videos', 'newest'))
          result.videos = parseLocalPlaylistVideos(playlist.items)
        } catch (error) {
          if (error.message !== 'The playlist does not exist.') throw error
        }
      }
      if (result) return { name: result.name, thumbnailUrl: result.thumbnailUrl, handle: result.handle, videos: result.videos }
    }

    const videosTab = new YT.Channel(null, response)
    const { id: channelId = id, name, thumbnailUrl, handle } = parseLocalChannelHeader(videosTab, true)

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
      handle,
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

    if (process.env.IS_ELECTRON) {
      let result = await processForegroundSubscriptionResponse({ format: 'local', data: response.data, feedType: 'live', channelId: id })
      if (result === null) return null
      while (result && result.videos.length === 0 && result.continuation) {
        const page = await innertube.actions.execute('/browse', { continuation: result.continuation })
        const next = await processForegroundSubscriptionResponse({
          format: 'localContinuation',
          data: page.data,
          feedType: 'live',
          channelId: result.channelId,
          channelName: result.name,
        })
        if (!next) {
          result = undefined
          break
        }
        result.videos = next.videos
        result.continuation = next.continuation
      }
      if (result) return { name: result.name, thumbnailUrl: result.thumbnailUrl, handle: result.handle, videos: result.videos }
    }

    let liveStreamsTab = new YT.Channel(innertube.actions, response)
    const { id: channelId = id, name, thumbnailUrl, handle } = parseLocalChannelHeader(liveStreamsTab, true)

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
      handle,
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

    if (process.env.IS_ELECTRON) {
      const result = await processForegroundSubscriptionResponse({ format: 'local', data: response.data, feedType: 'posts', channelId: id })
      if (result !== undefined) return result?.posts ?? null
    }

    const communityTab = new YT.Channel(null, response)

    // if the channel doesn't have a community tab, YouTube returns the home tab instead
    // so we need to check that we got the right tab
    if (communityTab.current_tab?.endpoint.metadata.url?.endsWith('/posts')) {
      return parseLocalCommunityPosts(communityTab)
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
      releases: parseLocalListPlaylists(channel.playlists),
      continuationData: null
    }
  }

  /** @type {import('youtubei.js').YTNodes.EngagementPanelSectionList} */
  const engagementPanelSectionList = Parser.parseItem(rawEngagementPanel)

  /** @type {import('youtubei.js').YTNodes.ContinuationItem|undefined} */
  const continuationItem = engagementPanelSectionList?.content?.contents?.[0]?.contents?.[0]

  if (!continuationItem) {
    return {
      releases: parseLocalListPlaylists(channel.playlists),
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
    releases: playlists ? parseLocalListPlaylists(playlists) : [],
    continuationData: continuationItem
  }
}

/**
 * @param {YT.Search} response
 */
function handleSearchResponse(response) {
  const notice = response.results?.find(item => item.type === 'BackgroundPromo')
  const searchNotice = notice
    ? {
        title: notice.title.toString(),
        body: notice.body_text.toString(),
        requiresAuthentication: notice.cta_button?.endpoint?.name === 'signInEndpoint'
      }
    : null
  if (!response.results) {
    return {
      results: [],
      continuationData: null,
      searchNotice
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
    searchNotice,
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
        ...getAuthorVerification(channel.author),
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
        ...getAuthorVerification(channel.author),
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
      ...getAuthorVerification(video.author),
      collaborators: parseLocalCollaboratorItems(video.author.collaborators),
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
      authorHandle: getChannelHandleFromEndpoint(video.author.endpoint),
      ...getAuthorVerification(video.author),
      collaborators: parseLocalCollaboratorItems(video.author.collaborators),
      viewCount: video.view_count == null ? null : extractNumberFromString(video.view_count.text),
      published,
      lengthSeconds: isNaN(video.duration.seconds) ? '' : video.duration.seconds,
      liveNow: video.is_live,
      isPremiere: video.is_premiere,
      isUpcoming: video.is_premiere,
      isMembersOnly: video.badges?.some(badge => badge.style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY') ?? false
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
 * @property {boolean} authorVerified
 * @property {boolean} authorVerifiedArtist
 * @property {boolean} isPinned
 * @property {boolean} isOwner
 * @property {boolean} isMember
 * @property {string} text
 * @property {string} translationText
 * @property {object} [imageAttachment]
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
    ...getAuthorVerification(comment.author),
    authorThumb: comment.author?.best_thumbnail?.url ?? '',
    isPinned: comment.is_pinned,
    isOwner: !!comment.author_is_channel_owner,
    isMember: !!comment.is_member,
    text: Autolinker.link(parseLocalTextRuns(commentTextRuns, 16, { looseChannelNameDetection: true })),
    translationText: getCommentTranslationSource(commentTextRuns),
    imageAttachment: parseLocalCommentImageAttachment(comment.image_attachment),
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
  // YouTube returns empty pages when continuing the Shorts tab with a locally generated session.
  const innertube = await createInnertube({ generateSessionLocally: false })
  return await innertube.getHashtag(hashtag)
}

/**
 * Matched by URL because the tab titles are localized.
 * @param {YT.HashtagFeed} hashtagFeed
 */
export function hasHashtagShortsTab(hashtagFeed) {
  return getHashtagShortsTab(hashtagFeed) !== undefined
}

/**
 * @param {YT.HashtagFeed} hashtagFeed
 */
function getHashtagShortsTab(hashtagFeed) {
  return hashtagFeed.page.contents_memo?.getType(YTNodes.Tab)
    .find(tab => tab.endpoint.metadata.url?.endsWith('/shorts'))
}

/**
 * YouTube lists only a few videos on a hashtag's main tab, without a
 * continuation, and paginates its Shorts tab.
 * @param {YT.HashtagFeed} hashtagFeed
 */
export async function getHashtagShortsLocal(hashtagFeed) {
  const response = await getHashtagShortsTab(hashtagFeed).endpoint.call(hashtagFeed.actions)
  return new Mixins.Feed(hashtagFeed.actions, response)
}

export async function getLocalCommunityPost(postId, channelId) {
  const innertube = await createInnertube()
  if (channelId == null) {
    channelId = await getLocalChannelId('https://www.youtube.com/post/' + postId, true)
  }

  const postPage = await innertube.getPost(postId, channelId)
  return parseLocalCommunityPosts(postPage)[0]
}

/**
 * @param {string} postId
 * @param {string} channelId
 * @param {'TOP_COMMENTS' | 'NEWEST_FIRST'} [sortBy]
 */
export async function getLocalCommunityPostComments(postId, channelId, sortBy) {
  const innertube = await createInnertube({ generateSessionLocally: false })

  return await innertube.getPostComments(postId, channelId, sortBy)
}

/** Fetch public history metadata without player setup or stream extraction. */
export async function getLocalHistoryMetadata(videoId, signal) {
  const innertube = await createInnertube({
    signal,
    fetchFunc: async (input, init) => checkHistoryRepairResponse(await localApiFetch(input, init)),
  })
  return fetchPublicPlayerMetadata(innertube, videoId, signal)
}

/** Reuse one lightweight session while checking a playlist's video availability. */
export async function createLocalPlaylistAvailabilityChecker(signal) {
  const innertube = await createInnertube({
    signal,
    fetchFunc: async (input, init) => checkHistoryRepairResponse(await localApiFetch(input, init)),
  })
  return (videoId, requestSignal) => fetchPublicPlayerMetadata(innertube, videoId, requestSignal)
}

/**
 * Fetch the publication dates YouTube omits from search results, such as for auto-generated Topic videos.
 * @param {any[]} entries
 */
export function getLocalMissingPublicationDates(entries) {
  let innertube
  const getInnertube = () => (innertube ??= createInnertube())
  return fetchMissingPublicationDates(
    entries,
    async videoId => fetchPublicPlayerMetadata(await getInnertube(), videoId),
    async videoId => (await (await getInnertube()).actions.execute('/next', { videoId, parse: false })).data
  )
}

async function fetchPublicPlayerMetadata(innertube, videoId, signal) {
  // Actions.execute does not pass a request signal through to HTTPClient.fetch.
  const response = await innertube.session.http.fetch('/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, contentCheckOk: true, racyCheckOk: true }),
    signal,
  })
  return response.json()
}
