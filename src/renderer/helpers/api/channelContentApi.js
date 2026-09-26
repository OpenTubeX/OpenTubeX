import {
  getLocalChannel, getLocalChannelId, getLocalArtistTopicChannelReleases,
  getLocalArtistTopicChannelReleasesContinuation, parseLocalChannelShorts,
  parseLocalChannelVideos, parseLocalChannelHeader, parseLocalSubscriberCount,
  parseLocalListPlaylist, parseLocalCommunityPosts, parseLocalListVideo,
} from './local'
import { YTNodes } from 'youtubei.js'
import {
  getInvidiousChannelLive, getInvidiousChannelPlaylists, getInvidiousChannelPodcasts,
  getInvidiousChannelReleases, getInvidiousChannelCourses, getInvidiousChannelShorts,
  invidiousGetChannelId, invidiousGetChannelInfo, invidiousGetCommunityPosts,
  searchInvidiousChannel, youtubeImageUrlToInvidious,
} from './invidious'
import { createChannelContentApi } from './createChannelContentApi'
import { contentApi } from './contentApi'
import { getInvidiousChannelSearchResultType, getLocalChannelSearchResultType } from '../../views/Channel/channel-search'

const sectionLoaders = {
  shorts: getInvidiousChannelShorts,
  live: getInvidiousChannelLive,
  playlists: getInvidiousChannelPlaylists,
  releases: (id, _sort, continuation) => getInvidiousChannelReleases(id, continuation),
  podcasts: (id, _sort, continuation) => getInvidiousChannelPodcasts(id, continuation),
  courses: (id, _sort, continuation) => getInvidiousChannelCourses(id, continuation),
  community: (id, _sort, continuation) => invidiousGetCommunityPosts(id, continuation),
}

export const channelContentApi = createChannelContentApi({
  localAvailable: !!process.env.SUPPORTS_LOCAL_API,
  getLocalId: getLocalChannelId,
  getInvidiousId: invidiousGetChannelId,
  getLocalChannel,
  getInvidiousChannel: invidiousGetChannelInfo,
  parseLocalHeader: parseLocalChannelHeader,
  parseSubscriberCount: parseLocalSubscriberCount,
  getAgeGate: channel => {
    if (!channel.memo.has('ChannelAgeGate')) return null
    const ageGate = channel.memo.get('ChannelAgeGate')[0]
    return { name: ageGate.channel_title, thumbnail: ageGate.avatar[0].url }
  },
  mayContainOtherChannels: channel =>
    !!channel.header?.is(YTNodes.CarouselHeader, YTNodes.InteractiveTabbedHeader) ||
    !!(channel.header?.is(YTNodes.PageHeader) && channel.header.content?.animated_image),
  parseShorts: parseLocalChannelShorts,
  parseVideos: parseLocalChannelVideos,
  parsePlaylists: (playlists, id, name) => playlists.map(playlist => parseLocalListPlaylist(playlist, id, name)),
  parsePosts: parseLocalCommunityPosts,
  getInvidiousSection: (section, id, sort, continuation) => sectionLoaders[section](id, sort, continuation),
  getArtistReleases: getLocalArtistTopicChannelReleases,
  getArtistReleasesMore: getLocalArtistTopicChannelReleasesContinuation,
  parseSearchVideo: parseLocalListVideo,
  parseSearchPlaylist: parseLocalListPlaylist,
  getInvidiousSearch: searchInvidiousChannel,
  getLocalSearchType: getLocalChannelSearchResultType,
  getInvidiousSearchType: getInvidiousChannelSearchResultType,
  mapImage: youtubeImageUrlToInvidious,
  getVideosPage: options => contentApi.getChannelVideosPage(options),
})
