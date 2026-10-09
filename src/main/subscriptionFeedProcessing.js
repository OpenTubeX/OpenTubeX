import { Mixins, Utils, YT } from 'youtubei.js'
import { createLocalFeedParsers } from '../renderer/helpers/api/local-feed-parsers.js'
import { parseSubscriptionRss } from '../renderer/helpers/api/feed-rss.js'
import { getEmptyLiveContinuation } from '../subscriptionBackgroundRequests.js'

/** Parse foreground responses in the same process as hidden-window refreshes. */
export function processSubscriptionFeed({ format, data, text, feedType, channelId, channelName, hideMembersOnly = true }) {
  if (format === 'rss') return parseSubscriptionRss(text, channelId)
  const parsers = createLocalFeedParsers(isMembersOnly => isMembersOnly && hideMembersOnly)
  if (format === 'localContinuation') {
    return {
      videos: parsers.parseLocalChannelVideos(new Mixins.Feed(null, { data }).videos, channelId, channelName),
      continuation: getEmptyLiveContinuation(data),
    }
  }
  try {
    const channel = new YT.Channel(null, { data })
    const suffix = { videos: '/videos', live: '/streams', posts: '/posts' }[feedType]
    const selected = channel.current_tab?.endpoint.metadata.url?.endsWith(suffix)
    if (feedType === 'posts') return { posts: selected ? parsers.parseLocalCommunityPosts(channel.posts) : [] }
    const { id = channelId, name, thumbnailUrl } = parsers.parseLocalChannelHeader(channel, true)
    return {
      channelId: id,
      name,
      thumbnailUrl,
      videos: selected ? parsers.parseLocalChannelVideos(channel.videos, id, name) : [],
      needsUploadsPlaylist: feedType === 'videos' && !selected && name.endsWith('- Topic') && !!channel.metadata.music_artist_name,
      continuation: feedType === 'live' && selected ? getEmptyLiveContinuation(data) : null,
    }
  } catch (error) {
    if (error instanceof Utils.ChannelError) return null
    throw error
  }
}
