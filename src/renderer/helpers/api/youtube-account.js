import { ClientType, Innertube } from 'youtubei.js'

import store from '../../store/index'
import i18n from '../../i18n/index'
import { ERROR_TOAST_ICON, showToast } from '../utils'
import { getLocalSignatureTimestamp, localApiFetch } from './local'
import { YOUTUBE_USER_AGENT_HEADER, YOUTUBE_USER_AGENTS } from '../../../youTubeUserAgent.js'
import { getSelectedYouTubeProfile, isSignedInToYouTube } from '../youtube-account-state.js'
import {
  commentActionParams,
  createCommentParams,
  createReplyParams,
  isCommentActionSuccessful,
  parseAccountProfiles,
  parseCreatedComment,
  parseHomeFeed,
  parseSubscribedChannels,
  parseVideoRating,
  parseWatchHistoryUrl
} from './youtube-account-parsers.js'

// The account signs in like a YouTube TV app does: the user approves a code
// on Google's device page, and the app polls for the tokens. Those tokens only
// work with the TV client, so every signed-in request uses it.

const TOKEN_URL = 'https://www.youtube.com/o/oauth2/token'
const REVOKE_URL = 'https://www.youtube.com/o/oauth2/revoke'
const TV_PAGE_URL = 'https://www.youtube.com/tv'
// YouTube's TV activation page, unlike Google's device page, lets the user
// pick a brand account's channel too, and it can fill in the code.
const ACTIVATION_URL = 'https://www.youtube.com/tv/activate'
const SHORT_ACTIVATION_URL = 'https://yt.be/activate'
// Refresh a minute early, so a token cannot expire on its way.
const TOKEN_EXPIRY_MARGIN_MS = 60_000

// The signed-in TV player only answers playable to a Samsung TV.
const TIZEN_CLIENT = Object.freeze({
  clientName: 'TVHTML5',
  clientVersion: '5.20260707',
  deviceMake: 'Samsung',
  deviceModel: 'SmartTV',
  osName: 'Tizen',
  osVersion: '2.4.0'
})

/**
 * @typedef {object} YouTubeAccountCredentials
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {string} expiry_date
 * @property {{ client_id: string, client_secret: string }} client the TV app's OAuth client
 *
 * @typedef {object} YouTubeAccount
 * @property {YouTubeAccountCredentials} credentials
 * @property {import('./youtube-account-parsers.js').YouTubeProfile[]} profiles the channels the account can use
 * @property {string | null} pageId the channel in use; null for the Google account's own
 * @property {string | null} channelId the ID of the channel in use
 *
 * @typedef {object} YouTubeSignInCode
 * @property {string} userCode
 * @property {string} signInUrl opens the activation page with the code filled in
 * @property {string} verificationUrl where to enter the code on another device
 * @property {number} expiresAt
 * @property {string} deviceCode
 * @property {number} interval
 * @property {{ client_id: string, client_secret: string }} client
 */

export class YouTubeSignInError extends Error {
  /** @param {'denied' | 'expired'} reason */
  constructor(reason) {
    super(`YouTube sign-in ${reason}`)
    this.name = 'YouTubeSignInError'
    this.reason = reason
  }
}

/**
 * @param {RequestInit | undefined} init
 * @param {keyof typeof YOUTUBE_USER_AGENTS} client
 * @returns {RequestInit}
 */
function withUserAgent(init, client) {
  const headers = new Headers(init?.headers)
  if (process.env.IS_ELECTRON) {
    headers.set(YOUTUBE_USER_AGENT_HEADER, client)
  } else {
    headers.set('User-Agent', YOUTUBE_USER_AGENTS[client])
  }
  return { ...init, headers }
}

/**
 * @typedef {object} AccountRequestOptions
 * @property {keyof typeof YOUTUBE_USER_AGENTS} [userAgent] the user agent for InnerTube requests
 * @property {string | null} [pageId] acts as this brand account's channel
 */

/**
 * @param {RequestInit | undefined} init
 * @param {string} pageId
 * @returns {RequestInit}
 */
function withPageId(init, pageId) {
  const headers = new Headers(init?.headers)
  headers.set('X-Goog-PageId', pageId)
  return { ...init, headers }
}

/**
 * @param {AccountRequestOptions} options
 * @returns {import('youtubei.js').FetchFunction}
 */
function createAccountFetch({ userAgent, pageId }) {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    // youtube.com/tv only links the script with the OAuth client to TVs.
    if (url === TV_PAGE_URL) return localApiFetch(input, withUserAgent(init, 'tv'))
    if (!url.startsWith('https://www.youtube.com/youtubei/')) return localApiFetch(input, init)

    let requestInit = init
    if (userAgent) requestInit = withUserAgent(requestInit, userAgent)
    if (pageId) requestInit = withPageId(requestInit, pageId)
    return localApiFetch(input, requestInit)
  }
}

/**
 * @param {YouTubeAccountCredentials} [credentials] signs the session in
 * @param {AccountRequestOptions} [options]
 */
async function createAccountInnertube(credentials, options = {}) {
  const innertube = await Innertube.create({
    // Like the anonymous sessions, start a new one each time.
    enable_session_cache: false,
    generate_session_locally: true,
    retrieve_innertube_config: false,
    // Account requests never decipher streams.
    retrieve_player: false,
    client_type: ClientType.TV,
    fetch: createAccountFetch(options)
  })

  if (credentials) {
    innertube.session.on('update-credentials', ({ credentials }) => saveCredentials(credentials))
    // youtubei.js keeps and updates the object it signs in with.
    await innertube.session.signIn({ ...credentials })
  }

  return innertube
}

// Signing out saves the setting asynchronously. Until then, the old account
// must not be used or saved again by a refresh that finishes meanwhile.
const signedOutRefreshTokens = new Set()

/** @returns {YouTubeAccount | null} */
function getAccount() {
  if (!isSignedInToYouTube(store.getters)) return null
  const account = store.getters.getYouTubeAccount
  return signedOutRefreshTokens.has(account.credentials.refresh_token) ? null : account
}

/** @param {YouTubeAccountCredentials} credentials */
async function saveCredentials(credentials) {
  const account = getAccount()
  // A refresh that finishes after signing out must not sign back in.
  if (account?.credentials.refresh_token !== credentials.refresh_token) return

  await store.dispatch('updateYouTubeAccount', {
    ...account,
    credentials: {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.expiry_date,
      client: account.credentials.client
    }
  })
}

/**
 * @param {unknown} expiresIn seconds
 * @returns {string}
 */
function expiryDate(expiresIn) {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
  return new Date(Date.now() + seconds * 1000).toISOString()
}

/** @type {{ refreshToken: string, promise: Promise<YouTubeAccountCredentials> } | null} */
let pendingRefresh = null

/** @param {YouTubeAccountCredentials} credentials */
async function refreshCredentials(credentials) {
  const response = await localApiFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.client.client_id,
      client_secret: credentials.client.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: 'refresh_token'
    })
  })
  const data = await response.json().catch(() => ({}))

  // The user removed the app from their Google account or changed the password.
  if (data.error === 'invalid_grant' || response.status === 401) {
    if (getAccount()?.credentials.refresh_token === credentials.refresh_token) {
      await store.dispatch('updateYouTubeAccount', null)
      showToast({
        message: i18n.global.t('Settings.YouTube Account Settings.Signed out by YouTube'),
        icon: ERROR_TOAST_ICON
      })
    }
    throw new Error('The YouTube account sign-in is no longer valid')
  }

  if (!response.ok || typeof data.access_token !== 'string') {
    throw new Error(`Failed to refresh the YouTube account sign-in: ${response.status}`)
  }

  const refreshed = {
    ...credentials,
    access_token: data.access_token,
    expiry_date: expiryDate(data.expires_in)
  }
  await saveCredentials(refreshed)
  return refreshed
}

/** @returns {Promise<YouTubeAccountCredentials>} */
async function getCredentials() {
  const account = getAccount()
  if (!account) throw new Error('Not signed in to a YouTube account')

  const { credentials } = account
  if (Date.parse(credentials.expiry_date) - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return credentials
  }

  // A refresh still running for an account signed out since must not be reused.
  if (pendingRefresh?.refreshToken !== credentials.refresh_token) {
    const refresh = {
      refreshToken: credentials.refresh_token,
      promise: refreshCredentials(credentials).finally(() => {
        if (pendingRefresh === refresh) pendingRefresh = null
      })
    }
    pendingRefresh = refresh
  }
  return await pendingRefresh.promise
}

/**
 * Runs the callback as the channel in use.
 * @template T
 * @param {(innertube: Innertube) => Promise<T>} callback
 * @param {{ userAgent?: keyof typeof YOUTUBE_USER_AGENTS }} [options]
 * @returns {Promise<T>}
 */
async function withAccount(callback, options = {}) {
  const credentials = await getCredentials()
  const pageId = getAccount()?.pageId ?? null
  return await callback(await createAccountInnertube(credentials, { ...options, pageId }))
}

/**
 * Starts a sign-in. The user enters the code at the verification URL.
 * @returns {Promise<YouTubeSignInCode>}
 */
export async function requestYouTubeSignInCode() {
  const innertube = await createAccountInnertube()
  const oauth = innertube.session.oauth
  const client = await oauth.getClientID()
  oauth.client_id = client
  const code = await oauth.getDeviceAndUserCode()

  return {
    userCode: code.user_code,
    signInUrl: `${ACTIVATION_URL}?user_code=${encodeURIComponent(code.user_code)}`,
    verificationUrl: SHORT_ACTIVATION_URL,
    expiresAt: Date.now() + code.expires_in * 1000,
    deviceCode: code.device_code,
    interval: code.interval,
    client
  }
}

/**
 * @param {number} delay
 * @param {AbortSignal} signal
 */
function wait(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param {YouTubeAccountCredentials} credentials
 * @returns {Promise<{ profiles: import('./youtube-account-parsers.js').YouTubeProfile[], selectedPageId: string | null }>}
 */
async function fetchProfiles(credentials) {
  // Without a page ID, the list covers all channels of the Google account.
  const innertube = await createAccountInnertube(credentials)
  const response = await innertube.actions.execute('/account/accounts_list', {
    accountReadMask: { returnOwner: true, returnBrandAccounts: true, returnPersonaAccounts: false }
  })
  const result = parseAccountProfiles(response.data)
  if (result.profiles.length === 0) throw new Error('YouTube returned no channels for the account')
  return result
}

/**
 * Only recognizing your own comments needs the channel ID.
 * @param {YouTubeAccountCredentials} credentials
 * @param {import('./youtube-account-parsers.js').YouTubeProfile | null} profile
 * @returns {Promise<string | null>}
 */
async function resolveChannelId(credentials, profile) {
  if (!profile?.handle) return null
  try {
    const innertube = await createAccountInnertube(credentials)
    const endpoint = await innertube.resolveURL(`https://www.youtube.com/${profile.handle}`)
    const browseId = endpoint?.payload?.browseId
    return typeof browseId === 'string' && browseId.startsWith('UC') ? browseId : null
  } catch (error) {
    console.warn('Could not resolve the YouTube channel', error)
    return null
  }
}

/**
 * Polls until the user approves the code, then saves the account.
 * @param {YouTubeSignInCode} code
 * @param {AbortSignal} signal stops polling when the user cancels
 */
export async function completeYouTubeSignIn(code, signal) {
  let interval = Math.max(code.interval, 1) * 1000

  while (Date.now() < code.expiresAt) {
    await wait(interval, signal)

    let response
    try {
      response = await localApiFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: code.client.client_id,
          client_secret: code.client.client_secret,
          code: code.deviceCode,
          grant_type: 'http://oauth.net/grant_type/device/1.0'
        }),
        signal
      })
    } catch (error) {
      if (signal.aborted) throw error
      // The connection can drop while the user approves in the browser.
      continue
    }

    const data = await response.json().catch(() => ({}))
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      interval += 5000
      continue
    }
    if (data.error === 'access_denied') throw new YouTubeSignInError('denied')
    if (data.error === 'expired_token') throw new YouTubeSignInError('expired')
    if (!response.ok || typeof data.refresh_token !== 'string') {
      throw new Error(`YouTube sign-in failed: ${data.error ?? response.status}`)
    }

    /** @type {YouTubeAccountCredentials} */
    const credentials = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: expiryDate(data.expires_in),
      client: code.client
    }
    const { profiles, selectedPageId } = await fetchProfiles(credentials)
    const profile = profiles.find(entry => entry.pageId === selectedPageId) ?? profiles[0]
    const channelId = await resolveChannelId(credentials, profile)
    signal.throwIfAborted()
    await store.dispatch('updateYouTubeAccount', { credentials, profiles, pageId: profile.pageId, channelId })
    return
  }

  throw new YouTubeSignInError('expired')
}

/**
 * Updates the channels the account can use, for example after the user
 * created one. Falls back to the account's own channel if the one in use is gone.
 */
export async function refreshYouTubeProfiles() {
  const credentials = await getCredentials()
  const { profiles } = await fetchProfiles(credentials)
  const account = getAccount()
  if (account?.credentials.refresh_token !== credentials.refresh_token) return

  // The profiles start with the Google account's own channel.
  const kept = profiles.some(profile => profile.pageId === account.pageId)
  const pageId = kept ? account.pageId : profiles[0].pageId
  const channelId = kept && account.channelId
    ? account.channelId
    : await resolveChannelId(credentials, getSelectedYouTubeProfile({ profiles, pageId }))
  const latest = getAccount()
  // Signed out, or switched channels while this was resolving.
  if (latest?.credentials.refresh_token !== credentials.refresh_token || latest.pageId !== account.pageId) return
  await store.dispatch('updateYouTubeAccount', { ...latest, profiles, pageId, channelId })
}

/**
 * Uses YouTube as another channel of the signed-in Google account.
 * @param {string | null} pageId
 */
export async function selectYouTubeProfile(pageId) {
  const credentials = await getCredentials()
  const account = getAccount()
  const profile = account?.profiles.find(entry => entry.pageId === pageId)
  if (!account || !profile) throw new Error('The channel is not available for this account')

  const channelId = await resolveChannelId(credentials, profile)
  const latest = getAccount()
  if (latest?.credentials.refresh_token !== credentials.refresh_token) return
  await store.dispatch('updateYouTubeAccount', { ...latest, pageId, channelId })
}

/** Signs out on this device and revokes the sign-in at Google. */
export async function signOutOfYouTubeAccount() {
  const account = getAccount()
  if (!account) return
  signedOutRefreshTokens.add(account.credentials.refresh_token)
  await store.dispatch('updateYouTubeAccount', null)

  try {
    // Revoking the refresh token also ends its access tokens.
    await localApiFetch(`${REVOKE_URL}?token=${encodeURIComponent(account.credentials.refresh_token)}`, { method: 'POST' })
  } catch (error) {
    console.warn('Could not revoke the YouTube account sign-in', error)
  }
}

/**
 * @param {string} videoId
 * @returns {Promise<import('./youtube-account-parsers.js').YouTubeRating | null>}
 */
export async function getYouTubeVideoRating(videoId) {
  return await withAccount(async innertube => {
    const response = await innertube.actions.execute('/next', { videoId })
    return parseVideoRating(response.data)
  })
}

/**
 * @param {string} videoId
 * @param {import('./youtube-account-parsers.js').YouTubeRating} rating
 */
export async function rateYouTubeVideo(videoId, rating) {
  // removelike also removes dislikes. There is no removedislike.
  const endpoint = rating === 'LIKE' ? '/like/like' : rating === 'DISLIKE' ? '/like/dislike' : '/like/removelike'
  await withAccount(innertube => innertube.actions.execute(endpoint, { target: { videoId } }))
}

/** @param {string} channelId */
export async function subscribeOnYouTube(channelId) {
  await withAccount(innertube => innertube.interact.subscribe(channelId))
}

/** @param {string} channelId */
export async function unsubscribeOnYouTube(channelId) {
  await withAccount(innertube => innertube.interact.unsubscribe(channelId))
}

let mirrorQueue = Promise.resolve()

/**
 * Repeats a subscription change in OpenTubeX on the YouTube account, when
 * the user turned that on.
 * @param {string | string[]} channelIds
 * @param {boolean} subscribed
 */
export function mirrorYouTubeSubscription(channelIds, subscribed) {
  // Only YouTube channels can be subscribed to on YouTube.
  const youTubeChannelIds = [channelIds].flat().filter(channelId => /^UC[\w-]{22}$/.test(channelId))
  if (!getAccount() || !store.getters.getYouTubeAccountMirrorSubscriptions || youTubeChannelIds.length === 0) {
    return Promise.resolve()
  }

  // Changes go out in the order they were made, so a quick unsubscribe
  // cannot finish before the subscribe it undoes.
  mirrorQueue = mirrorQueue.then(() => sendMirroredSubscriptions(youTubeChannelIds, subscribed))
  return mirrorQueue
}

/**
 * @param {string[]} youTubeChannelIds
 * @param {boolean} subscribed
 */
async function sendMirroredSubscriptions(youTubeChannelIds, subscribed) {
  try {
    // One at a time, and stop at the first failure instead of repeating it.
    for (const channelId of youTubeChannelIds) {
      if (subscribed) {
        await subscribeOnYouTube(channelId)
      } else {
        await unsubscribeOnYouTube(channelId)
      }
    }
  } catch (error) {
    console.error(error)
    const details = { error: error?.message ?? String(error) }
    showToast({
      message: subscribed
        ? i18n.global.t('YouTube Account.Subscribe Failed', details)
        : i18n.global.t('YouTube Account.Unsubscribe Failed', details),
      icon: ERROR_TOAST_ICON
    })
  }
}

/** @returns {Promise<{ id: string, name: string, thumbnail: string | null }[]>} */
export async function getYouTubeAccountSubscriptions() {
  return await withAccount(async innertube => {
    const response = await innertube.actions.execute('/browse', { browseId: 'FEsubscriptions' })
    return parseSubscribedChannels(response.data)
  })
}

/**
 * @param {string | null} [continuation] from the previous page
 * @returns {Promise<{ videos: object[], continuation: string | null }>}
 */
export async function getYouTubeAccountRecommendations(continuation = null) {
  return await withAccount(async innertube => {
    const response = await innertube.actions.execute('/browse', continuation ? { continuation } : { browseId: 'default' })
    return parseHomeFeed(response.data)
  })
}

/**
 * @param {string} videoId
 * @param {string} text
 * @param {string} [parentCommentId] posts a reply to this top-level comment
 */
export async function postYouTubeComment(videoId, text, parentCommentId) {
  return await withAccount(async innertube => {
    const response = parentCommentId
      ? await innertube.actions.execute('/comment/create_comment_reply', {
          createReplyParams: createReplyParams(videoId, parentCommentId),
          commentText: text
        })
      : await innertube.actions.execute('/comment/create_comment', {
          createCommentParams: createCommentParams(videoId),
          commentText: text
        })
    return parseCreatedComment(response.data)
  })
}

/**
 * @param {import('./youtube-account-parsers.js').YouTubeCommentAction} action
 * @param {string} commentId
 * @param {string} videoId
 */
export async function performYouTubeCommentAction(action, commentId, videoId) {
  await withAccount(async innertube => {
    const response = await innertube.actions.execute('/comment/perform_comment_action', {
      actions: [commentActionParams(action, commentId, videoId)]
    })
    if (!isCommentActionSuccessful(response.data, action, commentId)) {
      throw new Error(`YouTube did not ${action} the comment`)
    }
  })
}

/** @type {Promise<number | undefined> | null} */
let signatureTimestamp = null

/**
 * Adds the video to the account's watch history, as YouTube's TV apps do when
 * playback starts. Paused history stays paused.
 * @param {string} videoId
 */
export async function addToYouTubeWatchHistory(videoId) {
  // An older player's timestamp keeps working for days.
  signatureTimestamp ??= getLocalSignatureTimestamp().catch(error => {
    signatureTimestamp = null
    throw error
  })
  const timestamp = await signatureTimestamp

  await withAccount(async innertube => {
    Object.assign(innertube.session.context.client, TIZEN_CLIENT)
    const response = await innertube.actions.execute('/player', {
      videoId,
      racyCheckOk: true,
      contentCheckOk: true,
      playbackContext: { contentPlaybackContext: { signatureTimestamp: timestamp } }
    })

    const trackingUrl = parseWatchHistoryUrl(response.data)
    if (!trackingUrl) {
      signatureTimestamp = null
      throw new Error(`YouTube did not return a watch history URL: ${response.data?.playabilityStatus?.status}`)
    }

    const url = new URL(trackingUrl.replace('https://s.youtube.com/', 'https://www.youtube.com/'))
    const cpn = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      byte => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[byte & 63]).join('')
    for (const [key, value] of Object.entries({ ver: '2', c: TIZEN_CLIENT.clientName, cver: TIZEN_CLIENT.clientVersion, cpn, fmt: '251', rtn: '0', rt: '0' })) {
      url.searchParams.set(key, value)
    }

    const pageId = getAccount()?.pageId
    const ping = await localApiFetch(url, {
      headers: {
        Authorization: `Bearer ${innertube.session.oauth.oauth2_tokens.access_token}`,
        ...(pageId ? { 'X-Goog-PageId': pageId } : {})
      }
    })
    if (!ping.ok) throw new Error(`YouTube did not add the video to the watch history: ${ping.status}`)
  }, { userAgent: 'tizen' })
}
