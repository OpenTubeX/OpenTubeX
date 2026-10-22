<template>
  <div
    class="subscriptionsPage"
    :class="{ hasTabBar: hasHorizontalTabBar }"
    @contextmenu="handleFeedContextMenu"
    @pointerdown="startFeedTabHold"
    @pointermove="moveFeedTabHold"
    @pointerup="cancelFeedTabHold"
    @pointercancel="cancelFeedTabHold"
  >
    <FtCard class="card">
      <div
        ref="headerRef"
        class="subscriptionsHeader"
        :class="{
          singleRow: headerFitsOneRow,
          scrollHidden: headerScrollHidden,
          tabbedNewFeed: currentTab === 'new' && newFeedView === 'tabbed',
          groupsBesideNewFeedTabs
        }"
        @focusin="resetHeaderScrollVisibility"
      >
        <div
          ref="headerRowRef"
          class="headerRow"
        >
          <h2 class="pageTitle">
            <FtIcon
              :icon="['fas', 'subscriptions']"
              class="subscriptionIcon"
            />
            {{ $t("Subscriptions.Subscriptions") }}
          </h2>
          <div
            ref="feedTabsControlsRowRef"
            class="feedTabsControlsRow"
          >
            <div
              ref="tabsRowRef"
              class="tabsRow"
            >
              <FtTabs
                ref="tabsContainerRef"
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
                  :aria-selected="selectedTab === 'videos'"
                  aria-controls="subscriptionsPanel"
                  data-subscription-feed-tab="videos"
                  :tabindex="currentTab === 'videos' ? 0 : -1"
                  :class="{ selectedTab: selectedTab === 'videos' }"
                  @click="changeTabFromPointer($event, 'videos')"
                  @keydown.space.enter.prevent="changeTab('videos')"
                  @keydown.left.right="switchTab($event, 'videos')"
                >
                  <FtIcon
                    :icon="['fa', 'video']"
                    class="subscriptionIcon"
                  />
                  <span
                    class="tabLabel"
                    :data-label="$t('Global.Videos')"
                  ><span>{{ $t("Global.Videos") }}</span></span>
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
                  :aria-selected="selectedTab === 'shorts'"
                  aria-controls="subscriptionsPanel"
                  data-subscription-feed-tab="shorts"
                  :tabindex="currentTab === 'shorts' ? 0 : -1"
                  :class="{ selectedTab: selectedTab === 'shorts' }"
                  @click="changeTabFromPointer($event, 'shorts')"
                  @keydown.space.enter.prevent="changeTab('shorts')"
                  @keydown.left.right="switchTab($event, 'shorts')"
                >
                  <FtIcon
                    :icon="['fa', 'clapperboard']"
                    class="subscriptionIcon"
                  />
                  <span
                    class="tabLabel"
                    :data-label="$t('Global.Shorts')"
                  ><span>{{ $t("Global.Shorts") }}</span></span>
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
                  :aria-selected="selectedTab === 'live'"
                  aria-controls="subscriptionsPanel"
                  data-subscription-feed-tab="live"
                  :tabindex="currentTab === 'live' ? 0 : -1"
                  :class="{ selectedTab: selectedTab === 'live' }"
                  @click="changeTabFromPointer($event, 'live')"
                  @keydown.space.enter.prevent="changeTab('live')"
                  @keydown.left.right="switchTab($event, 'live')"
                >
                  <FtIcon
                    :icon="['fa', 'tower-broadcast']"
                    class="subscriptionIcon"
                  />
                  <span
                    class="tabLabel"
                    :data-label="$t('Global.Live')"
                  ><span>{{ $t("Global.Live") }}</span></span>
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
                  :aria-selected="selectedTab === 'community'"
                  aria-controls="subscriptionsPanel"
                  data-subscription-feed-tab="posts"
                  :tabindex="currentTab === 'community' ? 0 : -1"
                  :class="{ selectedTab: selectedTab === 'community' }"
                  @click="changeTabFromPointer($event, 'community')"
                  @keydown.space.enter.prevent="changeTab('community')"
                  @keydown.left.right="switchTab($event, 'community')"
                >
                  <FtIcon
                    :icon="['fa', 'message']"
                    class="subscriptionIcon"
                  />
                  <span
                    class="tabLabel"
                    :data-label="$t('Global.Posts')"
                  ><span>{{ $t("Global.Posts") }}</span></span>
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
                  :aria-selected="selectedTab === 'new'"
                  aria-controls="subscriptionsPanel"
                  data-subscription-feed-tab="all"
                  :tabindex="currentTab === 'new' ? 0 : -1"
                  :class="{ selectedTab: selectedTab === 'new' }"
                  @click="changeTabFromPointer($event, 'new')"
                  @keydown.space.enter.prevent="changeTab('new')"
                  @keydown.left.right="switchTab($event, 'new')"
                >
                  <FtIcon
                    :icon="['fa', 'fire']"
                    class="subscriptionIcon"
                  />
                  <span
                    class="tabLabel"
                    :data-label="$t('Global.New')"
                  ><span>{{ $t("Global.New") }}</span></span>
                </div>
              </FtTabs>
            </div>
            <div
              v-if="currentTabPanel !== null"
              class="headerActions"
              :class="{ hasAutoRefreshStatus: currentTabPanel.lastRefreshTimestamp && currentTabPanel.nextAutoRefreshTimestamp }"
            >
              <FtIconButton
                v-if="currentTab === 'new'"
                class="headerViewToggle"
                :title="newFeedView === 'tabbed'
                  ? $t('Subscriptions.Show Combined View')
                  : $t('Subscriptions.Show Tabbed View')"
                :icon="newFeedView === 'tabbed' ? ['fas', 'layer-group'] : ['fac', 'horizontal-tabs']"
                :aria-pressed="newFeedView === 'tabbed'"
                :use-shadow="false"
                :padding="8"
                :size="20"
                theme="base-no-default"
                @click="toggleNewFeedView"
              />
              <FtSelect
                v-if="currentTab === 'new'"
                class="headerSortSelect"
                :placeholder="$t('Global.Sort By')"
                :value="newFeedSortBy"
                :select-names="newFeedSortByNames"
                :select-values="NEW_FEED_SORT_BY_VALUES"
                :icon="newFeedSortByIcon"
                @change="updateNewFeedSortBy"
              />
              <Teleport
                v-if="currentTabHasNewContent"
                :to="tabsRowRef"
                :disabled="!headerFitsOneRow"
              >
                <button
                  class="markAllSeenButton"
                  type="button"
                  :disabled="markingSeenTab !== null || currentTabRefreshing"
                  @click="markAllAsSeen(currentTab)"
                >
                  <FtIcon :icon="['fas', 'check']" />
                  <span class="markAllSeenLabel">
                    {{ $t('Subscriptions.Mark All as Seen') }}
                  </span>
                </button>
              </Teleport>
              <FtRefreshWidget
                embedded
                class="headerRefreshWidget subscriptionsHeaderRefreshWidget"
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
        </div>
        <FtTabs
          v-if="currentTab === 'new' && newFeedView === 'tabbed'"
          ref="newFeedTabsRef"
          class="newFeedTabs"
          role="tablist"
          :aria-label="$t('Subscriptions.New Content Tabs')"
        >
          <button
            v-for="tab in visibleNewFeedTabs"
            :key="tab.id"
            :ref="element => setNewFeedTabRef(tab.id, element)"
            class="newFeedTab"
            :class="{ selectedTab: currentNewFeedTab === tab.id }"
            type="button"
            role="tab"
            :aria-selected="currentNewFeedTab === tab.id"
            aria-controls="subscriptionsPanel"
            :data-new-feed-tab="tab.id"
            :data-has-new-content="newFeedTabHasNewContent(tab.id)"
            :tabindex="currentNewFeedTab === tab.id ? 0 : -1"
            @click="changeNewFeedTab(tab.id)"
            @keydown.left.right="switchNewFeedTab($event, tab.id)"
            @keydown.home.end.prevent="switchNewFeedTab($event, tab.id)"
          >
            <FtIcon
              :icon="tab.icon"
              class="subscriptionIcon"
            />
            <span
              class="tabLabel"
              :data-label="tab.label"
            ><span>{{ tab.label }}</span></span>
            <FtNewContentDot
              v-if="showNewSubscriptionFeedIndicators && newFeedTabHasNewContent(tab.id)"
              class="newFeedTabDot"
            />
          </button>
        </FtTabs>
        <FtSubscriptionGroupBar
          v-if="hasSubscriptionGroups"
          ref="subscriptionGroupsRef"
          class="subscriptionGroups"
          panel-id="subscriptionsPanel"
        />
      </div>
      <KeepAlive>
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
          :active-category="newFeedView === 'tabbed' ? currentNewFeedTab : null"
        />
      </KeepAlive>
      <p v-if="currentTab === null">
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
import FtTabs from '../../components/FtTabs/FtTabs.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtNewContentDot from '../../components/FtNewContentDot/FtNewContentDot.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtSubscriptionGroupBar from '../../components/FtSubscriptionGroupBar/FtSubscriptionGroupBar.vue'
import SubscriptionsNew from '../../components/SubscriptionsNew.vue'
import SubscriptionsVideos from '../../components/SubscriptionsVideos.vue'
import SubscriptionsLive from '../../components/SubscriptionsLive.vue'
import SubscriptionsShorts from '../../components/SubscriptionsShorts.vue'
import SubscriptionsPosts from '../../components/SubscriptionPosts/SubscriptionsPosts.vue'

import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { createMobileNavigationScroll } from '../../helpers/mobileNavigationScroll'
import { lightHaptic } from '../../helpers/mobileHaptics'
import { getIconForSortPreference } from '../../helpers/utils'
import store from '../../store/index'
import { useTabContext, useTabLifecycle } from '../../tabs/TabContext'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { useRefreshAllSubscriptionFeeds } from '../../composables/useRefreshAllSubscriptionFeeds'
import { useSubscriptionPremiereUpdates } from '../../composables/useSubscriptionPremiereUpdates'
import {
  requestSubscriptionRefreshCancellation,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote
} from '../../helpers/subscriptions'
import { getSubscriptionsForFeed } from '../../helpers/subscription-channels'

const isElectron = process.env.IS_ELECTRON
const usesLogicalTabs = process.env.IS_ELECTRON || process.env.IS_CAPACITOR
const openMobileContextActions = inject('openMobileContextActions')
let feedTabHold = null

function cancelFeedTabHold() {
  clearTimeout(feedTabHold?.timer)
  feedTabHold = null
}

function startFeedTabHold(event) {
  resetFeedTabHold()
  if (event.pointerType !== 'touch' || !event.isPrimary) return
  const tab = event.target.closest('[data-subscription-feed-tab], [data-new-feed-tab]')
  if (!tab) return

  feedTabHold = {
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      cancelFeedTabHold()
      lightHaptic()
      tab.dispatchEvent(new PointerEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch'
      }))
    }, 500)
  }
}

function moveFeedTabHold(event) {
  if (feedTabHold && Math.hypot(event.clientX - feedTabHold.x, event.clientY - feedTabHold.y) > 10) {
    cancelFeedTabHold()
  }
}

function resetFeedTabHold() {
  cancelFeedTabHold()
  document.removeEventListener('click', suppressFeedTabHoldClick, true)
  document.removeEventListener('pointerdown', resetFeedTabHold, true)
  document.removeEventListener('keydown', resetFeedTabHold, true)
}

function suppressFeedTabHoldClick(event) {
  event.preventDefault()
  event.stopImmediatePropagation()
  resetFeedTabHold()
}

function handleFeedContextMenu(event) {
  if (!process.env.IS_CAPACITOR && event.pointerType !== 'touch') return
  const tab = event.target.closest('[data-subscription-feed-tab], [data-new-feed-tab]')
  if (!tab) return

  event.preventDefault()
  event.stopPropagation()
  cancelFeedTabHold()
  if (event.pointerType === 'touch') {
    // The sheet can become the release target. Suppress the opening touch's
    // click globally, but let the next pointer or keyboard interaction through.
    document.addEventListener('click', suppressFeedTabHoldClick, true)
    document.addEventListener('pointerdown', resetFeedTabHold, true)
    document.addEventListener('keydown', resetFeedTabHold, true)
  }
  const feedTab = tab.dataset.subscriptionFeedTab ?? tab.dataset.newFeedTab
  const reloadLabels = {
    videos: t('Context Menu.Reload Videos'),
    shorts: t('Context Menu.Reload Shorts'),
    live: t('Context Menu.Reload Live'),
    posts: t('Context Menu.Reload Posts'),
    all: t('Context Menu.Reload All Feeds')
  }
  const actions = [{
    label: subscriptionFeedRefreshInProgress.value ? t('Context Menu.Cancel Refresh') : reloadLabels[feedTab],
    icon: subscriptionFeedRefreshInProgress.value ? ['fas', 'xmark'] : ['fas', 'sync'],
    run: subscriptionFeedRefreshInProgress.value
      ? cancelRefresh
      : () => handleFeedReloadRequest({ tabId, feedTab })
  }]
  if (tab.dataset.newFeedTab && newFeedTabHasNewContent(feedTab)) {
    actions.push({
      label: t('Subscriptions.Mark All as Seen'),
      icon: ['fas', 'check'],
      run: () => markAllAsSeen('new', feedTab)
    })
  }
  openMobileContextActions({ title: tab.textContent.trim(), actions })
}

/** @type {import('vue').ComputedRef<boolean>} */
const hasHorizontalTabBar = computed(() => isElectron && store.getters.getTabBarPosition === 'top')

const { tabId, isTabPresented } = useTabContext()

const headerRef = useTemplateRef('headerRef')
const headerScrollHidden = ref(false)
const headerScroll = createMobileNavigationScroll({ revealThreshold: 64 })
const mobileHeaderLayout = window.matchMedia('(max-width: 680px), (orientation: landscape) and (max-height: 600px)')

function resetHeaderScrollVisibility() {
  headerScroll.reset(window.scrollY)
  headerScrollHidden.value = false
}

function updateHeaderScrollVisibility() {
  if (!mobileHeaderLayout.matches || (isTabPresented && !isTabPresented.value)) return
  const header = headerRef.value
  const content = header?.nextElementSibling
  // The translated sticky header keeps its space in the document. Wait until
  // that space scrolls behind the top bar so hiding cannot expose an empty gap.
  if (!content || content.getBoundingClientRect().top > Number.parseFloat(getComputedStyle(header).top) ||
      header.querySelector(':focus-visible, [aria-expanded="true"]')) {
    resetHeaderScrollVisibility()
    return
  }
  const page = document.scrollingElement
  headerScrollHidden.value = headerScroll.update(window.scrollY, page.scrollHeight - page.clientHeight)
}

watch(() => isTabPresented?.value, resetHeaderScrollVisibility)
useSubscriptionPremiereUpdates()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const {
  activeSubscriptionIds: allFeedsActiveSubscriptionIds,
  handleRefreshWarning: handleAllFeedsRefreshWarning,
  refresh: refreshAllFeeds,
  showRefreshWarning: showAllFeedsRefreshWarning
} = useRefreshAllSubscriptionFeeds()
const currentTabStorageKey = 'Subscriptions/currentTab'
const currentNewFeedTabStorageKey = 'Subscriptions/currentNewFeedTab'
const NEW_FEED_SORT_BY_VALUES = ['newest', 'oldest']

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

const newFeedSortBy = computed(() => {
  const value = store.getters.getNewSubscriptionFeedSortBy
  return NEW_FEED_SORT_BY_VALUES.includes(value) ? value : 'newest'
})
const newFeedSortByNames = computed(() => [
  t('Subscriptions.Newest First'),
  t('Subscriptions.Oldest First')
])
const newFeedSortByIcon = computed(() => getIconForSortPreference(newFeedSortBy.value))
const newFeedView = computed(() => {
  return store.getters.getNewSubscriptionFeedView === 'tabbed' ? 'tabbed' : 'combined'
})

function updateNewFeedSortBy(value) {
  if (NEW_FEED_SORT_BY_VALUES.includes(value)) {
    store.dispatch('updateNewSubscriptionFeedSortBy', value)
  }
}

async function toggleNewFeedView() {
  const value = newFeedView.value === 'tabbed' ? 'combined' : 'tabbed'
  await store.dispatch('updateNewSubscriptionFeedView', value)
  resetNewFeedScroll()
}

const activeSubscriptions = computed(() => store.getters.getActiveGroupSubscriptions)
const hasSubscriptionGroups = computed(() => store.getters.getSubscriptionGroupList.length > 0)

const activeSubscriptionList = computed(() => {
  const feedType = currentTab.value === 'community'
    ? 'posts'
    : currentTab.value === 'new' ? null : currentTab.value

  return feedType === null
    ? activeSubscriptions.value
    : getSubscriptionsForFeed(activeSubscriptions.value, feedType)
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
    return newFeedView.value === 'tabbed'
      ? refreshingFeedTab.value === currentNewFeedTab.value
      : refreshingFeedTab.value !== null
  }

  const currentFeedTab = currentTab.value === 'community' ? 'posts' : currentTab.value
  return refreshingFeedTab.value !== null && refreshingFeedTab.value === currentFeedTab
})

/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'community' | 'new' | null>} */
const currentTab = ref('videos')
const selectedTab = ref('videos')
let tabChangeSequence = 0

const tabScrollPositions = {
  videos: 0,
  shorts: 0,
  live: 0,
  community: 0,
  new: 0
}
/** @type {'videos' | 'shorts' | 'live' | 'community' | 'new' | null} */
let scrollPositionOwnerTab = currentTab.value
let restoreScrollOnActivate = false

useTabLifecycle({
  deactivate: resetFeedTabHold,
  activate: () => {
    resetHeaderScrollVisibility()
    if (!restoreScrollOnActivate) {
      return
    }

    restoreScrollOnActivate = false
    const value = currentTab.value
    window.scrollTo(0, value === null ? 0 : tabScrollPositions[value])
    resetHeaderScrollVisibility()
    scrollPositionOwnerTab = value
  }
})

function nextAnimationFrame() {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

let isMounted = false
let removeFeedReloadRequestListener = null
let removeFeedMarkSeenRequestListener = null

onMounted(() => {
  isMounted = true
  document.addEventListener('keydown', handlePanelTabNavigation)
  resetHeaderScrollVisibility()
  window.addEventListener('scroll', updateHeaderScrollVisibility, { passive: true })
  window.addEventListener('resize', resetHeaderScrollVisibility)

  if (isElectron) {
    removeFeedReloadRequestListener = window.ftElectron.subscriptionFeeds.onRequestReload(handleFeedReloadRequest)
    removeFeedMarkSeenRequestListener = window.ftElectron.subscriptionFeeds.onRequestMarkSeen(handleFeedMarkSeenRequest)
  }
})

onBeforeUnmount(() => {
  isMounted = false
  resetFeedTabHold()
  tabChangeSequence++
  document.removeEventListener('keydown', handlePanelTabNavigation)
  window.removeEventListener('scroll', updateHeaderScrollVisibility)
  window.removeEventListener('resize', resetHeaderScrollVisibility)
  removeFeedReloadRequestListener?.()
  removeFeedMarkSeenRequestListener?.()
})

watch(currentTab, async (value) => {
  resetHeaderScrollVisibility()
  if (value !== null) {
    // Use the last selected feed when opening another subscription view
    localStorage.setItem(currentTabStorageKey, value)
  } else {
    localStorage.removeItem(currentTabStorageKey)
  }

  if (!isMounted) {
    scrollPositionOwnerTab = value
    return
  }

  if (usesLogicalTabs && isTabPresented?.value !== true) {
    // The shared window scroll still belongs to the presented logical tab.
    // Restore this feed only after tab activation restores its page-level scroll.
    scrollPositionOwnerTab = null
    restoreScrollOnActivate = true
    return
  }

  if (scrollPositionOwnerTab !== null) {
    tabScrollPositions[scrollPositionOwnerTab] = window.scrollY
  }
  scrollPositionOwnerTab = null

  await nextTick()

  if (
    value !== currentTab.value ||
    !isMounted ||
    (usesLogicalTabs && isTabPresented?.value !== true)
  ) {
    return
  }

  window.scrollTo(0, value === null ? 0 : tabScrollPositions[value])
  resetHeaderScrollVisibility()
  scrollPositionOwnerTab = value
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

  if (!hideSubscriptionsCommunity.value) {
    tabs.push('community')
  }

  if (showNewSubscriptionFeed.value && tabs.length > 0) {
    tabs.push('new')
  }

  return tabs
})

const newFeedTabDefinitions = computed(() => [
  { id: 'videos', icon: ['fa', 'video'], label: t('Global.Videos') },
  { id: 'shorts', icon: ['fa', 'clapperboard'], label: t('Global.Shorts') },
  { id: 'live', icon: ['fa', 'tower-broadcast'], label: t('Global.Live') },
  { id: 'posts', icon: ['fa', 'message'], label: t('Global.Posts') }
])

const visibleNewFeedTabs = computed(() => {
  const visibleCategories = new Set(visibleTabs.value.map(tab => {
    return tab === 'community' ? 'posts' : tab
  }))

  return newFeedTabDefinitions.value.filter(tab => visibleCategories.has(tab.id))
})

const storedNewFeedTab = localStorage.getItem(currentNewFeedTabStorageKey)
/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'posts'>} */
const currentNewFeedTab = ref(storedNewFeedTab ?? 'videos')
/** @type {Map<string, HTMLElement>} */
const newFeedTabRefs = new Map()

watch(visibleNewFeedTabs, tabs => {
  if (!tabs.some(tab => tab.id === currentNewFeedTab.value)) {
    currentNewFeedTab.value = tabs[0]?.id ?? 'videos'
  }
}, { immediate: true })

watch(currentNewFeedTab, value => {
  localStorage.setItem(currentNewFeedTabStorageKey, value)
})

watch(visibleTabs, (value) => {
  if (value.length === 0) {
    tabChangeSequence++
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
  const requestedTabId = typeof route.query.tab === 'string' ? route.query.tab : null
  const lastCurrentTabId = localStorage.getItem(currentTabStorageKey)
  if (requestedTabId !== null && visibleTabs.value.includes(requestedTabId)) {
    changeTab(requestedTabId)
  } else if (lastCurrentTabId !== null) {
    changeTab(lastCurrentTabId)
  } else if (!visibleTabs.value.includes(currentTab.value)) {
    selectedTab.value = visibleTabs.value[0]
    currentTab.value = visibleTabs.value[0]
  }
}

watch(() => route.query.tab, value => {
  if (typeof value === 'string' && visibleTabs.value.includes(value)) {
    changeTab(value)
  }
})

/**
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 */
function changeTab(tab) {
  // First visible tab or no tab as fallback
  const target = visibleTabs.value.includes(tab)
    ? tab
    : (visibleTabs.value.length > 0 ? visibleTabs.value[0] : null)

  if (route.query.tab !== undefined && route.query.tab !== target) {
    router.replace({ query: { ...route.query, tab: target } })
  }

  if (target === selectedTab.value) {
    return
  }

  selectedTab.value = target
  const sequence = ++tabChangeSequence

  if (
    !isMounted ||
    target === null ||
    (usesLogicalTabs && isTabPresented?.value !== true)
  ) {
    currentTab.value = target
    return
  }

  if (target === currentTab.value) {
    return
  }

  // Give the selected label and indicator one paint before mounting the feed.
  // The panel follows on the next painted frame instead of waiting for the
  // indicator's 200ms transition.
  nextTick(async () => {
    await nextAnimationFrame()
    await nextAnimationFrame()

    if (sequence !== tabChangeSequence || !isMounted) {
      return
    }

    currentTab.value = target
  })
}

/**
 * @param {MouseEvent} event
 * @param {'videos' | 'shorts' | 'live' | 'community' | 'new'} tab
 */
function changeTabFromPointer(event, tab) {
  changeTab(tab)

  if (event.detail > 0 && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function changeNewFeedTab(tab) {
  if (
    tab === currentNewFeedTab.value ||
    !visibleNewFeedTabs.value.some(visibleTab => visibleTab.id === tab)
  ) {
    return
  }

  currentNewFeedTab.value = tab
  resetNewFeedScroll()
}

/**
 * @param {KeyboardEvent} event
 * @param {'videos' | 'shorts' | 'live' | 'posts'} focusedTab
 */
function switchNewFeedTab(event, focusedTab) {
  if (event.altKey) {
    return
  }

  event.preventDefault()

  const tabs = visibleNewFeedTabs.value
  let index = tabs.findIndex(tab => tab.id === focusedTab)

  if (event.key === 'Home') {
    index = 0
  } else if (event.key === 'End') {
    index = tabs.length - 1
  } else if (event.key === 'ArrowLeft') {
    index = index <= 0 ? tabs.length - 1 : index - 1
  } else {
    index = index >= tabs.length - 1 ? 0 : index + 1
  }

  const tab = tabs[index]?.id
  if (tab == null) {
    return
  }

  changeNewFeedTab(tab)
  nextTick(() => newFeedTabRefs.get(tab)?.focus())
  store.commit('setOutlinesHidden', false)
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {Element | import('vue').ComponentPublicInstance | null} element
 */
function setNewFeedTabRef(tab, element) {
  if (element instanceof HTMLElement) {
    newFeedTabRefs.set(tab, element)
  } else {
    newFeedTabRefs.delete(tab)
  }
}

async function resetNewFeedScroll() {
  tabScrollPositions.new = 0

  if (
    currentTab.value !== 'new' ||
    (usesLogicalTabs && isTabPresented?.value !== true)
  ) {
    return
  }

  if (usesLogicalTabs && tabId) {
    getTabNavigationService().resetScroll(tabId)
  } else {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
  }

  await nextTick()
  await nextAnimationFrame()

  if (
    isMounted &&
    currentTab.value === 'new' &&
    (!usesLogicalTabs || isTabPresented?.value === true)
  ) {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
    scrollPositionOwnerTab = 'new'
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

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function newFeedTabHasNewContent(tab) {
  return newPanel.value?.hasNewContentByCategory?.[tab] === true
}

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
 * @param {'videos' | 'shorts' | 'live' | 'posts'} [newFeedTab=currentNewFeedTab.value]
 */
async function markAllAsSeen(tab, newFeedTab = currentNewFeedTab.value) {
  if (markingSeenTab.value !== null) {
    return
  }

  markingSeenTab.value = tab
  try {
    const feedTabs = tab === 'new'
      ? newFeedView.value === 'tabbed'
        ? [newFeedTab]
        : visibleTabs.value.filter(visibleTab => visibleTab !== 'new')
      : [tab]

    const cacheFeedTabs = feedTabs.map(feedTab => feedTab === 'community' ? 'posts' : feedTab)
    const channelIdsByTab = Object.fromEntries(cacheFeedTabs.map(feedTab => [
      feedTab,
      getSubscriptionsForFeed(activeSubscriptions.value, feedTab).map(channel => channel.id)
    ]))
    const cacheGettersByTab = {
      videos: 'getVideoCache',
      shorts: 'getShortsCache',
      live: 'getLiveCache',
      posts: 'getPostsCache'
    }
    // Refreshes may finish during the animation. Only dismiss entries that
    // were eligible when the user requested the seen marks.
    const entriesByTab = Object.fromEntries(cacheFeedTabs.map(feedTab => [
      feedTab,
      channelIdsByTab[feedTab].flatMap(channelId => {
        const cache = store.getters[cacheGettersByTab[feedTab]]
        const entries = cache[channelId]?.[feedTab === 'posts' ? 'posts' : 'videos'] ?? []
        return entries.filter(entry => entry.isNewInSubscriptionFeed === true)
          .map(entry => feedTab === 'posts'
            ? { postId: entry.postId }
            : { videoId: entry.videoId, isMembersOnly: entry.isMembersOnly === true })
      })
    ]))

    const markSeen = () => store.dispatch('markSubscriptionEntriesAsSeen', {
      tabs: cacheFeedTabs,
      channelIdsByTab,
      entriesByTab
    })
    const markedNewFeedView = newFeedView.value
    const isVisibleNewFeed = () => isMounted && tab === 'new' && currentTab.value === 'new' &&
      (!usesLogicalTabs || isTabPresented?.value === true) &&
      newFeedView.value === markedNewFeedView &&
      (newFeedView.value !== 'tabbed' || currentNewFeedTab.value === newFeedTab)

    if (isVisibleNewFeed()) {
      const startScroll = window.scrollY
      if (startScroll > 0 && !isReducedMotionEnabled()) {
        const startTime = performance.now()
        const duration = 180 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)
        while (isVisibleNewFeed()) {
          await nextAnimationFrame()
          if (!isVisibleNewFeed()) break
          const progress = Math.min(1, (performance.now() - startTime) / duration)
          window.scrollTo({ top: startScroll * (1 - progress) ** 3, behavior: 'instant' })
          if (progress === 1) break
        }
      }
      if (isVisibleNewFeed()) {
        await resetNewFeedScroll()
      }
    }

    if (isVisibleNewFeed()) {
      await newPanel.value.markAllAsSeen(markSeen)
    } else {
      await markSeen()
    }
  } finally {
    markingSeenTab.value = null
  }
}

/**
 * @param {{tabId: string, feedTab: 'videos' | 'shorts' | 'live' | 'posts'}} payload
 */
function handleFeedMarkSeenRequest(payload) {
  if (
    payload?.tabId !== tabId ||
    currentTab.value !== 'new' ||
    newFeedView.value !== 'tabbed' ||
    !visibleNewFeedTabs.value.some(tab => tab.id === payload.feedTab)
  ) {
    return
  }

  markAllAsSeen('new', payload.feedTab)
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
 * @param {boolean} moveFocus
 */
function switchTab(event, focusedTab, moveFocus = true) {
  if (event.altKey) {
    return
  }

  event.preventDefault()

  const visibleTabsCached = visibleTabs.value

  if (visibleTabsCached.length === 1) {
    if (moveFocus) {
      store.commit('setOutlinesHidden', false)
    }
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

  const nextTab = visibleTabsCached[index]

  changeTab(nextTab)

  if (moveFocus) {
    switch (nextTab) {
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
}

/**
 * @param {KeyboardEvent} event
 */
function handlePanelTabNavigation(event) {
  if (
    (isTabPresented && !isTabPresented.value) ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  ) {
    return
  }

  const target = event.target
  const isDocumentTarget = target === document.body || target === document.documentElement
  const isPanelTarget = target instanceof Element && target.closest('#subscriptionsPanel') !== null
  const isPointerFocusedAppTab =
    store.getters.getOutlinesHidden &&
    target instanceof Element &&
    target.closest('.tab[data-tab-id]') !== null

  if (!isDocumentTarget && !isPanelTarget && !isPointerFocusedAppTab) {
    return
  }

  if (target instanceof HTMLElement && (
    target.matches('input, textarea, select') || target.isContentEditable
  )) {
    return
  }

  switchTab(event, selectedTab.value, false)
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
const feedTabsControlsRowRef = useTemplateRef('feedTabsControlsRowRef')
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
    .filter(child => getComputedStyle(child).position !== 'absolute')
  const columnGap = Number.parseFloat(getComputedStyle(container).columnGap) || 0

  return children.reduce((total, child) => total + childWidth(child), 0) +
    columnGap * Math.max(children.length - 1, 0)
}

/**
 * The inline size available to flex children. getBoundingClientRect includes
 * the padding used to extend the tabbed-view separator across the header.
 * @param {HTMLElement} element
 */
function contentBoxWidth(element) {
  const style = getComputedStyle(element)
  return element.getBoundingClientRect().width -
    (Number.parseFloat(style.paddingInlineStart) || 0) -
    (Number.parseFloat(style.paddingInlineEnd) || 0) -
    (Number.parseFloat(style.borderInlineStartWidth) || 0) -
    (Number.parseFloat(style.borderInlineEndWidth) || 0)
}

/**
 * The tabs and actions sit next to the page title while all three fit onto one
 * line. Otherwise the tabs and actions move together below the title. The
 * single row layout doesn't let its children shrink and the tabs are measured
 * through their content, so the measurement is stable in both layouts.
 */
function updateHeaderFitsOneRow() {
  const row = headerRowRef.value
  const feedTabsControlsRow = feedTabsControlsRowRef.value
  const tabsRow = tabsRowRef.value
  const tabs = tabsContainerRef.value?.$el

  if (
    !(row instanceof HTMLElement) ||
    !(feedTabsControlsRow instanceof HTMLElement) ||
    !(tabsRow instanceof HTMLElement) ||
    !(tabs instanceof HTMLElement) ||
    row.getClientRects().length === 0
  ) {
    return
  }

  const tabsRowWidth = singleLineWidth(tabsRow, child => {
    return child === tabs ? singleLineWidth(tabs) : child.getBoundingClientRect().width
  })
  const feedTabsControlsRowWidth = singleLineWidth(feedTabsControlsRow, child => {
    return child === tabsRow ? tabsRowWidth : child.getBoundingClientRect().width
  })
  const requiredWidth = singleLineWidth(row, child => {
    // The grouped row stretches across the header in the split layout
    return child === feedTabsControlsRow
      ? feedTabsControlsRowWidth
      : child.getBoundingClientRect().width
  })

  // Fractional widths throughout, as rounding the available space up would let
  // the single row layout overflow, which puts the tabs onto a second line again
  headerFitsOneRow.value = requiredWidth <= contentBoxWidth(row)
}

const newFeedTabsRef = useTemplateRef('newFeedTabsRef')
const subscriptionGroupsRef = useTemplateRef('subscriptionGroupsRef')
/** @type {import('vue').Ref<boolean>} */
const groupsBesideNewFeedTabs = ref(false)

/**
 * The group chips and actions, which the group bar wraps as one row. Its tab
 * list doesn't generate a box of its own.
 * @param {HTMLElement} bar
 */
function groupBarItems(bar) {
  return Array.from(bar.children)
    .flatMap(child => getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child])
    .filter(child => child.getClientRects().length > 0 && !['absolute', 'fixed'].includes(getComputedStyle(child).position))
}

/**
 * The groups share the row of the New feed's tabs while they fit onto one line
 * beside them, without moving the tabs off the center of the header.
 */
function updateGroupsBesideNewFeedTabs() {
  const header = headerRef.value
  const tabs = newFeedTabsRef.value?.$el
  const bar = subscriptionGroupsRef.value?.$el

  if (
    !(header instanceof HTMLElement) ||
    !(tabs instanceof HTMLElement) ||
    !(bar instanceof HTMLElement) ||
    header.getClientRects().length === 0
  ) {
    groupsBesideNewFeedTabs.value = false
    return
  }

  const items = groupBarItems(bar)
  const itemGap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0
  const groupsWidth = items.reduce((total, item) => total + item.getBoundingClientRect().width, 0) +
    itemGap * Math.max(items.length - 1, 0)
  const columnGap = Number.parseFloat(getComputedStyle(header).getPropertyValue('--new-feed-groups-gap')) || 0

  groupsBesideNewFeedTabs.value = groupsWidth + columnGap <= (contentBoxWidth(header) - singleLineWidth(tabs)) / 2
}

function updateHeaderLayout() {
  updateHeaderFitsOneRow()
  updateGroupsBesideNewFeedTabs()
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

  for (const child of feedTabsControlsRowRef.value?.children ?? []) {
    headerResizeObserver.observe(child)
  }

  for (const child of tabsRowRef.value?.children ?? []) {
    headerResizeObserver.observe(child)
  }

  for (const child of tabsContainerRef.value?.$el?.children ?? []) {
    headerResizeObserver.observe(child)
  }

  // The header for the space beside the New feed's tabs
  if (headerRef.value instanceof HTMLElement) {
    headerResizeObserver.observe(headerRef.value)
  }

  for (const child of newFeedTabsRef.value?.$el?.children ?? []) {
    headerResizeObserver.observe(child)
  }

  const groupBar = subscriptionGroupsRef.value?.$el
  if (groupBar instanceof HTMLElement) {
    for (const item of groupBarItems(groupBar)) {
      headerResizeObserver.observe(item)
    }
  }
}

// Which elements exist changes with the panel (the refresh widget is only
// rendered once it is mounted), with the Mark all as seen button, the New feed's
// view and the groups
watch([
  currentTabPanel,
  currentTabHasNewContent,
  headerFitsOneRow,
  newFeedView,
  visibleNewFeedTabs,
  () => store.getters.getSubscriptionGroupList
], () => {
  const restoreFocus = headerRowRef.value?.querySelector('.markAllSeenButton') === document.activeElement
  nextTick(() => {
    observeHeaderRow()
    updateHeaderLayout()
    // Moving the button between rows must preserve keyboard focus.
    if (restoreFocus) {
      headerRowRef.value?.querySelector('.markAllSeenButton')?.focus({ preventScroll: true })
    }
  })
})

const tabsContainerRef = useTemplateRef('tabsContainerRef')

onMounted(() => {
  if (typeof ResizeObserver === 'function') {
    headerResizeObserver = new ResizeObserver(() => {
      updateHeaderLayout()
    })
    observeHeaderRow()
  }

  nextTick(() => {
    updateHeaderLayout()
  })
})

onBeforeUnmount(() => {
  headerResizeObserver?.disconnect()
})
</script>

<style scoped src="./Subscriptions.css" />
