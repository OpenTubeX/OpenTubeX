import {
  getHashtagLocal, getLocalCommunityPost, getLocalPlaylist,
  getLocalPlaylistContinuation, extractLocalCacheablePlaylistContinuation,
  parseLocalListVideo, parseLocalPlaylistVideos,
  parseLocalChannelVideos,
} from './local'
import {
  getHashtagInvidious, getInvidiousCommunityPost, invidiousGetPlaylistInfo,
  youtubeImageUrlToInvidious, getInvidiousChannelVideos,
} from './invidious'
import { hasMoreInvidiousPlaylistPages, mergeInvidiousPlaylistVideos } from './invidious-playlists'
import { extractNumberFromString, getChannelPlaylistId } from '../utils'
import { createContentApi } from './createContentApi'

export const contentApi = createContentApi({
  localAvailable: !!process.env.SUPPORTS_LOCAL_API,
  getLocalPost: getLocalCommunityPost,
  getInvidiousPost: getInvidiousCommunityPost,
  getLocalHashtag: getHashtagLocal,
  getInvidiousHashtag: getHashtagInvidious,
  parseLocalVideo: parseLocalListVideo,
  getLocalPlaylist,
  getLocalPlaylistContinuation,
  getCacheableLocalPlaylistContinuation: extractLocalCacheablePlaylistContinuation,
  parseLocalPlaylistVideos,
  getInvidiousPlaylist: invidiousGetPlaylistInfo,
  parseCount: extractNumberFromString,
  mapInvidiousImage: youtubeImageUrlToInvidious,
  hasMoreInvidiousPages: hasMoreInvidiousPlaylistPages,
  mergeInvidiousVideos: mergeInvidiousPlaylistVideos,
  getInvidiousChannelVideos,
  parseLocalChannelVideos,
  makeChannelPlaylistId: getChannelPlaylistId,
})
