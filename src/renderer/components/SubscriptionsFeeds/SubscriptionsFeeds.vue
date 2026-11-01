<template>
  <div>
    <p
      v-if="!isLoading && errorFeedUrls.length > 0"
      class="message"
    >
      {{ t('Subscriptions.RSS Feeds.Refresh Errors', { count: errorFeedUrls.length }, errorFeedUrls.length) }}
    </p>
    <div
      v-if="feeds.length === 0"
      class="noFeeds"
    >
      <p class="message">
        {{ t('Subscriptions.RSS Feeds.No Feeds') }}
      </p>
      <FtButton
        :label="t('Settings.Subscription Settings.Manage RSS Feeds')"
        :icon="['fas', 'rss']"
        @click="openRssFeedManager"
      />
    </div>
    <FtSkeletonGrid v-else-if="isLoading && items.length === 0" />
    <p
      v-else-if="!isLoading && items.length === 0 && errorFeedUrls.length < feeds.length"
      class="message"
    >
      {{ t('Subscriptions.RSS Feeds.Empty Items') }}
    </p>
    <FtAutoGrid
      :grid="layout === 'grid'"
      :item-count="items.length"
      :item-keys="itemKeys"
    >
      <FtListFeedItem
        v-for="(item, index) in items"
        :key="itemKeys[index]"
        :data="item"
        :layout="layout"
        :avatar="feedAvatars.get(item.feedUrl)"
      />
    </FtAutoGrid>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtListFeedItem from '../FtListFeedItem/FtListFeedItem.vue'
import FtSkeletonGrid from '../FtSkeletonGrid/FtSkeletonGrid.vue'

import store from '../../store/index'
import { useKeepAliveEffectScope } from '../../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import {
  openRssFeedManager,
  refreshRssFeeds,
  rssFeedCacheCovers,
  rssFeedErrors,
  rssFeedItems,
  rssFeedsLastRefresh,
  rssFeedsRefreshing
} from '../../helpers/rssFeeds'
import { getRelativeTimeFromDate } from '../../helpers/utils'

const { t } = useI18n()
useKeepAliveEffectScope()

const now = useRelativeTimeClock()

/** @type {import('vue').ComputedRef<import('../../helpers/rssFeeds').RssFeed[]>} */
const feeds = computed(() => store.getters.getFollowedRssFeeds)
const feedUrls = computed(() => new Set(feeds.value.map(feed => feed.url)))
const feedAvatars = computed(() => new Map(feeds.value.map(feed => [feed.url, feed.avatar ?? null])))

// Removed feeds disappear right away, without waiting for the next refresh
const items = computed(() => rssFeedItems.value.filter(item => feedUrls.value.has(item.feedUrl)))
const itemKeys = computed(() => items.value.map(item => `${item.feedUrl}\n${item.id}`))
const errorFeedUrls = computed(() => rssFeedErrors.value.filter(url => feedUrls.value.has(url)))
const isLoading = computed(() => rssFeedsRefreshing.value)

// Full width is a single-column grid, so its items render as grid cards.
const layout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')

const lastRefreshTimestamp = computed(() => rssFeedsLastRefresh.value === null
  ? ''
  : getRelativeTimeFromDate(rssFeedsLastRefresh.value, true, true, now.value))

// Loads on first open and after feeds were added in the settings
watch(feeds, (value) => {
  if (value.length > 0 && !rssFeedCacheCovers(value)) {
    refresh()
  }
}, { immediate: true })

function refresh() {
  return refreshRssFeeds(feeds.value)
}

defineExpose({
  refresh,
  isLoading,
  lastRefreshTimestamp,
  nextAutoRefreshTimestamp: '',
  nextAutoRefreshTooltip: '',
  refreshTitle: computed(() => t('Subscriptions.RSS Feeds.Tab')),
  hasNewContent: false
})
</script>

<style scoped src="./SubscriptionsFeeds.css" />
