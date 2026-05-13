import store from '../store/index'
import packageDetails from '../../../package.json'

const SPONSOR_BLOCK_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const SPONSOR_BLOCK_USER_ID_LENGTH = 30

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
 * @typedef {'sponsor' | 'selfpromo' | 'interaction' | 'intro' | 'outro' | 'preview' | 'music_offtopic' | 'filler' | 'chapter'} SponsorBlockCategory
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
 *   actionType: 'skip'
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
