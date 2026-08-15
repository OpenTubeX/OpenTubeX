<template>
  <div
    class="subscriptionsPage"
    :class="{ hasTabBar: hasHorizontalTabBar }"
  >
    <FtCard class="card">
      <div
        class="subscriptionsHeader"
        :class="{ singleRow: headerFitsOneRow }"
      >
        <div
          ref="headerRowRef"
          class="headerRow"
        >
          <h2 class="pageTitle">
            <FtIcon
              :icon="['fas', 'rss']"
              class="subscriptionIcon"
            />
            {{ $t("Subscriptions.Subscriptions") }}
          </h2>
          <div
            ref="tabsRowRef"
            class="tabsRow"
          >
            <FtFlexBox
              ref="tabsContainerRef"
              class="tabs"
              role="tablist"
              :aria-label="$t('Subscriptions.Subscriptions Tabs')"
            >
              <div
                v-if="tabsIndicatorStyle"
                class="tabsIndicator"
                data-animation-speed-managed
                :style="[tabsIndicatorStyle, { transitionDuration: tabsIndicatorTransitionDuration }]"
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
                :class="{ selectedTab: selectedTab === 'videos' }"
                @click="changeTab('videos')"
                @keydown.space.enter.prevent="changeTab('videos')"
                @keydown.left.right="focusTab($event, 'videos')"
              >
                <FtIcon
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
                :class="{ selectedTab: selectedTab === 'shorts' }"
                @click="changeTab('shorts')"
                @keydown.space.enter.prevent="changeTab('shorts')"
                @keydown.left.right="focusTab($event, 'shorts')"
              >
                <FtIcon
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
                :class="{ selectedTab: selectedTab === 'live' }"
                @click="changeTab('live')"
                @keydown.space.enter.prevent="changeTab('live')"
                @keydown.left.right="focusTab($event, 'live')"
              >
                <FtIcon
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
                :class="{ selectedTab: selectedTab === 'community' }"
                @click="changeTab('community')"
                @keydown.space.enter.prevent="changeTab('community')"
                @keydown.left.right="focusTab($event, 'community')"
              >
                <FtIcon
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
                :class="{ selectedTab: selectedTab === 'new' }"
                @click="changeTab('new')"
                @keydown.space.enter.prevent="changeTab('new')"
                @keydown.left.right="focusTab($event, 'new')"
              >
                <FtIcon
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
              :disabled="markingSeenTab !== null || currentTabRefreshing"
              @click="markAllAsSeen(currentTab)"
            >
              <FtIcon :icon="['fas', 'check']" />
              {{ $t('Subscriptions.Mark All as Seen') }}
            </button>
          </div>
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
            :refresh-in-progress="subscriptionFeedRefreshInProgress"
            @click="refreshCurrentTab"
            @cancel="cancelRefresh"
          />
        </div>
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
        :extra-labels="[$t('Subscriptions.New Feed Refresh Warning', { count: allFeedsActiveSubscriptionIds.size }, allFeedsActiveSubscriptionIds.size)]"
        :option-names="[$t('Yes'), $t('No')]"
        :option-values="['refresh', 'cancel']"
        autosize
        @click="handleAllFeedsRefreshWarning"
      />
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
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

import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { useRefreshAllSubscriptionFeeds } from '../../composables/useRefreshAllSubscriptionFeeds'
import {
  requestSubscriptionRefreshCancellation,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../../helpers/subscriptions'

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const hasHorizontalTabBar = computed(() => isElectron && store.getters.getTabBarPosition === 'top')

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

/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'community' | 'new' | null>} */
const currentTab = ref('videos')
const selectedTab = ref('videos')

const tabScrollPositions = {
  videos: 0,
  shorts: 0,
  live: 0,
  community: 0,
  new: 0
}

const subscriptionRefreshTimestamps = computed(() => [
  store.getters.getSubscriptionFeedLastRefreshTimestamp,
  store.getters.getSubscriptionShortsLastRefreshTimestamp,
  store.getters.getSubscriptionLiveLastRefreshTimestamp,
  store.getters.getSubscriptionPostsLastRefreshTimestamp
])

watch(subscriptionRefreshTimestamps, (timestamps, previousTimestamps) => {
  const feedTabs = ['videos', 'shorts', 'live', 'community']

  timestamps.forEach((timestamp, index) => {
    if (timestamp && timestamp !== previousTimestamps[index]) {
      resetScrollAfterRefresh(feedTabs[index])
    }
  })
})

/**
 * @param {'videos' | 'shorts' | 'live' | 'community'} refreshedTab
 */
async function resetScrollAfterRefresh(refreshedTab) {
  tabScrollPositions[refreshedTab] = 0
  tabScrollPositions.new = 0

  if (currentTab.value !== refreshedTab && currentTab.value !== 'new') {
    return
  }

  if (isElectron && tabId) {
    getTabNavigationService().resetScroll(tabId)
  } else {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
  }

  // The completion event is dispatched before the refreshed array reaches
  // this view. Correct the scroll again after Vue and browser scroll anchoring
  // have applied the new list layout.
  await nextTick()
  await nextAnimationFrame()
  await nextAnimationFrame()

  if (
    isMounted &&
    (currentTab.value === refreshedTab || currentTab.value === 'new') &&
    (!isElectron || isTabPresented?.value === true)
  ) {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
  }
}

function nextAnimationFrame() {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

let isMounted = false
let removeFeedReloadRequestListener = null
/** @type {number | null} */
let pendingTabChangeFrame = null
let tabChangeSequence = 0

onMounted(() => {
  isMounted = true

  if (isElectron) {
    removeFeedReloadRequestListener = window.ftElectron.subscriptionFeeds.onRequestReload(handleFeedReloadRequest)
  }
})

onBeforeUnmount(() => {
  isMounted = false
  tabChangeSequence++
  removeFeedReloadRequestListener?.()

  if (pendingTabChangeFrame !== null) {
    window.cancelAnimationFrame(pendingTabChangeFrame)
    pendingTabChangeFrame = null
  }
})

watch(currentTab, async (value, previousValue) => {
  if (value !== null) {
    // Use the last selected feed when opening another subscription view
    localStorage.setItem(currentTabStorageKey, value)
  } else {
    localStorage.removeItem(currentTabStorageKey)
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
    // Invalidate both scheduled nextTick work and an already queued frame so a
    // deferred switch cannot restore a feed after its final tab is hidden.
    tabChangeSequence++
    if (pendingTabChangeFrame !== null) {
      window.cancelAnimationFrame(pendingTabChangeFrame)
      pendingTabChangeFrame = null
    }

    selectedTab.value = null
    currentTab.value = null
  } else if (!value.includes(selectedTab.value)) {
    changeTab(value[0])
  }
})

if (visibleTabs.value.length === 0) {
  selectedTab.value = null
  currentTab.value = null
} else {
  // Restore currentTab
  const lastCurrentTabId = localStorage.getItem(currentTabStorageKey)
  if (lastCurrentTabId !== null) {
    changeTab(lastCurrentTabId)
  } else if (!visibleTabs.value.includes(currentTab.value)) {
    selectedTab.value = visibleTabs.value[0]
    currentTab.value = visibleTabs.value[0]
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 */
function changeTab(tab) {
  // A pending change from a previous click is always dropped, its indicator
  // placement included, so the last clicked tab wins
  const hadPendingChange = pendingTabChangeFrame !== null

  if (hadPendingChange) {
    window.cancelAnimationFrame(pendingTabChangeFrame)
    pendingTabChangeFrame = null
  }

  if (tab === selectedTab.value) {
    if (hadPendingChange) {
      // Complete the cancelled panel swap so the highlighted tab and its
      // content cannot get separated by a repeated activation.
      currentTab.value = tab
      updateTabsIndicator()
    }

    return
  }

  // First visible tab or no tab as fallback
  const target = visibleTabs.value.includes(tab)
    ? tab
    : (visibleTabs.value.length > 0 ? visibleTabs.value[0] : null)

  selectedTab.value = target
  const sequence = ++tabChangeSequence

  if (!isMounted || target === null) {
    currentTab.value = target
    return
  }

  // Let the selected label reach its final bold width before measuring the
  // indicator. The content is swapped two frames later, after the compositor
  // has started moving the indicator toward that stable target.
  nextTick(() => {
    if (sequence !== tabChangeSequence) { return }

    moveTabsIndicatorTo(target)
    pendingTabChangeFrame = window.requestAnimationFrame(() => {
      pendingTabChangeFrame = window.requestAnimationFrame(() => {
        if (sequence !== tabChangeSequence) { return }

        pendingTabChangeFrame = null
        currentTab.value = target
      })
    })
  })
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

    const channelIds = activeSubscriptionList.value.map(channel => channel.id)

    await store.dispatch('markSubscriptionEntriesAsSeen', {
      tabs: feedTabs.map(feedTab => feedTab === 'community' ? 'posts' : feedTab),
      channelIds
    })
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

function cancelRefresh() {
  // The refresh may be owned by another window, so it is cancelled everywhere
  requestSubscriptionRefreshCancellation()
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

// ===== Single row header =====
const headerRowRef = useTemplateRef('headerRowRef')
const tabsRowRef = useTemplateRef('tabsRowRef')
/** @type {import('vue').Ref<boolean>} */
const headerFitsOneRow = ref(false)
let headerResizeObserver = null

/**
 * How much inline space the children of a flex container need next to each
 * other, which isn't the same as the container's own width when it stretches or
 * its content wraps.
 * @param {HTMLElement} container
 * @param {(child: Element) => number} [childWidth]
 */
function singleLineWidth(container, childWidth = child => child.getBoundingClientRect().width) {
  const children = Array.from(container.children)
  const columnGap = Number.parseFloat(getComputedStyle(container).columnGap) || 0

  return children.reduce((total, child) => total + childWidth(child), 0) +
    columnGap * Math.max(children.length - 1, 0)
}

/**
 * The tabs sit next to the page title while the title, the tabs and the refresh
 * widget fit onto one line together, otherwise the tabs drop onto a line of
 * their own. The single row layout doesn't let its children shrink and the tabs
 * are measured through their content, so the measurement is the same in both
 * layouts and they can't flip back and forth.
 */
function updateHeaderFitsOneRow() {
  const row = headerRowRef.value
  const tabsRow = tabsRowRef.value

  if (!(row instanceof HTMLElement) || row.getClientRects().length === 0) {
    return
  }

  const requiredWidth = singleLineWidth(row, child => {
    // The tabs stretch across the whole header while they have their own line
    return child === tabsRow ? singleLineWidth(child) : child.getBoundingClientRect().width
  })

  // Fractional widths throughout, as rounding the available space up would let
  // the single row layout overflow, which puts the tabs onto a second line again
  headerFitsOneRow.value = requiredWidth <= row.getBoundingClientRect().width
}

function observeHeaderRow() {
  const row = headerRowRef.value

  if (headerResizeObserver === null || !(row instanceof HTMLElement)) {
    return
  }

  // Everything the measurement reads is observed, not just the row: text inside
  // the children (the refresh timestamps above all) changes their widths without
  // resizing the row, and the tabs row keeps its full width while it has a line
  // of its own, so its children have to be watched instead of it
  headerResizeObserver.disconnect()
  headerResizeObserver.observe(row)

  for (const child of row.children) {
    headerResizeObserver.observe(child)
  }

  for (const child of tabsRowRef.value?.children ?? []) {
    headerResizeObserver.observe(child)
  }
}

// Which elements exist changes with the panel (the refresh widget is only
// rendered once it is mounted) and with the Mark all as seen button
watch([currentTabPanel, currentTabHasNewContent], () => nextTick(() => {
  observeHeaderRow()
  updateHeaderFitsOneRow()
}))

// ===== Sliding feed tab indicator =====
const tabsContainerRef = useTemplateRef('tabsContainerRef')
/** @type {import('vue').Ref<Record<string, string> | null>} */
const tabsIndicatorStyle = ref(null)
const tabsIndicatorTransitionDuration = computed(() => {
  return `${200 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)}ms`
})
let tabsResizeObserver = null
// Place the indicator without animating when it was last measured while
// hidden (e.g. in a background browser tab, where all offsets read 0),
// otherwise it visibly flies in from the stale position.
let tabsIndicatorWasHidden = true

const tabElementRefs = {
  videos: videosTab,
  shorts: shortsTab,
  live: liveTab,
  community: communityTab,
  new: newTab
}

/**
 * @param {HTMLElement} tabElement
 * @returns {boolean} whether the indicator was positioned on the tab
 */
function placeTabsIndicator(tabElement) {
  if (tabElement.getClientRects().length === 0) {
    tabsIndicatorWasHidden = true
    return false
  }

  // Physical values to match the physical offset measurements (RTL-safe).
  // The indicator sits just below the tab, like the old selectedTab border
  // (which extended past the box through its -3px margin).
  // Only the transform is animated, so the movement runs on the compositor and
  // doesn't stutter while the main thread renders a large feed.
  const style = {
    transform: `translate(${tabElement.offsetLeft}px, ${tabElement.offsetTop + tabElement.offsetHeight}px) scaleX(${tabElement.offsetWidth})`
  }

  if (tabsIndicatorWasHidden) {
    style.transition = 'none'
    tabsIndicatorWasHidden = false
  }

  tabsIndicatorStyle.value = style
  return true
}

function updateTabsIndicator() {
  // While a tab change is pending the indicator already sits on the tab that is
  // about to be selected, so re-measuring the still selected one (e.g. from the
  // ResizeObserver when a refresh loader appears) would move it back
  if (pendingTabChangeFrame !== null) {
    return
  }

  const container = tabsContainerRef.value?.$el
  const selected = container?.querySelector('.tab.selectedTab')

  if (!(selected instanceof HTMLElement)) {
    tabsIndicatorStyle.value = null
    tabsIndicatorWasHidden = true
    return
  }

  placeTabsIndicator(selected)
}

/**
 * Moves the indicator onto a tab before it becomes the selected one, so the
 * animation can start before the new panel is rendered.
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 * @returns {boolean} whether the indicator was moved
 */
function moveTabsIndicatorTo(tab) {
  if (!isMounted || tabsIndicatorStyle.value === null || tabsIndicatorWasHidden) {
    return false
  }

  const tabElement = tabElementRefs[tab]?.value

  return tabElement instanceof HTMLElement && placeTabsIndicator(tabElement)
}

watch([selectedTab, visibleTabs, refreshingFeedTab], () => nextTick(updateTabsIndicator))

onMounted(() => {
  if (typeof ResizeObserver === 'function') {
    // Tab widths shift on hover (bold text) and when the per-tab loader
    // appears, which also resizes the container
    tabsResizeObserver = new ResizeObserver(() => updateTabsIndicator())

    if (tabsContainerRef.value?.$el instanceof HTMLElement) {
      tabsResizeObserver.observe(tabsContainerRef.value.$el)
    }

    headerResizeObserver = new ResizeObserver(() => updateHeaderFitsOneRow())
    observeHeaderRow()
  }

  nextTick(() => {
    updateHeaderFitsOneRow()
    updateTabsIndicator()
  })
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  headerResizeObserver?.disconnect()
})
</script>

<style scoped src="./Subscriptions.css" />
