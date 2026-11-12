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
          {{ t('Subscriptions.Platforms.Refresh Errors', { count: failedChannels.length }, failedChannels.length) }}
        </p>
        <FtIconButton
          :title="t('Close')"
          :icon="['fas', 'xmark']"
          theme="base-no-default"
          :size="16"
          :padding="6"
          @click="errorDismissed = true"
        />
      </div>
    </div>
    <FtSkeletonGrid v-if="isLoading && !hasItems" />
    <!-- Generic, as the tabbed view shows it for each kind of item -->
    <FtFlexBox v-else-if="!isLoading && !hasItems && !isBannerShown">
      <p class="message">
        {{ t('Platforms.Empty Tab') }}
      </p>
    </FtFlexBox>
    <section
      v-for="section in sections"
      :key="section.id"
      class="mediaSection"
      :data-platform-section="section.id"
    >
      <h3 v-if="activeCategory === null">
        {{ section.title }}
      </h3>
      <FtAutoGrid
        :grid="layout === 'grid'"
        :item-count="section.items.length"
        :item-keys="section.keys"
      >
        <FtListFeedItem
          v-for="(item, index) in section.items"
          :key="section.keys[index]"
          :data="item"
          :layout="layout"
          :avatar="avatars.get(getPlatformChannelKey({ platform: item.platform, id: item.channelId }))"
          :seen-actions="section.id !== 'clips'"
          :seen-marks="platformSeenMarks"
        />
      </FtAutoGrid>
    </section>
  </div>
</template>

<script setup>
import { computed, onActivated, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtAutoGrid from '../FtAutoGrid/FtAutoGrid.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtListFeedItem from '../FtListFeedItem/FtListFeedItem.vue'
import FtSkeletonGrid from '../FtSkeletonGrid/FtSkeletonGrid.vue'

import store from '../../store/index'
import { useFeedRefreshShortcut } from '../../composables/useFeedRefreshShortcut'
import { useKeepAliveEffectScope } from '../../composables/useKeepAliveEffectScope'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatShortDateTime } from '../../helpers/dateFormat'
import {
  activePlatformFeedFilter,
  getFollowedChannels,
  getPlatformFeedAutoRefreshInterval,
  platformFeed,
  platformFeedNextAutoRefresh,
  platformFeedFailedChannels,
  platformFeedLastRefresh,
  platformFeedRefreshing,
  platformSeenMarks,
  refreshPlatformFeed,
  refreshPlatformFeedIfNeeded
} from '../../helpers/platformFeed'
import { getCachedRelativeTimeFormat, getRelativeTimeFromDate } from '../../helpers/utils'
import { getPlatformChannelKey } from '../../../platforms/index'

const props = defineProps({
  /**
   * The kind of items that the tabbed view shows, or null for all of them
   * @type {import('vue').PropType<'videos' | 'live' | 'clips' | null>}
   */
  activeCategory: {
    type: String,
    default: null
  }
})

const { locale, t } = useI18n()
useKeepAliveEffectScope()

const now = useRelativeTimeClock()

const channels = computed(() => getFollowedChannels())
const avatars = computed(() => new Map(channels.value.map(channel => [getPlatformChannelKey(channel), channel.avatar ?? null])))
const allSections = computed(() => {
  // Unfollowed channels disappear right away
  const keys = new Set(channels.value.map(getPlatformChannelKey))
  const { live, videos, clips } = platformFeed.value
  return [
    { id: 'live', title: t('Global.Live'), items: live },
    { id: 'videos', title: t('Global.Videos'), items: videos },
    { id: 'clips', title: t('Subscriptions.Platforms.Clips'), items: clips }
  ].flatMap((section) => {
    const items = section.items.filter(item => (
      keys.has(getPlatformChannelKey({ platform: item.platform, id: item.channelId })) &&
      (activePlatformFeedFilter.value === 'all' || item.platform === activePlatformFeedFilter.value)
    ))
    return items.length === 0 ? [] : [{ ...section, items, keys: items.map(item => `${section.id}:${item.platform}:${item.id}`) }]
  })
})
/** What the panel shows: every section, or that of the current tab */
const sections = computed(() => props.activeCategory === null
  ? allSections.value
  : allSections.value.filter(section => section.id === props.activeCategory))
const hasItems = computed(() => sections.value.length > 0)
// Clips come from viewers, so only live streams and uploads are new content
const hasNewContentByCategory = computed(() => Object.fromEntries(allSections.value.map(section => [
  section.id,
  section.id !== 'clips' && section.items.some(item => item.isNew === true)
])))
/** The new items that the panel shows, which Mark all as seen marks */
const shownNewItems = computed(() => sections.value.flatMap(section => section.id === 'clips' ? [] : section.items.filter(item => item.isNew === true)))
const hasNewContent = computed(() => shownNewItems.value.length > 0)
const isLoading = computed(() => platformFeedRefreshing.value)

const failedChannels = computed(() => {
  const keys = new Set(channels.value.map(getPlatformChannelKey))
  return platformFeedFailedChannels.value.filter(key => keys.has(key))
})
const panelRef = useTemplateRef('panelRef')
const bannerRef = useTemplateRef('bannerRef')
const errorDismissed = ref(false)
const isBannerShown = computed(() => !isLoading.value && failedChannels.value.length > 0 && !errorDismissed.value)

// A closed banner stays closed until the set of failed channels changes
watch(platformFeedFailedChannels, () => { errorDismissed.value = false })

// Runs before the banner unmounts, so a focused close button doesn't take the focus with it
watch(isBannerShown, shown => {
  if (!shown && bannerRef.value?.contains(document.activeElement)) {
    panelRef.value?.focus({ preventScroll: true })
  }
})

// Full width is a single-column grid, so its items render as grid cards.
const layout = computed(() => store.getters.getListType === 'list' ? 'list' : 'grid')

const lastRefreshTimestamp = computed(() => platformFeedLastRefresh.value === null
  ? ''
  : getRelativeTimeFromDate(platformFeedLastRefresh.value, true, true, now.value))

const nextAutoRefresh = computed(() => getPlatformFeedAutoRefreshInterval() > 0 ? platformFeedNextAutoRefresh.value : null)

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

function refresh() {
  return refreshPlatformFeed()
}

// Also for channels followed on another device
watch(channels, refreshPlatformFeedIfNeeded, { immediate: true })
onActivated(refreshPlatformFeedIfNeeded)

useFeedRefreshShortcut(() => channels.value.length > 0 && !isLoading.value, refresh)

defineExpose({
  refresh,
  isLoading,
  lastRefreshTimestamp,
  nextAutoRefreshTimestamp,
  nextAutoRefreshTooltip,
  refreshTitle: computed(() => t('Subscriptions.Platforms.Tab')),
  hasNewContent,
  hasNewContentByCategory,
  shownNewItems
})
</script>

<style scoped src="./SubscriptionsPlatforms.css" />
