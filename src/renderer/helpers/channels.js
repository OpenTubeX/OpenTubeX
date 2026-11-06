import { invidiousGetChannelId, invidiousGetChannelInfo } from './api/invidious'
import { getLocalChannel, getLocalChannelId, parseLocalChannelHeader } from './api/local'
import { requestWithFallback } from './api/fallback'
import { usesInvidiousApi } from '../../apiBackends'

const isMissingChannelError = err => err?.message === 'This channel does not exist.'

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
