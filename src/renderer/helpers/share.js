/**
 * @param {string} currentInvidiousInstanceUrl
 * @param {string} videoId
 * @param {string} [playlistId]
 * @returns {string}
 */
export function getInvidiousVideoUrl(currentInvidiousInstanceUrl, videoId, playlistId = '') {
  let videoUrl = `${currentInvidiousInstanceUrl}/watch?v=${videoId}`

  if (playlistId) {
    videoUrl += `&list=${playlistId}`
  }

  return videoUrl
}

/**
 * @param {string} videoId
 * @param {string} [playlistId]
 * @returns {string}
 */
export function getYoutubeVideoShareUrl(videoId, playlistId = '') {
  const videoUrl = `https://youtu.be/${videoId}`

  if (playlistId) {
    return `${videoUrl}?list=${playlistId}`
  }

  return videoUrl
}

/**
 * @param {string | null | undefined} route
 * @returns {boolean}
 */
export function isShareableOpenTubeXRoute(route) {
  if (!route) {
    return false
  }

  return ['/channel', '/watch', '/hashtag', '/post'].some(p => route.startsWith(p)) ||
    (route.startsWith('/playlist') && !/playlistType=user/.test(route))
}

/**
 * @param {string} routeWithQuery
 * @param {boolean} toYouTube
 * @returns {string | undefined}
 */
export function transformOpenTubeXRouteUrl(routeWithQuery, toYouTube) {
  const origin = toYouTube
    ? 'https://www.youtube.com'
    : 'https://redirect.invidious.io'
  const [path, query] = routeWithQuery.split('?')
  const [route, id] = path.split('/').filter(p => p)

  switch (route) {
    case 'playlist':
      return `${origin}/playlist?list=${id}`
    case 'channel':
      return `${origin}/channel/${id}`
    case 'hashtag':
      return `${origin}/hashtag/${id}`
    case 'watch': {
      let url

      if (toYouTube) {
        url = new URL(`https://youtu.be/${id}`)
      } else {
        url = new URL(`https://redirect.invidious.io/watch?v=${id}`)
      }

      if (query) {
        const params = new URLSearchParams(query)
        const newParams = new URLSearchParams(url.search)
        let hasParams = false

        if (params.has('playlistId') && params.get('playlistType') !== 'user') {
          newParams.set('list', params.get('playlistId'))
          hasParams = true
        }

        if (params.has('timestamp')) {
          newParams.set('t', params.get('timestamp'))
          hasParams = true
        }

        if (hasParams) {
          url.search = newParams.toString()
        }
      }

      return url.toString()
    }
    case 'post': {
      if (query) {
        const authorId = new URLSearchParams(query).get('authorId')

        if (authorId) {
          if (toYouTube) {
            return `${origin}/channel/${authorId}/community?lb=${id}`
          } else {
            return `${origin}/post/${id}?ucid=${authorId}`
          }
        }
      }

      return `${origin}/post/${id}`
    }
  }
}

/**
 * @param {string} url
 * @param {number} timestamp
 * @returns {string}
 */
export function appendTimestamp(url, timestamp) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${timestamp}`
}
