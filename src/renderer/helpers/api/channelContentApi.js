import {
  getLocalChannel, getLocalChannelId, getLocalArtistTopicChannelReleases,
  getLocalArtistTopicChannelReleasesContinuation, parseLocalChannelShorts,
  parseLocalChannelVideos, parseLocalListPlaylist, parseLocalCommunityPosts,
  parseLocalListVideo,
} from './local'
import {
  getInvidiousChannelLive, getInvidiousChannelPlaylists, getInvidiousChannelPodcasts,
  getInvidiousChannelReleases, getInvidiousChannelCourses, getInvidiousChannelShorts,
  invidiousGetChannelId, invidiousGetChannelInfo, invidiousGetCommunityPosts,
  searchInvidiousChannel, youtubeImageUrlToInvidious,
} from './invidious'
import { createChannelContentApi } from './createChannelContentApi'
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
})
