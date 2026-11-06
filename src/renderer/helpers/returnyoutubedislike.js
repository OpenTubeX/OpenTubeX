import store from '../store/index'

/**
 * Hard-coded list of well-known Return YouTube Dislike API instances.
 * Returns the list of currently known public instances so that users can pick
 * one in the settings instead of having to remember/type the URL.
 *
 * @returns {string[]}
 */
export function getRYDInstances() {
  return [
    'https://ryd-proxy.kavin.rocks',
    'https://returnyoutubedislikeapi.com'
  ]
}

/**
 * Fetches the dislike count for a video using the Return YouTube Dislike API
 * (or a compatible proxy) configured in the user settings.
 *
 * @param {string} videoId
 * @returns {Promise<number>} The dislike count reported by the API, or `NaN`
 *   if the response did not contain a valid number.
 */
export async function getVideoDislikes(videoId) {
  const url = store.getters.getReturnYouTubeDislikesUrl

  let requestUrl
  // The official API has a different URL scheme to the proxies
  if (new URL(url).hostname.replace('www.', '') === 'returnyoutubedislikeapi.com') {
    requestUrl = `https://returnyoutubedislikeapi.com/Votes?videoId=${encodeURIComponent(videoId)}`
  } else {
    requestUrl = `${url}/votes/${encodeURIComponent(videoId)}`
  }

  const response = await fetch(requestUrl).then(res => res.json())

  return response.dislikes
}
