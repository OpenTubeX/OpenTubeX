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
 * }} options `startsReplaced` is whether the first playlist replaced one that it can return to,
 *   `replaceLiveSource` and `restoreLiveSource` return whether the player loads the playlist
 */
export function useTwitchLiveAds({ getLogin, startsReplaced, isLiveSource, replaceLiveSource, restoreLiveSource }) {
  let requesting = false
  /** Set from replacing the playlist until the replacement loads */
  let replacing = startsReplaced
  let retryAt = 0

  /** @param {string} login */
  async function switchToAdFreeSource(login) {
    requesting = true
    const src = await getTwitchAdFreeLiveManifest(login)
    requesting = false
    retryAt = Date.now() + RETRY_DELAY_MS
    if (src) replacing = replaceLiveSource(src)
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
    if (!requesting && !replacing && Date.now() >= retryAt) switchToAdFreeSource(login)
    if (!requesting && !replacing) return
    const stripped = stripTrailingTwitchAds(playlist)
    if (stripped !== playlist) response.data = new TextEncoder().encode(stripped).buffer
  }

  function handleLoaded() {
    replacing = false
  }

  /**
   * Returns to the playlist with ads when the ad-free playlist fails to load.
   * @param {unknown} error
   * @returns {boolean} whether the error was handled
   */
  function handleLoadError(error) {
    if (!replacing) return false
    replacing = false
    if (!restoreLiveSource()) return false
    console.warn('Failed to load the ad-free Twitch playlist', error)
    retryAt = Date.now() + FAILED_RETRY_DELAY_MS
    return true
  }

  return { handleLoaded, handleLoadError, handleMediaPlaylistResponse }
}
