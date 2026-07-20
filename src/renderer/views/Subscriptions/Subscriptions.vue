<template>
  <div
    class="subscriptionsPage"
    :class="{ hasTabBar: hasHorizontalTabBar }"
  >
    <FtCard class="card">
      <div class="subscriptionsHeader">
        <div class="titleRow">
          <h2 class="pageTitle">
            <FontAwesomeIcon
              :icon="['fas', 'rss']"
              class="subscriptionIcon"
            />
            {{ $t("Subscriptions.Subscriptions") }}
          </h2>
          <FtRefreshWidget
            v-if="currentTabPanel !== null"
            embedded
            class="headerRefreshWidget"
            :disable-refresh="subscriptionFeedRefreshInProgress || currentTabPanel.isLoading || activeSubscriptionList.length === 0"
            :last-refresh-timestamp="currentTabPanel.lastRefreshTimestamp"
            :next-auto-refresh-timestamp="currentTabPanel.nextAutoRefreshTimestamp"
            :next-auto-refresh-tooltip="currentTabPanel.nextAutoRefreshTooltip"
            :next-auto-refresh-at="currentAutoRefresh.timestamp"
            :auto-refresh-interval="currentAutoRefresh.interval"
            :title="currentTabPanel.refreshTitle"
            @click="refreshCurrentTab"
          />
        </div>
        <div class="tabsRow">
          <FtFlexBox
            ref="tabsContainerRef"
            class="tabs"
            role="tablist"
            :aria-label="$t('Subscriptions.Subscriptions Tabs')"
          >
            <div
              v-if="tabsIndicatorStyle"
              class="tabsIndicator"
              :style="tabsIndicatorStyle"
              aria-hidden="true"
            />
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="!hideSubscriptionsVideos"
              ref="videosTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'videos'"
              aria-controls="subscriptionsPanel"
              data-subscription-feed-tab="videos"
              :tabindex="currentTab === 'videos' ? 0 : -1"
              :class="{ selectedTab: currentTab === 'videos' }"
              @click="changeTab('videos')"
              @keydown.space.enter.prevent="changeTab('videos')"
              @keydown.left.right="focusTab($event, 'videos')"
            >
              <FontAwesomeIcon
                :icon="['fa', 'video']"
                class="subscriptionIcon"
              />
              {{ $t("Global.Videos") }}
              <FtLoader
                v-if="refreshingFeedTab === 'videos'"
                class="tabLoadingIndicator"
              />
            </div>
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="!hideSubscriptionsShorts"
              ref="shortsTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'shorts'"
              aria-controls="subscriptionsPanel"
              data-subscription-feed-tab="shorts"
              :tabindex="currentTab === 'shorts' ? 0 : -1"
              :class="{ selectedTab: currentTab === 'shorts' }"
              @click="changeTab('shorts')"
              @keydown.space.enter.prevent="changeTab('shorts')"
              @keydown.left.right="focusTab($event, 'shorts')"
            >
              <FontAwesomeIcon
                :icon="['fa', 'clapperboard']"
                class="subscriptionIcon"
              />
              {{ $t("Global.Shorts") }}
              <FtLoader
                v-if="refreshingFeedTab === 'shorts'"
                class="tabLoadingIndicator"
              />
            </div>
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="!hideSubscriptionsLive"
              ref="liveTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'live'"
              aria-controls="subscriptionsPanel"
              data-subscription-feed-tab="live"
              :tabindex="currentTab === 'live' ? 0 : -1"
              :class="{ selectedTab: currentTab === 'live' }"
              @click="changeTab('live')"
              @keydown.space.enter.prevent="changeTab('live')"
              @keydown.left.right="focusTab($event, 'live')"
            >
              <FontAwesomeIcon
                :icon="['fa', 'tower-broadcast']"
                class="subscriptionIcon"
              />
              {{ $t("Global.Live") }}
              <FtLoader
                v-if="refreshingFeedTab === 'live'"
                class="tabLoadingIndicator"
              />
            </div>
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="visibleTabs.includes('community')"
              ref="communityTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'community'"
              aria-controls="subscriptionsPanel"
              data-subscription-feed-tab="posts"
              :tabindex="currentTab === 'community' ? 0 : -1"
              :class="{ selectedTab: currentTab === 'community' }"
              @click="changeTab('community')"
              @keydown.space.enter.prevent="changeTab('community')"
              @keydown.left.right="focusTab($event, 'community')"
            >
              <FontAwesomeIcon
                :icon="['fa', 'message']"
                class="subscriptionIcon"
              />
              {{ $t("Global.Posts") }}
              <FtLoader
                v-if="refreshingFeedTab === 'posts'"
                class="tabLoadingIndicator"
              />
            </div>
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="visibleTabs.includes('new')"
              ref="newTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'new'"
              aria-controls="subscriptionsPanel"
              data-subscription-feed-tab="all"
              :tabindex="currentTab === 'new' ? 0 : -1"
              :class="{ selectedTab: currentTab === 'new' }"
              @click="changeTab('new')"
              @keydown.space.enter.prevent="changeTab('new')"
              @keydown.left.right="focusTab($event, 'new')"
            >
              <FontAwesomeIcon
                :icon="['fa', 'fire']"
                class="subscriptionIcon"
              />
              {{ $t("Global.New") }}
            </div>
          </FtFlexBox>
          <button
            v-if="currentTabHasNewContent"
            class="markAllSeenButton"
            type="button"
            :disabled="markingSeenTab !== null || subscriptionFeedRefreshInProgress"
            @click="markAllAsSeen(currentTab)"
          >
            <FontAwesomeIcon :icon="['fas', 'check']" />
            {{ $t('Subscriptions.Mark All as Seen') }}
          </button>
        </div>
        <div
          v-if="currentTabRefreshing"
          class="tabsProgressBar"
          :style="{ inlineSize: refreshProgressPercentage + '%' }"
        />
      </div>
      <SubscriptionsVideos
        v-if="currentTab === 'videos'"
        id="subscriptionsPanel"
        key="subscriptions-videos"
        ref="videosPanel"
        role="tabpanel"
      />
      <SubscriptionsShorts
        v-else-if="currentTab === 'shorts'"
        id="subscriptionsPanel"
        key="subscriptions-shorts"
        ref="shortsPanel"
        role="tabpanel"
      />
      <SubscriptionsLive
        v-else-if="currentTab === 'live'"
        id="subscriptionsPanel"
        key="subscriptions-live"
        ref="livePanel"
        role="tabpanel"
      />
      <SubscriptionsPosts
        v-else-if="currentTab === 'community'"
        id="subscriptionsPanel"
        key="subscriptions-community"
        ref="communityPanel"
        role="tabpanel"
      />
      <SubscriptionsNew
        v-else-if="currentTab === 'new'"
        id="subscriptionsPanel"
        key="subscriptions-new"
        ref="newPanel"
        role="tabpanel"
      />
      <p v-else>
        {{ $t("Subscriptions.All Subscription Tabs Hidden", {
          subsection: $t('Settings.Distraction Free Settings.Sections.Subscriptions Page'),
          settingsSection: $t('Settings.Distraction Free Settings.Distraction Free Settings')
        }) }}
      </p>
      <FtPrompt
        v-if="showAllFeedsRefreshWarning"
        :label="$t('Subscriptions.New Feed Refresh Warning Title')"
        :extra-labels="[$t('Subscriptions.New Feed Refresh Warning', { count: allFeedsActiveSubscriptionIds.size })]"
        :option-names="[$t('Yes'), $t('No')]"
        :option-values="['refresh', 'cancel']"
        autosize
        @click="handleAllFeedsRefreshWarning"
      />
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'
import SubscriptionsNew from '../../components/SubscriptionsNew.vue'
import SubscriptionsVideos from '../../components/SubscriptionsVideos.vue'
import SubscriptionsLive from '../../components/SubscriptionsLive.vue'
import SubscriptionsShorts from '../../components/SubscriptionsShorts.vue'
import SubscriptionsPosts from '../../components/SubscriptionsPosts.vue'

import store from '../../store/index'
import { useTabContext, useTabLifecycle } from '../../tabs/TabContext'
import { useRefreshAllSubscriptionFeeds } from '../../composables/useRefreshAllSubscriptionFeeds'
import {
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../../helpers/subscriptions'

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const hasHorizontalTabBar = computed(() => isElectron && !store.getters.getUseVerticalTabBar)

const { tabId, isTabPresented } = useTabContext()
const { t } = useI18n()
const {
  activeSubscriptionIds: allFeedsActiveSubscriptionIds,
  handleRefreshWarning: handleAllFeedsRefreshWarning,
  refresh: refreshAllFeeds,
  showRefreshWarning: showAllFeedsRefreshWarning
} = useRefreshAllSubscriptionFeeds()
const currentTabStorageKey = 'Subscriptions/currentTab'

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsVideos = computed(() => {
  return store.getters.getHideSubscriptionsVideos
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsShorts = computed(() => {
  return store.getters.getHideSubscriptionsShorts
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsLive = computed(() => {
  return store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsCommunity = computed(() => {
  return store.getters.getHideSubscriptionsCommunity
})

const showNewSubscriptionFeedIndicators = computed(() => {
  return store.getters.getShowNewSubscriptionFeedIndicators
})

const showNewSubscriptionFeed = computed(() => {
  return store.getters.getShowNewSubscriptionFeed
})

const activeSubscriptionList = computed(() => {
  return store.getters.getActiveProfile.subscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const useRssFeeds = computed(() => {
  return store.getters.getUseRssFeeds
})

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionFeedRefreshInProgress = computed(() => {
  return store.getters.getSubscriptionFeedRefreshInProgress
})

/** @type {import('vue').ComputedRef<'videos' | 'shorts' | 'live' | 'posts' | null>} */
const refreshingFeedTab = computed(() => {
  return subscriptionFeedRefreshInProgress.value ? store.getters.getSubscriptionFeedRefreshTab : null
})

const currentTabRefreshing = computed(() => {
  if (currentTab.value === 'new') {
    return refreshingFeedTab.value !== null
  }

  const currentFeedTab = currentTab.value === 'community' ? 'posts' : currentTab.value
  return refreshingFeedTab.value !== null && refreshingFeedTab.value === currentFeedTab
})

/** @type {import('vue').ComputedRef<number>} */
const refreshProgressPercentage = computed(() => {
  return store.getters.getProgressBarPercentage
})

/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'community' | 'new' | null>} */
const currentTab = ref('videos')

const tabScrollPositions = {
  videos: 0,
  shorts: 0,
  live: 0,
  community: 0,
  new: 0
}

let isMounted = false
// Presentation becomes ready only after the app-level tab scroll has been restored.
let isTabScrollReady = !isElectron
let removeFeedReloadRequestListener = null

useTabLifecycle({
  activate() {
    isTabScrollReady = true
  },
  deactivate() {
    isTabScrollReady = false
  }
})

onMounted(() => {
  isMounted = true

  if (isElectron) {
    removeFeedReloadRequestListener = window.ftElectron.subscriptionFeeds.onRequestReload(handleFeedReloadRequest)
  }
})

onBeforeUnmount(() => {
  removeFeedReloadRequestListener?.()
})

watch(currentTab, async (value, previousValue) => {
  if (value !== null) {
    // Use the last selected feed when opening another subscription view
    localStorage.setItem(currentTabStorageKey, value)
  } else {
    localStorage.removeItem(currentTabStorageKey)
  }

  if (!isMounted || !isTabScrollReady || (isElectron && isTabPresented?.value !== true)) {
    return
  }

  if (previousValue !== null) {
    tabScrollPositions[previousValue] = window.scrollY
  }

  await nextTick()
  if (!isTabScrollReady || (isElectron && isTabPresented?.value !== true)) {
    return
  }
  window.scrollTo(0, value === null ? 0 : tabScrollPositions[value])
})

const visibleTabs = computed(() => {
  /** @type {('videos' | 'shorts' | 'live' | 'community' | 'new')[]} */
  const tabs = []

  if (!hideSubscriptionsVideos.value) {
    tabs.push('videos')
  }

  if (!hideSubscriptionsShorts.value) {
    tabs.push('shorts')
  }

  if (!hideSubscriptionsLive.value) {
    tabs.push('live')
  }

  // community does not support rss
  if (!hideSubscriptionsCommunity.value && !useRssFeeds.value) {
    tabs.push('community')
  }

  if (showNewSubscriptionFeed.value && tabs.length > 0) {
    tabs.push('new')
  }

  return tabs
})

watch(visibleTabs, (value) => {
  if (value.length === 0) {
    currentTab.value = null
  } else if (!value.includes(currentTab.value)) {
    currentTab.value = value[0]
  }
})

if (visibleTabs.value.length === 0) {
  currentTab.value = null
} else {
  // Restore currentTab
  const lastCurrentTabId = localStorage.getItem(currentTabStorageKey)
  if (lastCurrentTabId !== null) {
    changeTab(lastCurrentTabId)
  } else if (!visibleTabs.value.includes(currentTab.value)) {
    currentTab.value = visibleTabs.value[0]
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 */
function changeTab(tab) {
  if (tab === currentTab.value) {
    return
  }

  if (visibleTabs.value.includes(tab)) {
    currentTab.value = tab
  } else {
    // First visible tab or no tab
    currentTab.value = visibleTabs.value.length > 0 ? visibleTabs.value[0] : null
  }
}

const videosTab = useTemplateRef('videosTab')
const liveTab = useTemplateRef('liveTab')
const shortsTab = useTemplateRef('shortsTab')
const communityTab = useTemplateRef('communityTab')
const newTab = useTemplateRef('newTab')
const videosPanel = useTemplateRef('videosPanel')
const livePanel = useTemplateRef('livePanel')
const shortsPanel = useTemplateRef('shortsPanel')
const communityPanel = useTemplateRef('communityPanel')
const newPanel = useTemplateRef('newPanel')

const currentTabPanel = computed(() => {
  switch (currentTab.value) {
    case 'videos':
      return videosPanel.value
    case 'live':
      return livePanel.value
    case 'shorts':
      return shortsPanel.value
    case 'community':
      return communityPanel.value
    case 'new':
      return newPanel.value
    default:
      return null
  }
})

const currentTabHasNewContent = computed(() => {
  if (currentTab.value === 'new') {
    return showNewSubscriptionFeed.value && currentTabPanel.value?.hasNewContent === true
  }

  return showNewSubscriptionFeedIndicators.value && currentTabPanel.value?.hasNewContent === true
})

/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'community' | 'new' | null>} */
const markingSeenTab = ref(null)

/**
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 */
async function markAllAsSeen(tab) {
  if (markingSeenTab.value !== null) {
    return
  }

  markingSeenTab.value = tab
  try {
    const feedTabs = tab === 'new'
      ? visibleTabs.value.filter(visibleTab => visibleTab !== 'new')
      : [tab]

    for (const feedTab of feedTabs) {
      await store.dispatch(
        'markSubscriptionEntriesAsSeen',
        {
          tab: feedTab === 'community' ? 'posts' : feedTab,
          channelIds: activeSubscriptionList.value.map(channel => channel.id)
        }
      )
    }
  } finally {
    markingSeenTab.value = null
  }
}

const currentAutoRefresh = computed(() => {
  let timestamp
  let interval

  switch (currentTab.value) {
    case 'videos':
      timestamp = store.getters.getSubscriptionFeedNextAutoRefreshTimestamp
      interval = store.getters.getSubscriptionFeedAutoRefreshInterval
      break
    case 'shorts':
      timestamp = store.getters.getSubscriptionShortsNextAutoRefreshTimestamp
      interval = store.getters.getSubscriptionShortsAutoRefreshInterval
      break
    case 'live':
      timestamp = store.getters.getSubscriptionLiveNextAutoRefreshTimestamp
      interval = store.getters.getSubscriptionLiveAutoRefreshInterval
      break
    case 'community':
      timestamp = store.getters.getSubscriptionPostsNextAutoRefreshTimestamp
      interval = store.getters.getSubscriptionPostsAutoRefreshInterval
      break
    default:
      return { timestamp: 0, interval: 0 }
  }

  return {
    timestamp: Number(timestamp) || 0,
    interval: Number.parseInt(interval, 10) || 0
  }
})

/**
 * @param {KeyboardEvent} event
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} focusedTab
 */
function focusTab(event, focusedTab) {
  if (event.altKey) {
    return
  }

  event.preventDefault()

  const visibleTabsCached = visibleTabs.value

  if (visibleTabsCached.length === 1) {
    store.commit('setOutlinesHidden', false)
    return
  }

  let index = visibleTabsCached.indexOf(focusedTab)

  if (event.key === 'ArrowLeft') {
    index--
  } else {
    index++
  }

  if (index < 0) {
    index = visibleTabsCached.length - 1
  } else if (index > visibleTabsCached.length - 1) {
    index = 0
  }

  switch (visibleTabsCached[index]) {
    case 'videos':
      videosTab.value?.focus()
      break
    case 'live':
      liveTab.value?.focus()
      break
    case 'shorts':
      shortsTab.value?.focus()
      break
    case 'community':
      communityTab.value?.focus()
      break
    case 'new':
      newTab.value?.focus()
      break
  }

  store.commit('setOutlinesHidden', false)
}

function refreshCurrentTab() {
  currentTabPanel.value?.refresh()
}

/**
 * @param {{tabId: string, feedTab: 'videos' | 'shorts' | 'live' | 'posts' | 'all'}} payload
 */
async function handleFeedReloadRequest(payload) {
  if (payload?.tabId !== tabId || subscriptionFeedRefreshInProgress.value) {
    return
  }

  const viewTab = payload.feedTab === 'posts'
    ? 'community'
    : payload.feedTab === 'all' ? 'new' : payload.feedTab
  if (viewTab === currentTab.value) {
    refreshCurrentTab()
    return
  }

  if (payload.feedTab === 'all') {
    refreshAllFeeds()
    return
  }

  const options = { t, errorChannels: [] }
  const refreshers = {
    videos: refreshSubscriptionVideosFromRemote,
    shorts: refreshSubscriptionShortsFromRemote,
    live: refreshSubscriptionLiveFromRemote,
    posts: refreshSubscriptionPostsFromRemote
  }

  await refreshers[payload.feedTab]?.(options)
}

// ===== Sliding feed tab indicator =====
const tabsContainerRef = useTemplateRef('tabsContainerRef')
/** @type {import('vue').Ref<Record<string, string> | null>} */
const tabsIndicatorStyle = ref(null)
let tabsResizeObserver = null
// Place the indicator without animating when it was last measured while
// hidden (e.g. in a background browser tab, where all offsets read 0),
// otherwise it visibly flies in from the stale position.
let tabsIndicatorWasHidden = true

function updateTabsIndicator() {
  const container = tabsContainerRef.value?.$el
  const selected = container?.querySelector('.tab.selectedTab')

  if (!(selected instanceof HTMLElement)) {
    tabsIndicatorStyle.value = null
    tabsIndicatorWasHidden = true
    return
  }

  if (selected.getClientRects().length === 0) {
    tabsIndicatorWasHidden = true
    return
  }

  // Physical values to match the physical offset measurements (RTL-safe).
  // The indicator sits just below the tab, like the old selectedTab border
  // (which extended past the box through its -3px margin).
  const style = {
    left: `${selected.offsetLeft}px`,
    top: `${selected.offsetTop + selected.offsetHeight}px`,
    width: `${selected.offsetWidth}px`
  }

  if (tabsIndicatorWasHidden) {
    style.transition = 'none'
    tabsIndicatorWasHidden = false
  }

  tabsIndicatorStyle.value = style
}

watch([currentTab, visibleTabs, refreshingFeedTab], () => nextTick(updateTabsIndicator))

onMounted(() => {
  if (typeof ResizeObserver === 'function') {
    // Tab widths shift on hover (bold text) and when the per-tab loader
    // appears, which also resizes the container
    tabsResizeObserver = new ResizeObserver(() => updateTabsIndicator())

    if (tabsContainerRef.value?.$el instanceof HTMLElement) {
      tabsResizeObserver.observe(tabsContainerRef.value.$el)
    }
  }

  nextTick(updateTabsIndicator)
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
})
</script>

<style scoped src="./Subscriptions.css" />
