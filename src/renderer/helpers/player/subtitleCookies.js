import { isYouTubeSubtitleUrl } from '../../../youtubeSubtitle.js'
import { isLiteBuild } from '../ytDlpCapabilities.js'
import { usesYtDlpCookiesFor } from '../../../ytDlpCookieUses.js'
import { getCaptionTranslationLanguage, getTranslatedCaptionUrl } from './captionTranslation.js'

export function shouldUseSubtitleCookies(url, getters) {
  // Lite Android builds cannot fetch subtitles through yt-dlp.
  return Boolean(!isLiteBuild &&
    usesYtDlpCookiesFor(getters.getYtDlpCookieUses, 'subtitles') && isYouTubeSubtitleUrl(url))
}

/**
 * @param {string} text
 * @param {string} targetLanguage
 * @returns {Promise<string>}
 */
async function translateWithYouTube(text, targetLanguage) {
  const { translateLines } = await import('../api/local.js')
  return await translateLines(text, targetLanguage)
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} getters
 * @param {{ ytDlpGetSubtitle: (url: string) => Promise<string | { error: string } | null> } | null} [bridge]
 * @param {(text: string, targetLanguage: string) => Promise<string>} [translate]
 * @returns {Promise<string>}
 */
export async function getSubtitleRequestUrl(url, getters, bridge, translate = translateWithYouTube) {
  const translationLanguage = getCaptionTranslationLanguage(url)
  try {
    const authenticatedUrl = await getAuthenticatedSubtitleUrl(url, getters, bridge)
    if (authenticatedUrl !== url || translationLanguage === null) return authenticatedUrl
  } catch (error) {
    if (translationLanguage === null) throw error
    console.warn('Translating the original captions, as the translation could not be loaded with the configured cookies', error)
  }
  // YouTube only translates captions for signed-in accounts
  return await getTranslatedCaptionUrl(url, translationLanguage, translate)
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} getters
 * @param {{ ytDlpGetSubtitle: (url: string) => Promise<string | { error: string } | null> } | null} [bridge]
 * @returns {Promise<string>}
 */
async function getAuthenticatedSubtitleUrl(url, getters, bridge) {
  if (!shouldUseSubtitleCookies(url, getters)) {
    return url
  }

  if (bridge === undefined) {
    bridge = process.env.IS_CAPACITOR
      ? (await import('../ytDlp')).ytDlp
      : globalThis.window?.ftElectron
  }
  if (!bridge) return url

  const result = await bridge.ytDlpGetSubtitle(url)
  if (result === null) return url
  if (typeof result !== 'string') throw new Error(result.error)
  const params = new URL(url).searchParams
  const mimeType = params.get('fmt') === 'srt' ? 'text/srt' : 'text/vtt'
  // The data URL hides the YouTube URL from Shaka's response filter, so apply
  // its automatic-caption positioning correction before handing over the text.
  const text = mimeType === 'text/vtt' && params.get('caps') === 'asr' && params.get('kind') === 'asr'
    ? result.replaceAll(/ align:start position:(?:10)?0%$/gm, '')
    : result
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`
}
