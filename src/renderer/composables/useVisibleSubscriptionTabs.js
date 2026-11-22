import { computed } from 'vue'

import store from '../store/index'
import { getFollowedChannels } from '../helpers/platformFeed'
import { getVisibleSubscriptionTabs } from '../helpers/subscriptionTabs'
import { supportsYtDlp } from '../helpers/ytDlpCapabilities'

/** The tabs the subscriptions page shows, in the order the user chose. */
export function useVisibleSubscriptionTabs() {
  return computed(() => getVisibleSubscriptionTabs(store.getters.getSubscriptionTabs, {
    hideVideos: store.getters.getHideSubscriptionsVideos,
    hideShorts: store.getters.getHideSubscriptionsShorts,
    hideLive: store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive,
    hideCommunity: store.getters.getHideSubscriptionsCommunity,
    showNewFeed: store.getters.getShowNewSubscriptionFeed,
    // Items from other platforms open through yt-dlp
    enableRssFeeds: supportsYtDlp && store.getters.getEnableRssFeeds,
    hasFollowedChannels: getFollowedChannels().length > 0,
  }))
}
