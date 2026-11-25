import { hasTwitchAd, stripTrailingTwitchAds } from '../../../../twitchLiveAds'
import { getTwitchAdFreeLiveManifest } from '../../../helpers/player/ytDlpPlayback'

// Also limits how often a playlist that gets ads right after loading reloads
const RETRY_DELAY_MS = 10_000
// Each failed attempt interrupts the ad-supported playlist
const FAILED_RETRY_DELAY_MS = 60_000

/**
 * Twitch inserts its ads into the live playlist. When an ad break starts, this
 * switches to the playlist of a session without ads, and keeps the ads from
 * loading in the meantime. Without such a playlist, the ads play.
 * @param {{
 *   getLogin: () => string | null,
 *   startsReplaced: boolean,
 *   isLiveSource: () => boolean,
 *   replaceLiveSource: (src: string) => boolean,
 *   restoreLiveSource: () => boolean,
 *   reportLoadError: (error: unknown) => void,
 * }} options `startsReplaced` is whether the first playlist replaced one that it can return to,
 *   `replaceLiveSource` and `restoreLiveSource` return whether the player loads the playlist
 */
export function useTwitchLiveAds({ getLogin, startsReplaced, isLiveSource, replaceLiveSource, restoreLiveSource, reportLoadError }) {
  /** @type {Promise<boolean> | null} The request for another playlist, resolving with whether the player loads it */
  let request = null
  /** Set from replacing the playlist until the replacement loads */
  let replacing = startsReplaced
  /** Set from loading another session after a failed load until a playlist loads */
  let reloading = false
  let retryAt = 0

  /**
   * @param {string} login
   * @param {boolean} allowAds
   * @returns {Promise<boolean>} whether the player loads another playlist
   */
  function switchToAdFreeSource(login, allowAds = false) {
    request = getTwitchAdFreeLiveManifest(login, allowAds).then((src) => {
      request = null
      retryAt = Date.now() + RETRY_DELAY_MS
      if (src) replacing = replaceLiveSource(src)
      return !!src && replacing
    })
    return request
  }

  /**
   * Checks the media playlists of the live source for ads.
   * @param {import('shaka-player').extern.Response} response
   */
  function handleMediaPlaylistResponse(response) {
    const login = getLogin()
    if (!login || !isLiveSource()) return
    const playlist = new TextDecoder().decode(response.data)
    if (!hasTwitchAd(playlist)) return
    if (!request && !replacing && Date.now() >= retryAt) switchToAdFreeSource(login)
    if (!request && !replacing) return
    const stripped = stripTrailingTwitchAds(playlist)
    if (stripped !== playlist) response.data = new TextEncoder().encode(stripped).buffer
  }

  function handleLoaded() {
    replacing = false
    reloading = false
  }

  /**
   * Returns to the playlist with ads when the ad-free playlist fails to load.
   * Without one, such as on iOS, which cannot play yt-dlp's playlists, it loads
   * another session once, also one with ads, before reporting the error.
   * A playlist that is already being requested replaces that session.
   * @param {unknown} error
   * @returns {boolean} whether the error was handled
   */
  function handleLoadError(error) {
    const login = getLogin()
    if (!login || !isLiveSource()) return false
    if (replacing) {
      replacing = false
      if (!restoreLiveSource()) return false
      console.warn('Failed to load the ad-free Twitch playlist', error)
      retryAt = Date.now() + FAILED_RETRY_DELAY_MS
      return true
    }
    if (reloading) return false
    reloading = true
    console.warn('Failed to load the Twitch playlist, loading another session', error)
    ;(request ?? Promise.resolve(false)).then(loads => loads || switchToAdFreeSource(login, true)).then((loads) => {
      // The failed playlist is not worth returning to
      if (loads) replacing = false
      else reportLoadError(error)
    })
    return true
  }

  return { handleLoaded, handleLoadError, handleMediaPlaylistResponse }
}
