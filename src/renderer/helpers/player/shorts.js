const MAX_SHORT_DURATION_SECONDS = 3 * 60
const MAX_CHANNEL_SHORTS_CONTEXTS = 20
const SHORTS_COMPLETION_END_MARGIN_SECONDS = 0.5
const SHORTS_COMPLETION_MAX_PLAYBACK_TICK_SECONDS = 2
const SHORTS_COMPLETION_MIN_PLAYBACK_AFTER_SEEK_SECONDS = 1
const channelShortsNavigationContexts = new Map()

/**
 * Keeps seek jumps from completing a Short. After a seek, only continuous
 * forward playback can re-enable completion detection.
 *
 * @param {object} options
 * @param {boolean} options.blockedBySeek
 * @param {number} options.playbackAfterSeekSeconds
 * @param {number} options.elapsedSeconds
 * @param {number} options.currentSeconds
 * @param {number} options.durationSeconds
 * @returns {{blockedBySeek: boolean, playbackAfterSeekSeconds: number, reachedEnd: boolean}}
 */
export function getShortsCompletionState({
  blockedBySeek,
  playbackAfterSeekSeconds,
  elapsedSeconds,
  currentSeconds,
  durationSeconds,
}) {
  let playedSeconds = playbackAfterSeekSeconds
  let blocked = blockedBySeek

  if (
    blocked &&
    elapsedSeconds > 0 &&
    elapsedSeconds <= SHORTS_COMPLETION_MAX_PLAYBACK_TICK_SECONDS
  ) {
    playedSeconds += elapsedSeconds
    blocked = playedSeconds < SHORTS_COMPLETION_MIN_PLAYBACK_AFTER_SEEK_SECONDS
  }

  return {
    blockedBySeek: blocked,
    playbackAfterSeekSeconds: playedSeconds,
    reachedEnd: !blocked &&
      durationSeconds > 0 &&
      currentSeconds >= durationSeconds - SHORTS_COMPLETION_END_MARGIN_SECONDS
  }
}

/**
 * Prefers YouTube's selected portrait thumbnail only when the user has not
 * explicitly chosen another frame.
 * @param {{ thumbnailUrl?: string } | null | undefined} video
 * @param {'' | 'hidden' | 'start' | 'middle' | 'end'} thumbnailPreference
 * @param {string | null} fallbackUrl
 * @returns {string | null}
 */
export function getPreferredShortThumbnailUrl(video, thumbnailPreference, fallbackUrl) {
  return thumbnailPreference === '' && video?.thumbnailUrl
    ? video.thumbnailUrl
    : fallbackUrl
}

/**
 * Keeps a channel page's visible Shorts sequence available while its Watch
 * route replaces the channel component in the same tab.
 *
 * @param {string} channelId
 * @param {object[]} videos
 */
export function setChannelShortsNavigationContext(channelId, videos) {
  if (!channelId) {
    return
  }

  channelShortsNavigationContexts.delete(channelId)
  channelShortsNavigationContexts.set(channelId, videos.slice())

  if (channelShortsNavigationContexts.size > MAX_CHANNEL_SHORTS_CONTEXTS) {
    channelShortsNavigationContexts.delete(channelShortsNavigationContexts.keys().next().value)
  }
}

/**
 * @param {string} channelId
 * @returns {object[]}
 */
export function getChannelShortsNavigationContext(channelId) {
  return channelShortsNavigationContexts.get(channelId)?.slice() ?? []
}

/**
 * @param {object} format
 * @returns {number | null}
 */
function getFormatAspectRatio(format) {
  const width = Number(format?.width)
  const height = Number(format?.height)

  if (width > 0 && height > 0) {
    return width / height
  }

  const size = typeof format?.size === 'string'
    ? format.size.match(/^(?<width>\d+)x(?<height>\d+)$/)
    : null

  if (!size) {
    return null
  }

  return Number(size.groups.width) / Number(size.groups.height)
}

/**
 * Returns the most representative video aspect ratio in a list of stream
 * formats. Audio-only formats and formats without dimensions are ignored.
 *
 * @param {object[]} formats
 * @returns {number | null}
 */
export function getVideoAspectRatio(formats) {
  for (const format of formats ?? []) {
    const aspectRatio = getFormatAspectRatio(format)

    if (aspectRatio !== null) {
      return aspectRatio
    }
  }

  return null
}

/**
 * YouTube classifies square or vertical uploads up to three minutes long as
 * Shorts. Explicit navigation metadata wins because stream dimensions may not
 * be available until after the player has started loading.
 *
 * @param {object} options
 * @param {boolean} [options.explicit]
 * @param {number} [options.duration]
 * @param {object[]} [options.formats]
 * @returns {boolean}
 */
export function isYouTubeShort({ explicit = false, duration, formats = [] }) {
  if (explicit) {
    return true
  }

  const aspectRatio = getVideoAspectRatio(formats)

  return Number(duration) > 0 &&
    Number(duration) <= MAX_SHORT_DURATION_SECONDS &&
    aspectRatio !== null &&
    aspectRatio <= 1
}

/**
 * Extracts the optional long-form video promoted by a Short's Reel response.
 *
 * @param {object} response
 * @returns {{videoId: string, title: string} | null}
 */
export function parseLocalShortLinkedVideo(response) {
  const metadataItems = response?.data?.overlay?.reelPlayerOverlayRenderer
    ?.playerOverlay?.reelPlayerOverlayViewModel?.metapanel
    ?.reelMetapanelViewModel?.metadataItems

  if (!Array.isArray(metadataItems)) {
    return null
  }

  for (const item of metadataItems) {
    const buttons = item.reelCarouselViewModel?.buttonViewModels

    if (!Array.isArray(buttons)) {
      continue
    }

    for (const buttonItem of buttons) {
      const button = buttonItem.reelCarouselButtonViewModel?.buttonViewModel?.buttonViewModel
      const videoId = button?.onTap?.innertubeCommand?.watchEndpoint?.videoId
      const title = button?.titleFormatted?.content ?? button?.accessibilityText

      if (videoId && title) {
        return { videoId, title }
      }
    }
  }

  return null
}

/**
 * Builds the same newest-first sequence shown by the subscriptions Shorts tab.
 * Keeping this pure makes feed navigation deterministic while the watch route
 * is reused for each Short.
 *
 * @param {object} options
 * @param {Record<string, {videos?: object[]}>} options.cache
 * @param {{id: string}[]} options.subscriptions
 * @param {(video: object) => boolean} [options.isHidden]
 * @param {(video: object) => boolean} [options.isWatched]
 * @param {boolean} [options.hideWatched]
 * @param {number | null} [options.maxPerChannel]
 * @param {string} [options.currentVideoId]
 * @returns {object[]}
 */
export function buildSubscriptionShortsFeed({
  cache,
  subscriptions,
  isHidden = () => false,
  isWatched = () => false,
  hideWatched = false,
  maxPerChannel = null,
  currentVideoId = '',
}) {
  const videos = subscriptions
    .flatMap(channel => cache[channel.id]?.videos ?? [])
    .filter(video => video.videoId && !isHidden(video))
    .filter(video =>
      video.videoId === currentVideoId ||
      !hideWatched ||
      !isWatched(video)
    )
    .slice()
    .sort((a, b) => Number(b.published ?? 0) - Number(a.published ?? 0))

  const channelCounts = new Map()
  const videoIds = new Set()

  return videos.filter(video => {
    if (videoIds.has(video.videoId)) {
      return false
    }
    videoIds.add(video.videoId)

    if (video.videoId === currentVideoId) {
      return true
    }

    if (maxPerChannel === null || !video.authorId) {
      return true
    }

    const count = channelCounts.get(video.authorId) ?? 0
    if (count >= maxPerChannel) {
      return false
    }

    channelCounts.set(video.authorId, count + 1)
    return true
  })
}
