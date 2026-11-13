import { invidiousGetChannelId, invidiousGetChannelInfo, youtubeImageUrlToInvidious } from './api/invidious'
import { getLocalChannel, getLocalChannelId, parseLocalChannelHeader, parseLocalSubscriberCount } from './api/local'
import { requestWithFallback } from './api/fallback'
import { usesInvidiousApi } from '../../apiBackends'

export const isMissingChannelError = err => err?.message === 'This channel does not exist.'

/**
 * @param {string} id
 * @param {{
 *   preference: string,
 *   fallback: boolean,
 * }} backendOptions
 * @returns {Promise<{ channel: any, fromInvidiousApi: boolean } | { invalid: true }>}
 */
async function findChannelById(id, backendOptions) {
  let requests = 0
  try {
    const { api, result } = await requestWithFallback({
      local: () => { requests++; return getLocalChannel(id) },
      invidious: () => { requests++; return invidiousGetChannelInfo(id) },
    }, {
      backend: backendOptions.preference,
      fallback: backendOptions.fallback,
      canFallBack: err => !isMissingChannelError(err),
    })
    return { channel: result, fromInvidiousApi: api === 'invidious' }
  } catch (err) {
    // don't bother with fallback if channel doesn't exist. Only the preferred
    // backend decides that; a fallback's answer is reported as an error.
    if (requests === 1 && isMissingChannelError(err)) {
      return { invalid: true }
    }
    throw err
  }
}

/**
 * @param {string} id
 * @param {{
 *   preference: string,
 *   fallback: boolean,
 * }} backendOptions
 * @returns {Promise<{icon: string, iconHref: string, preferredName: string} | { invalidId: boolean }>}
 */
export async function findChannelTagInfo(id, backendOptions) {
  if (!checkYoutubeChannelId(id)) return { invalidId: true }
  try {
    const result = await findChannelById(id, backendOptions)
    if (result.invalid) return { invalidId: true }

    // Parse the response of the backend that answered, which differs from the preferred one after a fallback
    const { channel, fromInvidiousApi } = result
    if (fromInvidiousApi) {
      return {
        preferredName: channel.author,
        // Yattee servers can return channels without avatars
        icon: channel.authorThumbnails[0]?.url ?? ''
      }
    } else {
      if (channel.alert) return { invalidId: true }

      const { name, thumbnailUrl } = parseLocalChannelHeader(channel)

      return {
        preferredName: name,
        icon: thumbnailUrl,
        iconHref: `/channel/${id}`
      }
    }
  } catch (err) {
    console.error(err)
    return { preferredName: '', icon: '', iconHref: '', err }
  }
}

/**
 * Check whether Id provided might be a YouTube Id
 * @param {string} id
 * @returns {boolean}
 */
export function checkYoutubeChannelId(id) {
  return /^UC[\w-]{22}$/.test(id)
}

/**
 * Resolves a channel URL, such as one with a handle, to the channel's ID
 * @param {string} url
 * @param {string} backendPreference
 * @returns {Promise<string | null>}
 */
export function resolveChannelId(url, backendPreference) {
  if (!process.env.SUPPORTS_LOCAL_API || usesInvidiousApi(backendPreference)) {
    return invidiousGetChannelId(url)
  }

  return getLocalChannelId(url)
}

/**
 * Loads the name, avatar, handle and subscriber count of a channel with the
 * preferred backend and its fallback.
 * @param {string} channelId the ID, or the handle or name from the URL
 * @param {string} url the youtube.com URL of the channel, to resolve names
 * @param {{ preference: string, fallback: boolean }} backendOptions
 * @param {AbortSignal} signal
 * @returns {Promise<{ name: string, thumbnail: string | null, handle: string | null, subscriberCount: number | null } | null>}
 * null for channels that were not found, which also happens when resolving a name fails to connect
 */
export async function loadChannelSummary(channelId, url, backendOptions, signal) {
  const resolveId = async getChannelId => {
    const id = checkYoutubeChannelId(channelId) ? channelId : await getChannelId(url)
    signal.throwIfAborted()
    return id
  }
  const loadLocal = async () => {
    const id = await resolveId(getLocalChannelId)
    if (id === null) return null
    const channel = await getLocalChannel(id, signal)
    if (channel.alert) return null
    const { name, thumbnailUrl, handle, subscriberText } = parseLocalChannelHeader(channel)
    const subscriberCount = subscriberText ? parseLocalSubscriberCount(subscriberText) : NaN
    return {
      name,
      thumbnail: thumbnailUrl?.startsWith('//') ? `https:${thumbnailUrl}` : thumbnailUrl ?? null,
      handle,
      subscriberCount: Number.isFinite(subscriberCount) ? subscriberCount : null
    }
  }
  const loadInvidious = async () => {
    const id = await resolveId(invidiousGetChannelId)
    if (id === null) return null
    const channel = await invidiousGetChannelInfo(id, signal)
    return {
      name: channel.author,
      // Yattee servers can return channels without avatars
      thumbnail: youtubeImageUrlToInvidious(channel.authorThumbnails.at(-1)?.url ?? null),
      // Invidious channel responses have no handle.
      handle: null,
      subscriberCount: Number.isFinite(channel.subCount) ? channel.subCount : null
    }
  }
  let result
  try {
    ({ result } = await requestWithFallback({ local: loadLocal, invidious: loadInvidious }, {
      backend: backendOptions.preference,
      fallback: backendOptions.fallback,
      signal,
      canFallBack: err => !isMissingChannelError(err),
    }))
  } catch (err) {
    if (isMissingChannelError(err)) return null
    throw err
  }
  signal.throwIfAborted()
  if (result !== null && (typeof result.name !== 'string' || !result.name.trim())) throw new Error('Channel name unavailable')
  return result
}
