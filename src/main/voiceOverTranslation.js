import { net } from 'electron'

const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60
const RESPONSE_LANGUAGES = new Set(['ru', 'en', 'kk'])
const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{11}$/

let clientPromise

function getClient() {
  clientPromise ??= import('@vot.js/core').then(({ default: VOTClient }) => {
    return new VOTClient({
      // Electron's network stack follows the app's proxy configuration. Explicitly
      // omit credentials so a translation request never carries browser cookies.
      fetchFn: (input, init) => net.fetch(input, { ...init, credentials: 'omit' })
    })
  })

  return clientPromise
}

/**
 * Request a translated audio track from the unofficial Yandex VOT API.
 *
 * @param {unknown} payload
 * @returns {Promise<{ translated: boolean, url?: string, remainingTime: number, status: number }>}
 */
export async function requestVoiceOverTranslation(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Invalid voice-over translation request')
  }

  const { videoId, duration, responseLanguage } = payload

  if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw new TypeError('Invalid YouTube video ID')
  }

  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError('Voice-over translation only supports videos up to four hours long')
  }

  if (!RESPONSE_LANGUAGES.has(responseLanguage)) {
    throw new RangeError('Unsupported voice-over translation language')
  }

  const client = await getClient()
  const result = await client.translateVideo({
    videoData: {
      url: `https://youtu.be/${videoId}`,
      videoId,
      host: 'youtube',
      duration
    },
    requestLang: 'auto',
    responseLang: responseLanguage
  })

  if (result.translated) {
    const translationUrl = new URL(result.url)
    if (translationUrl.protocol !== 'https:') {
      throw new Error('Voice-over service returned an insecure audio URL')
    }

    return {
      translated: true,
      url: translationUrl.href,
      remainingTime: result.remainingTime,
      status: result.status
    }
  }

  return {
    translated: false,
    remainingTime: result.remainingTime,
    status: result.status
  }
}
