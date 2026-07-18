<template>
  <div
    class="subscriptionsPage"
    :class="{ hasTabBar: isElectron }"
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
            class="tabs"
            role="tablist"
            :aria-label="$t('Subscriptions.Subscriptions Tabs')"
          >
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-if="!hideSubscriptionsVideos"
              ref="videosTab"
              class="tab"
              role="tab"
              :aria-selected="currentTab === 'videos'"
              aria-controls="subscriptionsPanel"
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
            v-if="currentTabHasVisibleNewContent"
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
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'
import SubscriptionsNew from '../../components/SubscriptionsNew.vue'
import SubscriptionsVideos from '../../components/SubscriptionsVideos.vue'
import SubscriptionsLive from '../../components/SubscriptionsLive.vue'
import SubscriptionsShorts from '../../components/SubscriptionsShorts.vue'
import SubscriptionsPosts from '../../components/SubscriptionsPosts.vue'

import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'

const isElectron = process.env.IS_ELECTRON
const { tabId, isTabPresented } = useTabContext()
const currentTabStorageKey = tabId ? `Subscriptions/${tabId}/currentTab` : 'Subscriptions/currentTab'

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

onMounted(() => {
  isMounted = true
})

watch(currentTab, async (value, previousValue) => {
  if (value !== null) {
  // Save last used tab, restore when view mounted again
    sessionStorage.setItem(currentTabStorageKey, value)
  } else {
    sessionStorage.removeItem(currentTabStorageKey)
  }

  if (!isMounted || (isElectron && isTabPresented?.value !== true)) {
    return
  }

  if (previousValue !== null) {
    tabScrollPositions[previousValue] = window.scrollY
  }

  await nextTick()
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
  const lastCurrentTabId = sessionStorage.getItem(currentTabStorageKey)
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

const currentTabHasVisibleNewContent = computed(() => {
  if (currentTab.value === 'new') {
    return showNewSubscriptionFeed.value && currentTabPanel.value?.hasVisibleNewContent === true
  }

  return showNewSubscriptionFeedIndicators.value && currentTabPanel.value?.hasVisibleNewContent === true
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
</script>

<style scoped src="./Subscriptions.css" />
