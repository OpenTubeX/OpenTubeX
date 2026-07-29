import store from '../store/index'
import packageDetails from '../../../package.json'
import { selectSponsorBlockFullVideoLabel } from './player/sponsorBlockFullVideo'

const SPONSOR_BLOCK_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const SPONSOR_BLOCK_USER_ID_LENGTH = 30
const SPONSOR_BLOCK_VIDEO_LABEL_CACHE_SIZE = 256
const sponsorBlockVideoLabelCache = new Map()

function generateSponsorBlockUserId() {
  const randomValues = new Uint32Array(SPONSOR_BLOCK_USER_ID_LENGTH)
  crypto.getRandomValues(randomValues)

  return Array.from(randomValues, value => {
    return SPONSOR_BLOCK_ID_CHARSET[value % SPONSOR_BLOCK_ID_CHARSET.length]
  }).join('')
}

async function getVideoHash(videoId) {
  const videoIdBuffer = new TextEncoder().encode(videoId)

  const hashBuffer = await crypto.subtle.digest('SHA-256', videoIdBuffer)
  const hashArray = new Uint8Array(hashBuffer)

  return hashArray[0].toString(16).padStart(2, '0') +
    hashArray[1].toString(16).padStart(2, '0')
}

/**
 * @typedef {'sponsor' | 'selfpromo' | 'interaction' | 'intro' | 'outro' | 'preview' | 'hook' | 'music_offtopic' | 'filler' | 'poi_highlight' | 'exclusive_access' | 'chapter'} SponsorBlockCategory
 */

/**
 * @typedef {'skip' | 'mute' | 'full' | 'poi' | 'chapter'} SponsorBlockActionType
 */

/**
 * @param {string} videoId
 * @param {SponsorBlockCategory[]} categories
 * @param {SponsorBlockActionType[]} [actionTypes=['skip']]
 * @returns {Promise<{
 *   UUID: string,
 *   actionType: string,
 *   category: SponsorBlockCategory,
 *   description: string,
 *   locked: 1|0,
 *   segment: [
 *     number,
 *     number
 *   ],
 *   videoDuration: number,
 *   votes: number
 * }[]>}
 */
export async function sponsorBlockSkipSegments(videoId, categories, actionTypes = ['skip']) {
  const videoIdHashPrefix = await getVideoHash(videoId)
  const requestUrl = `${store.getters.getSponsorBlockUrl}/api/skipSegments/${videoIdHashPrefix}` +
    `?categories=${encodeURIComponent(JSON.stringify(categories))}` +
    `&actionTypes=${encodeURIComponent(JSON.stringify(actionTypes))}`

  try {
    const response = await fetch(requestUrl)

    // 404 means that there are no segments registered for the video
    if (response.status === 404) {
      return []
    }

    // Sometimes the sponsor block server goes down or returns other errors
    if (!response.ok) {
      throw new Error(await response.text())
    }

    const json = await response.json()
    return json
      .filter((result) => result.videoID === videoId)
      .flatMap((result) => result.segments)
  } catch (error) {
    console.error('failed to fetch SponsorBlock segments', requestUrl, error)
    throw error
  }
}

/**
 * @param {string} videoId
 * @returns {Promise<{
 *   UUID: string,
 *   actionType: 'full',
 *   category: 'sponsor' | 'exclusive_access' | 'selfpromo',
 *   locked: 1|0,
 *   segment: [0, 0],
 *   videoDuration: number,
 *   votes: number
 * } | null>}
 */
export async function getSponsorBlockVideoLabel(videoId) {
  const sponsorBlockUrl = store.getters.getSponsorBlockUrl
  const cacheKey = `${sponsorBlockUrl}:${videoId}`
  const cachedLabel = sponsorBlockVideoLabelCache.get(cacheKey)

  if (cachedLabel) {
    return cachedLabel
  }

  const request = (async () => {
    const videoIdHashPrefix = await getVideoHash(videoId)
    const requestUrl = `${sponsorBlockUrl}/api/videoLabels/${videoIdHashPrefix}`

    try {
      const response = await fetch(requestUrl)
      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const results = await response.json()
      const segments = results.find(result => result.videoID === videoId)?.segments ?? []
      return selectSponsorBlockFullVideoLabel(segments)
    } catch (error) {
      sponsorBlockVideoLabelCache.delete(cacheKey)
      console.error('failed to fetch SponsorBlock video label', requestUrl, error)
      throw error
    }
  })()

  if (sponsorBlockVideoLabelCache.size >= SPONSOR_BLOCK_VIDEO_LABEL_CACHE_SIZE) {
    sponsorBlockVideoLabelCache.delete(sponsorBlockVideoLabelCache.keys().next().value)
  }
  sponsorBlockVideoLabelCache.set(cacheKey, request)

  return request
}

export async function deArrowData(videoId) {
  const videoIdHashPrefix = await getVideoHash(videoId)
  const requestUrl = `${store.getters.getSponsorBlockUrl}/api/branding/${videoIdHashPrefix}`

  try {
    const response = await fetch(requestUrl)

    // 404 means that there are no segments registered for the video
    if (response.status === 404) {
      return undefined
    }

    const json = await response.json()
    return json[videoId] ?? undefined
  } catch (error) {
    console.error('failed to fetch DeArrow data', requestUrl, error)
    throw error
  }
}

export async function deArrowThumbnail(videoId, timestamp) {
  let requestUrl = `${store.getters.getDeArrowThumbnailGeneratorUrl}/api/v1/getThumbnail?videoID=` + videoId
  if (timestamp != null) {
    requestUrl += `&time=${timestamp}`
  }

  try {
    const response = await fetch(requestUrl)

    // 204 means that there are no thumbnails found for the video
    if (response.status === 204) {
      return undefined
    }

    if (response.ok) {
      return response.url
    }

    // this usually means that a thumbnail was not generated on the server yet so we'll log the error but otherwise ignore it.
    const json = await response.json()
    console.error(json)
    return undefined
  } catch (error) {
    console.error('failed to fetch DeArrow data', requestUrl, error)
    throw error
  }
}

/**
 * @param {string} rawUserId
 * @returns {string}
 */
export function validateSponsorBlockUserId(rawUserId) {
  return rawUserId.trim()
}

/**
 * @returns {Promise<string>}
 */
export async function getOrCreateSponsorBlockUserId() {
  const importedUserId = validateSponsorBlockUserId(store.getters.getSponsorBlockUserId)
  if (importedUserId !== '') {
    return importedUserId
  }

  let generatedUserId = store.getters.getSponsorBlockGeneratedUserId
  if (generatedUserId === '') {
    generatedUserId = generateSponsorBlockUserId()
    await store.dispatch('updateSponsorBlockGeneratedUserId', generatedUserId)
  }

  return generatedUserId
}

/**
 * @param {string} videoId
 * @param {number} videoDuration
 * @param {{
 *   segment: [number, number]
 *   category: SponsorBlockCategory
 *   actionType: 'skip' | 'mute' | 'full' | 'poi'
 *   description: string
 * }[]} segments
 */
export async function submitSponsorBlockSegments(videoId, videoDuration, segments) {
  const userID = await getOrCreateSponsorBlockUserId()
  const requestUrl = `${store.getters.getSponsorBlockUrl}/api/skipSegments`

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoID: videoId,
        userID,
        videoDuration,
        userAgent: `${packageDetails.productName}/${packageDetails.version}`,
        segments
      })
    })

    if (!response.ok) {
      const error = new Error(await response.text())
      error.name = `SponsorBlockSubmitError:${response.status}`
      throw error
    }

    return await response.json()
  } catch (error) {
    console.error('failed to submit SponsorBlock segments', requestUrl, error)
    throw error
  }
}

/**
 * @param {string} videoId
 * @param {string} uuid
 * @param {0|1|20} type
 */
export async function voteOnSponsorBlockSegment(videoId, uuid, type) {
  const userID = await getOrCreateSponsorBlockUserId()
  const searchParams = new URLSearchParams({
    UUID: uuid,
    videoID: videoId,
    userID,
    type: String(type)
  })
  const requestUrl = `${store.getters.getSponsorBlockUrl}/api/voteOnSponsorTime?${searchParams}`

  try {
    const response = await fetch(requestUrl, { method: 'POST' })

    if (!response.ok) {
      const error = new Error(await response.text())
      error.name = `SponsorBlockVoteError:${response.status}`
      throw error
    }
  } catch (error) {
    console.error('failed to vote on SponsorBlock segment', requestUrl, error)
    throw error
  }
}
