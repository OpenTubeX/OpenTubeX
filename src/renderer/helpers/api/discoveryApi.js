import {
  extractLocalCacheableSearchContinuation,
  getLocalChannel,
  getLocalSearchContinuation,
  getLocalSearchResults,
  getLocalTrending,
  parseLocalChannelHeader,
} from './local'
import {
  getInvidiousPopularFeed,
  getInvidiousSearchResults,
  invidiousGetChannelInfo,
  invidiousImageUrlToInvidious,
  youtubeImageUrlToInvidious,
} from './invidious'
import { createDiscoveryApi } from './createDiscoveryApi'

export const discoveryApi = createDiscoveryApi({
  searchLocal: getLocalSearchResults,
  continueLocal: getLocalSearchContinuation,
  cacheLocalContinuation: extractLocalCacheableSearchContinuation,
  searchInvidious: getInvidiousSearchResults,
  getTrendingLocal: getLocalTrending,
  getPopularInvidious: getInvidiousPopularFeed,
  async getChannelLocal(id) {
    const channel = await getLocalChannel(id)
    return channel.alert ? null : parseLocalChannelHeader(channel)
  },
  getChannelInvidious: invidiousGetChannelInfo,
  youtubeImageToInvidious: youtubeImageUrlToInvidious,
  invidiousImageToInvidious: invidiousImageUrlToInvidious,
})
