import store from '../store/index'
import {
  getInvidiousChannelLive,
  getInvidiousChannelShorts,
  getInvidiousChannelVideos,
  invidiousFetch,
  invidiousGetCommunityPosts,
  invidiousGetVideoInformation
} from './api/invidious'
import { fillYatteeShortDates } from './api/yattee'
import {
  getLocalChannel,
  getLocalChannelCommunity,
  getLocalChannelLiveStreams,
  getLocalChannelVideos,
  getLocalPlaylist,
  localApiFetch,
  parseLocalChannelShorts,
  parseLocalPlaylistVideos
} from './api/local'
import {
  getInvidiousApiErrorMessage,
  showInvidiousFallbackToast,
  getChannelPlaylistId,
} from './utils'
import { mergeSubscriptionShortThumbnails } from './subscription-entries'
import { mapConcurrently } from './concurrent-map'
import { extractAssignedJsonObject } from './assigned-json'
import { parseYouTubeRSSFeed } from './subscriptions'
import {
  checkSubscriptionFeedResponse,
  enrichScrapedUpcomingPublicationDates,
  RSS_ENRICHMENT_CONCURRENCY,
  RSS_ENRICHMENT_TIMEOUT_MS,
} from './subscription-enrichment'
import { activeRefresh, handleSubscriptionFetchError, showSubscriptionFallbackToast } from './subscription-refresh-state'

export async function getChannelPostsLocal(channel, t, errorChannels) {
  try {
    const posts = await getLocalChannelCommunity(channel.id, activeRefresh?.controller.signal)

    if (posts === null) {
      errorChannels.push(channel)
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription posts',
        backend: 'local API'
      })
      return null
    }

    return posts
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription posts',
      backend: 'local API'
    })

    if (store.getters.getBackendPreference === 'local' && store.getters.getBackendFallback) {
      showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelPostsInvidious(channel, t, errorChannels)
    }

    return null
  }
}

export async function getChannelPostsInvidious(channel, t, errorChannels) {
  try {
    const result = await invidiousGetCommunityPosts(channel.id, null, activeRefresh?.controller.signal)

    return result.posts
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Invidious API Error (Click to copy)'), {
      category: 'subscription posts',
      backend: 'Invidious API'
    })

    if (
      process.env.SUPPORTS_LOCAL_API &&
      store.getters.getBackendPreference === 'invidious' &&
      store.getters.getBackendFallback
    ) {
      showInvidiousFallbackToast('invidious')
      return await getChannelPostsLocal(channel, t, errorChannels)
    }

    return null
  }
}

export async function getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getLocalChannelVideos(channel.id, false, activeRefresh?.controller.signal)

    if (result === null) {
      errorChannels.push(channel)
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription videos',
        backend: 'local API'
      })
      return { videos: null }
    }

    return {
      ...result,
      videos: store.getters.getShowScheduledLiveStreamsFirst
        ? result.videos
        : await enrichScrapedUpcomingPublicationDates(channel.id, result.videos)
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'local API'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      // RSS can return 404 for channels that still exist. Verify through
      // the API instead of treating a second RSS response as channel removal.
      return await getChannelVideosLocalScraper(channel, t, errorChannels, 3)
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'YouTube RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelVideos(channel.id, undefined, undefined, { signal: activeRefresh?.controller.signal })
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author)?.author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage(store.getters.getBackendPreference), {
      category: 'subscription videos',
      backend: 'Invidious API'
    })

    if (!hasInvidiousRssFeeds()) {
      if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
        showInvidiousFallbackToast('yattee')
        // Skips the local API's own fallback to Invidious
        return await getChannelVideosLocalScraper(channel, t, errorChannels, 2)
      }
      return { videos: null }
    }

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelVideosLocalScraper(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelVideosInvidiousRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'videos', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription videos',
          backend: 'Invidious RSS'
        })
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription videos',
      backend: 'Invidious RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelVideosLocalRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelVideosInvidiousScraper(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelShortsLocal(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      const channelPage = await getLocalChannel(channel.id, activeRefresh?.controller.signal)
      if (channelPage.alert) {
        errorChannels.push(channel)
        handleSubscriptionFetchError(channel, new Error(String(channelPage.alert)), t('Local API Error (Click to copy)'), {
          category: 'subscription Shorts',
          backend: 'local API'
        })
        return { videos: null }
      }
      if (!channelPage.has_shorts) return { videos: [] }
      try {
        const playlist = await getLocalPlaylist(playlistId, activeRefresh?.controller.signal)
        const videos = parseLocalPlaylistVideos(playlist.items)
        videos.forEach(video => {
          video.isShort = true
          // Shorts playlist entries can omit the channel byline.
          if (video.author == null || video.author === 'N/A') {
            video.author = channel.name
          }
          video.authorId ??= channel.id
        })
        return { videos }
      } catch (error) {
        if (error.message !== 'The playlist does not exist.') throw error
        // Some channels have Shorts even though their automatic playlist is missing.
        const shortsTab = await channelPage.getShorts()
        const videos = parseLocalChannelShorts(shortsTab.videos, channel.id, channel.name)
        const cachedVideos = store.getters.getShortsCache[channel.id]?.videos ?? []
        // The Shorts tab omits dates, which subscriptions need for sorting and New badges.
        await mapConcurrently(videos, RSS_ENRICHMENT_CONCURRENCY, async video => {
          const cached = cachedVideos.find(entry => entry.videoId === video.videoId)
          if (Number.isFinite(cached?.published)) {
            video.published = cached.published
            return
          }
          const response = await localApiFetch(`https://www.youtube.com/watch?v=${video.videoId}`, {
            signal: AbortSignal.any([
              activeRefresh?.controller.signal,
              AbortSignal.timeout(RSS_ENRICHMENT_TIMEOUT_MS)
            ].filter(Boolean)),
            nativeTimeoutMs: RSS_ENRICHMENT_TIMEOUT_MS
          })
          checkSubscriptionFeedResponse(response)
          const player = JSON.parse(extractAssignedJsonObject(await response.text(), 'ytInitialPlayerResponse') ?? 'null')
          const published = Date.parse(player?.microformat?.playerMicroformatRenderer?.publishDate)
          if (player?.videoDetails?.videoId !== video.videoId || !Number.isFinite(published)) {
            throw new Error(`Could not load the publication date for Short ${video.videoId}`, { cause: error })
          }
          video.published = published
        })
        return { videos }
      }
    }

    checkSubscriptionFeedResponse(response)
    const [result, thumbnailEntries] = await Promise.all([
      parseYouTubeRSSFeed(await response.text(), channel.id),
      getLocalShortThumbnailEntries(playlistId)
    ])
    result.videos = mergeSubscriptionShortThumbnails(result.videos, thumbnailEntries)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription Shorts',
      backend: 'YouTube RSS'
    })

    if (failedAttempts === 0 && store.getters.getBackendFallback) {
      showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      return await getChannelShortsInvidious(channel, t, errorChannels, failedAttempts + 1)
    }

    return { videos: null }
  }
}

async function getLocalShortThumbnailEntries(playlistId) {
  try {
    const playlist = await getLocalPlaylist(playlistId, activeRefresh?.controller.signal)
    return parseLocalPlaylistVideos(playlist.items)
  } catch (error) {
    console.warn(`Failed to load selected Shorts thumbnails for ${playlistId}`, error)
    return []
  }
}

/** Yattee servers have no RSS feeds, so their API is used instead. */
export function hasInvidiousRssFeeds() {
  return store.getters.getBackendPreference !== 'yattee'
}

export async function getChannelShortsYattee(channel, t, errorChannels) {
  try {
    const result = await getInvidiousChannelShorts(channel.id)
    return { videos: await fillYatteeShortDates(result.videos, store.getters.getShortsCache[channel.id]?.videos, invidiousGetVideoInformation) }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage('yattee'), {
      category: 'subscription Shorts',
      backend: 'Yattee API'
    })

    if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showInvidiousFallbackToast('yattee')
      // Skips the local API's own fallback to Invidious
      return await getChannelShortsLocal(channel, t, errorChannels, 1)
    }

    return { videos: null }
  }
}

export async function getChannelShortsInvidious(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'shorts', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription Shorts',
          backend: 'Invidious RSS'
        })
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    const result = await parseYouTubeRSSFeed(await response.text(), channel.id)
    result.videos.forEach(video => { video.isShort = true })
    return result
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription Shorts',
      backend: 'Invidious RSS'
    })

    if (failedAttempts === 0 && process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
      showInvidiousFallbackToast('invidious')
      return await getChannelShortsLocal(channel, t, errorChannels, failedAttempts + 1)
    }

    return { videos: null }
  }
}

export async function getChannelLiveLocal(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getLocalChannelLiveStreams(channel.id, activeRefresh?.controller.signal)

    if (result === null) {
      errorChannels.push(channel)
      handleSubscriptionFetchError(channel, new Error('Channel unavailable'), t('Local API Error (Click to copy)'), {
        category: 'subscription live streams',
        backend: 'local API'
      })
      return { videos: null }
    }

    return result
  } catch (err) {
    handleSubscriptionFetchError(channel, err, t('Local API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'local API'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`

  try {
    const response = await localApiFetch(feedUrl, { signal: activeRefresh?.controller.signal })

    if (response.status === 404) {
      return await getChannelLiveLocal(channel, t, errorChannels, 3)
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Local API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'YouTube RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (store.getters.getBackendFallback) {
          showSubscriptionFallbackToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
          return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelLiveInvidious(channel, t, errorChannels, failedAttempts = 0) {
  try {
    const result = await getInvidiousChannelLive(channel.id, undefined, undefined, activeRefresh?.controller.signal)
    let name

    if (result.videos.length > 0) {
      name = result.videos.find(video => video.type === 'video' && video.author)?.author
    }

    return {
      name,
      videos: result.videos
    }
  } catch (err) {
    handleSubscriptionFetchError(channel, err, getInvidiousApiErrorMessage(store.getters.getBackendPreference), {
      category: 'subscription live streams',
      backend: 'Invidious API'
    })

    if (!hasInvidiousRssFeeds()) {
      if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
        showInvidiousFallbackToast('yattee')
        // Skips the local API's own fallback to Invidious
        return await getChannelLiveLocal(channel, t, errorChannels, 2)
      }
      return { videos: null }
    }

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelLiveLocal(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}

export async function getChannelLiveInvidiousRSS(channel, t, errorChannels, failedAttempts = 0) {
  const playlistId = getChannelPlaylistId(channel.id, 'live', 'newest')
  const feedUrl = `${store.getters.getCurrentInvidiousInstanceUrl}/feed/playlist/${playlistId}`

  try {
    const response = await invidiousFetch(feedUrl, activeRefresh?.controller.signal)

    if (response.status === 404) {
      const response2 = await fetch(`${store.getters.getCurrentInvidiousInstanceUrl}/feed/channel/${channel.id}`, {
        method: 'GET',
        signal: activeRefresh?.controller.signal
      })

      if (response2.status === 404) {
        errorChannels.push(channel)
        handleSubscriptionFetchError(channel, Object.assign(new Error('Subscription feed returned HTTP 404'), { status: 404 }), t('Invidious API Error (Click to copy)'), {
          category: 'subscription live streams',
          backend: 'Invidious RSS'
        })
        return { videos: null }
      }

      checkSubscriptionFeedResponse(response2)
      return { videos: [] }
    }

    checkSubscriptionFeedResponse(response)
    return await parseYouTubeRSSFeed(await response.text(), channel.id)
  } catch (error) {
    handleSubscriptionFetchError(channel, error, t('Invidious API Error (Click to copy)'), {
      category: 'subscription live streams',
      backend: 'Invidious RSS'
    })

    switch (failedAttempts) {
      case 0:
        return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
      case 1:
        if (process.env.SUPPORTS_LOCAL_API && store.getters.getBackendFallback) {
          showInvidiousFallbackToast('invidious')
          return await getChannelLiveLocalRSS(channel, t, errorChannels, failedAttempts + 1)
        }
        return { videos: null }
      case 2:
        return await getChannelLiveInvidious(channel, t, errorChannels, failedAttempts + 1)
      default:
        return { videos: null }
    }
  }
}
