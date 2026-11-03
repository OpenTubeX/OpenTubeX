<template>
  <div
    ref="panelRef"
    tabindex="-1"
  >
    <!-- Stays mounted so that screen readers announce the banner when it appears -->
    <div
      class="errorStatus"
      role="status"
    >
      <div
        v-if="isBannerShown"
        ref="bannerRef"
        class="errorBanner"
      >
        <FtIcon
          class="errorBannerIcon"
          :icon="['fas', 'triangle-exclamation']"
          aria-hidden="true"
        />
        <p class="errorBannerText">
          {{ t('Subscriptions.RSS Feeds.Refresh Errors', { count: errorFeedUrls.length }, errorFeedUrls.length) }}
        </p>
        <FtIconButton
          :title="t('Close')"
          :icon="['fas', 'xmark']"
          theme="base-no-default"
          :size="16"
          :padding="6"
          @click="dismissErrors"
        />
      </div>
    </div>
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
      v-else-if="!isLoading && items.length === 0 && (errorFeedUrls.length < feeds.length || rssFeedErrorsDismissed)"
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
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtIcon from '../FtIcon/FtIcon.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtListFeedItem from '../FtListFeedItem/FtListFeedItem.vue'
import FtSkeletonGrid from '../FtSkeletonGrid/FtSkeletonGrid.vue'

import store from '../../store/index'
import { useFeedRefreshShortcut } from '../../composables/useFeedRefreshShortcut'
import { useFollowedRssFeedItems } from '../../composables/useFollowedRssFeedItems'
import { useKeepAliveEffectScope } from '../../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatShortDateTime } from '../../helpers/dateFormat'
import {
  getRssFeedItemKey,
  getRssFeedsAutoRefreshInterval,
  openRssFeedManager,
  refreshRssFeeds,
  rssFeedErrors,
  rssFeedErrorsDismissed,
  rssFeedsLastRefresh,
  rssFeedsNextAutoRefresh,
  rssFeedsRefreshing
} from '../../helpers/rssFeeds'
import { getCachedRelativeTimeFormat, getRelativeTimeFromDate } from '../../helpers/utils'

const { locale, t } = useI18n()
useKeepAliveEffectScope()

const now = useRelativeTimeClock()

const { feeds, feedUrls, feedAvatars, items } = useFollowedRssFeedItems()
const itemKeys = computed(() => items.value.map(getRssFeedItemKey))
const errorFeedUrls = computed(() => rssFeedErrors.value.filter(url => feedUrls.value.has(url)))
const isLoading = computed(() => rssFeedsRefreshing.value)

const panelRef = useTemplateRef('panelRef')
const bannerRef = useTemplateRef('bannerRef')

const isBannerShown = computed(() => !isLoading.value && errorFeedUrls.value.length > 0 && !rssFeedErrorsDismissed.value)

function dismissErrors() {
  rssFeedErrorsDismissed.value = true
}

// Runs before the banner unmounts, so a focused close button doesn't take the focus with it
watch(isBannerShown, shown => {
  if (!shown && bannerRef.value?.contains(document.activeElement)) {
    panelRef.value?.focus({ preventScroll: true })
  }
})

// Full width is a single-column grid, so its items render as grid cards.
const layout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')

const lastRefreshTimestamp = computed(() => rssFeedsLastRefresh.value === null
  ? ''
  : getRelativeTimeFromDate(rssFeedsLastRefresh.value, true, true, now.value))

const nextAutoRefresh = computed(() => getRssFeedsAutoRefreshInterval() > 0 ? rssFeedsNextAutoRefresh.value : null)

const nextAutoRefreshTimestamp = computed(() => nextAutoRefresh.value === null
  ? ''
  : formatShortDateTime(nextAutoRefresh.value, locale.value, store.getters.getDateFormat, store.getters.getTimeFormat))

const nextAutoRefreshTooltip = computed(() => {
  if (nextAutoRefresh.value === null) return ''
  const remainingMinutes = Math.round((nextAutoRefresh.value - now.value) / 60000)
  return Math.abs(remainingMinutes) < 60
    ? getCachedRelativeTimeFormat(locale.value, 'auto').format(remainingMinutes, 'minute')
    : getCachedRelativeTimeFormat(locale.value, 'auto').format(Math.round(remainingMinutes / 60), 'hour')
})

const hasNewContent = computed(() => items.value.some(item => item.isNew === true))

function refresh() {
  return refreshRssFeeds(feeds.value)
}

useFeedRefreshShortcut(() => feeds.value.length > 0 && !isLoading.value, refresh)

defineExpose({
  refresh,
  isLoading,
  lastRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle: computed(() => t('Subscriptions.RSS Feeds.Tab')),
  hasNewContent
})
</script>

<style scoped src="./SubscriptionsFeeds.css" />
