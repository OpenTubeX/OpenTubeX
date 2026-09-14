import { calculatePublishedDate } from '../feed-metadata.js'

export function createInvidiousFeedParsers(instanceUrl) {
  /**
   * @returns {string}
   */
  function getCurrentInstanceUrl() {
    return instanceUrl()
  }

  /**
   * @param {string} url
   * @param {string?} currentInstance
   * @returns {string?}
   */
  function youtubeImageUrlToInvidious(url, currentInstance = null) {
    if (url == null) {
      return null
    }

    if (currentInstance === null) {
      currentInstance = getCurrentInstanceUrl()
    }
    // Can be prefixed with `https://` or `//` (protocol relative)
    if (url.startsWith('//')) {
      url = 'https:' + url
    }
    const newUrl = `${currentInstance}/ggpht`
    return url.replace('https://yt3.ggpht.com', newUrl)
      .replace('https://yt3.googleusercontent.com', newUrl)
      .replace(/https:\/\/i\d*\.ytimg\.com/, newUrl)
  }

  /**
   * Normalizes a raw Invidious channel response fetched by an Android worker.
   * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
   * @param {object} response
   * @param {string} channelId
   * @returns {object[]}
   */
  function normalizeInvidiousSubscriptionFeed(feedType, response, channelId) {
    if (feedType === 'posts') {
      return Array.isArray(response?.comments)
        ? response.comments.map(parseInvidiousCommunityData)
        : []
    }

    const videos = Array.isArray(response?.videos) ? response.videos : []
    if (feedType === 'shorts') {
      videos.forEach(video => {
        video.isUpcoming = false
        video.isShort = true
        delete video.published
        delete video.premiereTimestamp
      })
    } else {
      normalizeManyInvidiousVideosAttributes(videos, channelId)
      setMultiplePublishedTimestamps(videos)
    }
    return videos
  }

  function parseInvidiousCommunityData(data) {
    return {
      // use #/ to support channel YT links.
      // ex post: https://www.youtube.com/post/UgkxMpGt1SVlHwA1afwqDr2DZLn-hmJJQqKo
      postText: data.contentHtml.replaceAll('href="/', 'href="#/'),
      postId: data.commentId,
      authorThumbnails: data.authorThumbnails.map(thumbnail => {
        thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
        return thumbnail
      }),
      publishedTime: calculatePublishedDate(data.publishedText),
      voteCount: data.likeCount,
      postContent: parseInvidiousCommunityAttachments(data.attachment),
      commentCount: data?.replyCount ?? 0, // https://github.com/iv-org/invidious/pull/3635/
      authorId: data.authorId,
      author: data.author,
      type: 'community'
    }
  }

  function parseInvidiousCommunityAttachments(data) {
    if (!data) {
      return null
    }

    // I've only seen this appear when a video was made private.
    // This is not currently supported on local api.
    if (data.error) {
      return {
        type: 'error',
        message: data.error
      }
    }

    if (data.type === 'image') {
      return {
        type: data.type,
        content: data.imageThumbnails.map(thumbnail => {
          thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
          return thumbnail
        })
      }
    }

    if (data.type === 'video') {
      data.videoThumbnails = data.videoThumbnails?.map(thumbnail => {
        thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
        return thumbnail
      })
      return {
        type: data.type,
        content: data
      }
    }

    if (data.type === 'multiImage') {
      const content = data.images.map(imageThumbnails => {
        return imageThumbnails.map(thumbnail => {
          thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
          return thumbnail
        })
      })
      return {
        type: 'multiImage',
        content: content
      }
    }

    // https://github.com/iv-org/invidious/pull/3635/files
    if (data.type === 'poll') {
      return {
        type: 'poll',
        totalVotes: data.totalVotes ?? 0,
        content: data.choices.map(choice => {
          return {
            text: choice.text,
            image: choice.image?.map(thumbnail => {
              thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
              return thumbnail
            })
          }
        })
      }
    }

    if (data.type === 'quiz') {
      return {
        type: 'quiz',
        totalVotes: data.totalVotes ?? 0,
        content: data.choices.map(choice => {
          return {
            text: choice.text,
            isCorrect: choice.isCorrect,
            image: choice.image?.map(thumbnail => {
              thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
              return thumbnail
            })
          }
        })
      }
    }

    if (data.type === 'playlist') {
      return {
        type: data.type,
        content: data
      }
    }

    console.error(`Unknown Invidious community post type: ${data.type}`)
    console.error(data)
  }

  /**
   * @param {{
   *  authorId: string | null,
   * }[]} videos
   * @param {string|null} [fallbackAuthorId]
   */
  function normalizeManyInvidiousVideosAttributes(videos, fallbackAuthorId = null) {
    const actualFallbackAuthorId = fallbackAuthorId === '' ? null : fallbackAuthorId

    videos.forEach((v) => normalizeOneInvidiousVideoAttributes(v, actualFallbackAuthorId))
  }

  /**
   * @param {{
   *  authorId: string | null,
   * }} video
   * @param {string|null} [fallbackAuthorId]
   */
  function normalizeOneInvidiousVideoAttributes(video, fallbackAuthorId = null) {
    if (video.authorId === '') video.authorId = fallbackAuthorId

    video.isPremiere = video.liveNow && video.premiereTimestamp > 0
  }

  /**
   * @param {{
   *  liveNow: boolean,
   *  isUpcoming: boolean,
   *  premiereTimestamp: number,
   *  published: number
   * }[]} videos
   */
  function setMultiplePublishedTimestamps(videos) {
    videos.forEach(setPublishedTimestamp)
  }

  /**
   * @param {{
   *  liveNow: boolean,
   *  isUpcoming: boolean,
   *  premiereTimestamp: number,
   *  published: number
   * }} video
   */
  function setPublishedTimestamp(video) {
    if (video.liveNow) {
      video.published = Date.now()
    } else if (video.isUpcoming) {
      if (typeof video.published === 'number') {
        video.subscriptionFeedPublished = video.published * 1000
      }
      video.published = video.premiereTimestamp * 1000
    } else if (typeof video.published === 'number') {
      video.published *= 1000
    }
  }

  return {
    normalizeInvidiousSubscriptionFeed,
    parseInvidiousCommunityData,
    youtubeImageUrlToInvidious,
    getCurrentInstanceUrl,
    normalizeManyInvidiousVideosAttributes,
    normalizeOneInvidiousVideoAttributes,
    setMultiplePublishedTimestamps,
    setPublishedTimestamp
  }
}
