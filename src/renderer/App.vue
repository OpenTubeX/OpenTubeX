<template>
  <div
    v-if="dataReady"
    class="app"
    :class="{
      hideOutlines: outlinesHidden,
      isLocaleRightToLeft: isLocaleRightToLeft,
      isSideNavOpen: isSideNavOpen,
      hideLabelsSideBar: hideLabelsSideBar && !isSideNavOpen,
      watchSideNavOverlay: useWatchSideNavOverlay,
      watchSideNavTransitionDisabled
    }"
  >
    <TabBar
      :inert="isAnyPromptOpen"
    />
    <TopNav
      :inert="isAnyPromptOpen"
    />
    <SideNav
      :inert="isAnyPromptOpen"
      :force-expanded="useWatchSideNavOverlay"
    />
    <Transition name="fade">
      <button
        v-if="useWatchSideNavOverlay && isSideNavOpen"
        type="button"
        class="sideNavBackdrop"
        :aria-label="t('Close')"
        @click="closeSideNav"
      />
    </Transition>
    <FtFlexBox
      class="flexBox routerView"
      role="main"
      :inert="isAnyPromptOpen"
    >
      <div
        v-if="showUpdatesBanner"
        class="banner-wrapper"
      >
        <FtNotificationBanner
          v-if="showUpdatesBanner"
          class="banner"
          :message="updateBannerMessage"
          role="link"
          @click="handleUpdateBannerClick"
        />
      </div>
      <RouterView
        v-slot="{ Component }"
        class="routerView"
      >
        <Transition
          mode="out-in"
          name="fade"
        >
          <component :is="Component" />
        </Transition>
      </RouterView>
    </FtFlexBox>
    <FtPrompt
      v-if="showReleaseNotes"
      theme="readable-width"
      @click="toggleShowReleaseNotes"
    >
      <template #label="{ labelId }">
        <h1
          :id="labelId"
          class="changeLogTitle"
          dir="ltr"
        >
          {{ changeLogTitle }}
        </h1>
      </template>
      <bdo
        v-safer-html.lenient="updateChangelog"
        class="changeLogText"
        dir="ltr"
        lang="en"
      />
      <FtFlexBox>
        <FtButton
          :label="t('Download From Site')"
          @click="openDownloadsPage"
        />
        <FtButton
          :label="t('Close')"
          :text-color="null"
          :background-color="null"
          @click="toggleShowReleaseNotes"
        />
      </FtFlexBox>
    </FtPrompt>
    <FtPrompt
      v-if="showExternalLinkOpeningPrompt"
      :label="t('Are you sure you want to open this link?')"
      :extra-labels="[lastExternalLinkToBeOpened]"
      :option-names="externalLinkOpeningPromptNames"
      :option-values="EXTERNAL_LINK_OPENING_PROMPT_VALUES"
      @click="handleExternalLinkOpeningPromptAnswer"
    />
    <FtSearchFilters
      v-if="showSearchFilters"
    />
    <FtKeyboardShortcutPrompt
      v-if="isKeyboardShortcutPromptShown"
    />
    <FtPlaylistAddVideoPrompt
      v-if="showAddToPlaylistPrompt"
    />
    <FtCreatePlaylistPrompt
      v-if="showCreatePlaylistPrompt"
    />
    <FtToast />
    <FtProgressBar
      v-if="showProgressBar"
    />
    <div
      v-if="findbarVisible"
      class="findbar"
      role="search"
      @keydown.stop="handleFindbarNavigationShortcut"
    >
      <FontAwesomeIcon
        :icon="['fas', 'search']"
        class="findbarIcon"
        aria-hidden="true"
      />
      <input
        ref="findbarInputRef"
        v-model="findbarQuery"
        class="findbarInput"
        type="search"
        :placeholder="t('Find in page')"
        :aria-label="t('Find in page')"
        @input="findInPage"
        @keydown.enter.prevent="findInPage($event.shiftKey)"
        @keydown.esc.prevent="closeFindbar"
      >
      <span
        class="findbarStatus"
        aria-live="polite"
      >
        {{ findbarStatus }}
      </span>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Previous match')"
        :title="t('Previous match')"
        @click="findInPage(true)"
      >
        <FontAwesomeIcon
          :icon="['fas', 'angle-up']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Next match')"
        :title="t('Next match')"
        @click="findInPage(false)"
      >
        <FontAwesomeIcon
          :icon="['fas', 'angle-down']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="findbarButton"
        :aria-label="t('Close find bar')"
        :title="t('Close')"
        @click="closeFindbar"
      >
        <FontAwesomeIcon
          :icon="['fas', 'xmark']"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-if="tabSwitcherVisible"
      class="tabSwitcherOverlay"
      @mousedown.prevent
      @wheel.prevent="handleTabSwitcherWheel"
    >
      <div
        ref="tabSwitcherRef"
        class="tabSwitcher"
        :class="{ pointerActive: tabSwitcherPointerActive }"
        role="listbox"
        :aria-label="t('KeyboardShortcutPrompt.Tab Switcher')"
        :aria-activedescendant="tabSwitcherSelectedTabId"
        @pointermove="activateTabSwitcherPointer"
        @pointerleave="clearTabSwitcherSelection"
      >
        <button
          v-for="(tab, index) in tabSwitcherTabs"
          :id="`tab-switcher-option-${tab.id}`"
          :key="tab.id"
          type="button"
          class="tabSwitcherItem"
          :class="{ selected: index === tabSwitcherSelectedIndex }"
          :style="getTabSwitcherItemStyle(tab)"
          role="option"
          :aria-selected="index === tabSwitcherSelectedIndex"
          @pointermove="setTabSwitcherSelectedIndex(index)"
          @focus="setTabSwitcherSelectedIndex(index)"
          @click="commitTabSwitcherSelection(index)"
        >
          <span class="tabSwitcherPreview">
            <img
              v-if="tabSwitcherPreviewUrls[tab.id]"
              :src="tabSwitcherPreviewUrls[tab.id]"
              :alt="`${formatTabSwitcherTitle(tab.title)} preview`"
              draggable="false"
            >
            <span
              v-else
              class="tabSwitcherPreviewFallback"
              aria-hidden="true"
            >
              <FontAwesomeIcon
                :icon="['fas', 'display']"
                class="tabSwitcherFallbackIcon"
              />
            </span>
          </span>
          <span class="tabSwitcherTitle">
            {{ formatTabSwitcherTitle(tab.title) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { Marked } from 'marked'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FtFlexBox from './components/ft-flex-box/ft-flex-box.vue'
import TopNav from './components/TopNav/TopNav.vue'
import SideNav from './components/SideNav/SideNav.vue'
import TabBar from './components/TabBar/TabBar.vue'
import FtNotificationBanner from './components/FtNotificationBanner/FtNotificationBanner.vue'
import FtPrompt from './components/FtPrompt/FtPrompt.vue'
import FtButton from './components/FtButton/FtButton.vue'
import FtToast from './components/FtToast/FtToast.vue'
import FtProgressBar from './components/FtProgressBar/FtProgressBar.vue'
import FtPlaylistAddVideoPrompt from './components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue'
import FtCreatePlaylistPrompt from './components/FtCreatePlaylistPrompt/FtCreatePlaylistPrompt.vue'
import FtKeyboardShortcutPrompt from './components/FtKeyboardShortcutPrompt/FtKeyboardShortcutPrompt.vue'
import FtSearchFilters from './components/FtSearchFilters/FtSearchFilters.vue'
import { vSaferHtml } from './directives/vSaferHtml.js'

import store from './store/index'

import packageDetails from '../../package.json'
import { openExternalLink, openInternalPath, showToast } from './helpers/utils'
import {
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_STARTED_EVENT
} from './helpers/subscriptions'
import { translateWindowTitle } from './helpers/strings'
import { getTabAccentColor } from './constants/tabColors'

const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/i
const LOCAL_REPOSITORY = 'opentubex/opentubex'
const UPSTREAM_REPOSITORY = 'freetubeapp/freetube'

const releaseNotesMarkdown = new Marked({
  extensions: [{
    name: 'issueReference',
    level: 'inline',
    start: (source) => source.search(/#\d+\b/),
    tokenizer(source, tokens) {
      const match = /^#(\d+)\b/.exec(source)
      const previousToken = tokens.at(-1)

      if (match && !this.lexer.state.inLink && !/[\w/]$/.test(previousToken?.raw ?? '')) {
        return {
          type: 'issueReference',
          raw: match[0],
          issueNumber: match[1]
        }
      }
    },
    renderer({ issueNumber }) {
      return `<a href="https://github.com/OpenTubeX/OpenTubeX/issues/${issueNumber}">#${issueNumber}</a>`
    }
  }],
  renderer: {
    link(token) {
      const match = GITHUB_ISSUE_URL_PATTERN.exec(token.href)

      if (!match) {
        return false
      }

      const [, owner, repository, issueNumber] = match
      const repositoryName = `${owner}/${repository}`
      let label = `${repositoryName}#${issueNumber}`

      if (repositoryName.toLowerCase() === LOCAL_REPOSITORY) {
        label = `#${issueNumber}`
      } else if (repositoryName.toLowerCase() === UPSTREAM_REPOSITORY) {
        label = `${owner}#${issueNumber}`
      }

      return `<a href="${token.href}">${label}</a>`
    }
  }
})

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => store.getters.getIsSideNavOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => store.getters.getHideLabelsSideBar)

/** @type {import('vue').ComputedRef<boolean>} */
const useWatchSideNavOverlay = computed(() => {
  return store.getters.getHideSideBarOnWatchPages && route.path.startsWith('/watch/')
})

let sideNavOpenBeforeWatchOverlay = null
const watchSideNavTransitionDisabled = ref(false)
let watchSideNavTransitionFrame = null

watch(useWatchSideNavOverlay, (enabled) => {
  if (enabled) {
    disableWatchSideNavTransitionForNextFrame()
    sideNavOpenBeforeWatchOverlay = isSideNavOpen.value
    closeSideNav()
  } else if (sideNavOpenBeforeWatchOverlay !== null) {
    cancelWatchSideNavTransitionReset()
    watchSideNavTransitionDisabled.value = false

    if (isSideNavOpen.value !== sideNavOpenBeforeWatchOverlay) {
      store.commit('toggleSideNav')
    }

    sideNavOpenBeforeWatchOverlay = null
  }
}, { immediate: true })

function disableWatchSideNavTransitionForNextFrame() {
  cancelWatchSideNavTransitionReset()
  watchSideNavTransitionDisabled.value = true

  watchSideNavTransitionFrame = requestAnimationFrame(() => {
    watchSideNavTransitionFrame = requestAnimationFrame(() => {
      watchSideNavTransitionDisabled.value = false
      watchSideNavTransitionFrame = null
    })
  })
}

function cancelWatchSideNavTransitionReset() {
  if (watchSideNavTransitionFrame !== null) {
    cancelAnimationFrame(watchSideNavTransitionFrame)
    watchSideNavTransitionFrame = null
  }
}

function closeSideNav() {
  if (isSideNavOpen.value) {
    store.commit('toggleSideNav')
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const isAnyPromptOpen = computed(() => store.getters.isAnyPromptOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const showSearchFilters = computed(() => store.getters.getShowSearchFilters)

/** @type {import('vue').ComputedRef<boolean>} */
const isKeyboardShortcutPromptShown = computed(() => store.getters.getIsKeyboardShortcutPromptShown)

/** @type {import('vue').ComputedRef<boolean>} */
const showAddToPlaylistPrompt = computed(() => store.getters.getShowAddToPlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const showCreatePlaylistPrompt = computed(() => store.getters.getShowCreatePlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const showProgressBar = computed(() => store.getters.getShowProgressBar)

const landingPage = computed(() => '/' + store.getters.getLandingPage)

/** @type {import('vue').ComputedRef<string>} */
const defaultInvidiousInstance = computed(() => store.getters.getDefaultInvidiousInstance)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionFeedAutoRefreshInterval = computed(() => store.getters.getSubscriptionFeedAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionShortsAutoRefreshInterval = computed(() => store.getters.getSubscriptionShortsAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionLiveAutoRefreshInterval = computed(() => store.getters.getSubscriptionLiveAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string>} */
const subscriptionPostsAutoRefreshInterval = computed(() => store.getters.getSubscriptionPostsAutoRefreshInterval)

/** @type {import('vue').ComputedRef<string | null>} */
const activeSubscriptionProfileId = computed(() => store.getters.getActiveProfile?._id ?? null)

/** @type {import('vue').ComputedRef<string>} */
const historyRetentionDays = computed(() => store.getters.getHistoryRetentionDays)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsVideos = computed(() => store.getters.getHideSubscriptionsVideos)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsShorts = computed(() => store.getters.getHideSubscriptionsShorts)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsLive = computed(() => store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsPosts = computed(() => store.getters.getHideSubscriptionsCommunity || store.getters.getUseRssFeeds)

const dataReady = ref(false)
const findbarVisible = ref(false)
const findbarQuery = ref('')
const findbarMatchIndex = ref(0)
const findbarMatchCount = ref(0)
const findbarInputRef = useTemplateRef('findbarInputRef')
const tabSwitcherVisible = ref(false)
const tabSwitcherSelectedIndex = ref(-1)
const tabSwitcherPreviewUrls = ref({})
const tabSwitcherPointerActive = ref(false)
const tabSwitcherRef = useTemplateRef('tabSwitcherRef')
const subscriptionAutoRefreshTimers = {
  videos: null,
  shorts: null,
  live: null,
  posts: null
}
const HISTORY_CLEANUP_INTERVAL = 60 * 60 * 1000
const SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL = 60 * 1000
const SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL = 1000
const LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.'
const SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.completed.'
const SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX = 'opentubex.subscriptionAutoRefresh.deadline.'
const SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY = 'opentubex.subscriptionAutoRefresh.inProgress'
let historyCleanupTimer = null
const subscriptionAutoRefreshTabs = ['videos', 'shorts', 'live', 'posts']
let removeSubscriptionAutoRefreshActiveChangedListener = null
let removeSubscriptionAutoRefreshStateChangedListener = null
const pendingSubscriptionAutoRefreshes = []
const pendingSubscriptionAutoRefreshKeys = new Set()
let processingSubscriptionAutoRefreshes = false
let tabSwitcherPreviewRequestId = 0
let findbarMatches = []

const tabSwitcherTabs = computed(() => store.getters.getTabs)
const findbarStatus = computed(() => {
  if (findbarQuery.value.trim().length === 0) {
    return ''
  }

  if (findbarMatchCount.value === 0) {
    return t('No matches')
  }

  return `${findbarMatchIndex.value}/${findbarMatchCount.value}`
})
const tabSwitcherSelectedTabId = computed(() => {
  const tab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
  return tab ? `tab-switcher-option-${tab.id}` : undefined
})

onMounted(async () => {
  await store.dispatch('grabUserSettings')

  updateTheme()

  await store.dispatch('fetchInvidiousInstancesFromFile')
  if (defaultInvidiousInstance.value === '') {
    await store.dispatch('setRandomCurrentInvidiousInstance')
  }

  store.dispatch('fetchInvidiousInstances').then(() => {
    if (defaultInvidiousInstance.value === '') {
      store.dispatch('setRandomCurrentInvidiousInstance')
    }
  })

  store.dispatch('grabAllProfiles', t('Profile.All Channels')).then(() => {
    store.dispatch('grabHistory')
    store.dispatch('grabAllPlaylists')
    store.dispatch('grabAllSubscriptions')
    store.dispatch('grabSearchHistoryEntries')

    if (process.env.IS_ELECTRON) {
      store.dispatch('setupListenersToSyncWindows')
      document.addEventListener('click', handleClick)
      document.addEventListener('auxclick', handleAuxClick)
      enableOpenUrl()
      store.dispatch('getExternalPlayerCmdArgumentsData')
      window.ftElectron.tabs.onRequestReload(prepareAndReloadTab)
    }

    dataReady.value = true

    setTimeout(() => {
      checkForNewUpdates()
    }, 500)
  })

  await router.isReady()

  if (route.path === '/') {
    router.replace({ path: landingPage.value })
  }

  setWindowTitle()

  document.addEventListener('keydown', handleKeyboardShortcuts)
  document.addEventListener('keyup', handleKeyboardShortcutKeyup)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('dragstart', handleDragStart)
  window.addEventListener('blur', cancelTabSwitcher)
  window.addEventListener('online', refreshOverdueSubscriptionFeeds)
  window.addEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.addEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.addEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.addEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.addEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  if (process.env.IS_ELECTRON) {
    removeSubscriptionAutoRefreshStateChangedListener = window.ftElectron.subscriptionAutoRefresh.onStateChanged((inProgress) => {
      store.commit('setSubscriptionFeedRefreshInProgress', inProgress)
    })
    synchronizeSubscriptionRefreshInProgress()
    removeSubscriptionAutoRefreshActiveChangedListener = window.ftElectron.tabs.onActiveChanged((isActive) => {
      if (isActive) {
        synchronizeSubscriptionRefreshInProgress()
        refreshOverdueSubscriptionFeeds()
      }
    })
  } else {
    synchronizeSubscriptionRefreshInProgress()
  }
})

onBeforeUnmount(() => {
  cancelWatchSideNavTransitionReset()
  clearSubscriptionFeedAutoRefreshTimer()
  clearInterval(historyCleanupTimer)
  document.removeEventListener('keydown', handleKeyboardShortcuts)
  document.removeEventListener('keyup', handleKeyboardShortcutKeyup)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('dragstart', handleDragStart)
  document.removeEventListener('click', handleClick)
  document.removeEventListener('auxclick', handleAuxClick)
  window.removeEventListener('blur', cancelTabSwitcher)
  window.removeEventListener('online', refreshOverdueSubscriptionFeeds)
  window.removeEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.removeEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.removeEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.removeEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.removeEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  removeSubscriptionAutoRefreshActiveChangedListener?.()
  removeSubscriptionAutoRefreshStateChangedListener?.()
})

watch(historyRetentionDays, scheduleHistoryCleanup)

function scheduleHistoryCleanup(days) {
  clearInterval(historyCleanupTimer)
  historyCleanupTimer = null

  const parsedDays = Number(days)
  if (!Number.isInteger(parsedDays) || parsedDays < 1) {
    return
  }

  historyCleanupTimer = setInterval(() => {
    store.dispatch('removeHistoryOlderThan', parsedDays)
  }, HISTORY_CLEANUP_INTERVAL)
}

watch([dataReady, activeSubscriptionProfileId], ([ready, profileId]) => {
  clearSubscriptionFeedAutoRefreshTimer()
  if (ready && profileId) {
    migrateLegacySubscriptionAutoRefreshDeadlines()
    synchronizeSubscriptionAutoRefreshProfile(profileId)
  }
})

watch([subscriptionFeedAutoRefreshInterval, hideSubscriptionsVideos], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('videos')
})

watch([subscriptionShortsAutoRefreshInterval, hideSubscriptionsShorts], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('shorts')
})

watch([subscriptionLiveAutoRefreshInterval, hideSubscriptionsLive], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('live')
})

watch([subscriptionPostsAutoRefreshInterval, hideSubscriptionsPosts], () => {
  resetSubscriptionTabAutoRefreshForAllProfiles('posts')
})

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function resetSubscriptionTabAutoRefreshForAllProfiles(tab) {
  if (!dataReady.value) {
    return
  }

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const enabled = isSubscriptionTabAutoRefreshEnabled(tab)
  const timestamp = enabled ? Date.now() + interval : null

  for (const profile of store.getters.getProfileList) {
    setStoredSubscriptionTabNextAutoRefreshTimestamp(profile._id, tab, timestamp)
  }

  const profileId = activeSubscriptionProfileId.value
  if (profileId) {
    scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number | null} [scheduledTimestamp]
 */
function scheduleSubscriptionTabAutoRefresh(tab, profileId, scheduledTimestamp) {
  clearSubscriptionTabAutoRefreshTimer(tab)

  if (!dataReady.value || profileId !== activeSubscriptionProfileId.value) {
    return
  }

  if (!isSubscriptionTabAutoRefreshEnabled(tab)) {
    setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, null)
    return
  }

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const now = Date.now()
  const storedTimestamp = scheduledTimestamp === undefined
    ? getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
    : scheduledTimestamp
  const nextAutoRefreshTimestamp = storedTimestamp ?? now + interval

  setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, nextAutoRefreshTimestamp)
  subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
    subscriptionAutoRefreshTimers[tab] = null
    enqueueSubscriptionAutoRefresh(tab, profileId)
  }, Math.max(0, nextAutoRefreshTimestamp - now))
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function enqueueSubscriptionAutoRefresh(tab, profileId) {
  const key = `${profileId}:${tab}`
  if (pendingSubscriptionAutoRefreshKeys.has(key)) {
    return
  }

  pendingSubscriptionAutoRefreshKeys.add(key)
  pendingSubscriptionAutoRefreshes.push({ tab, profileId, key })
  processPendingSubscriptionAutoRefreshes()
}

async function processPendingSubscriptionAutoRefreshes() {
  if (processingSubscriptionAutoRefreshes) {
    return
  }

  processingSubscriptionAutoRefreshes = true
  try {
    while (pendingSubscriptionAutoRefreshes.length > 0) {
      const { tab, profileId, key } = pendingSubscriptionAutoRefreshes.shift()

      try {
        if (
          profileId !== activeSubscriptionProfileId.value ||
          !isSubscriptionTabAutoRefreshEnabled(tab) ||
          navigator.onLine === false ||
          document.hidden
        ) {
          continue
        }

        if (process.env.IS_ELECTRON && !await window.ftElectron.tabs.isActive()) {
          continue
        }

        const storedTimestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
        if (storedTimestamp !== null && storedTimestamp > Date.now()) {
          scheduleSubscriptionTabAutoRefresh(tab, profileId, storedTimestamp)
          continue
        }

        const result = await getSubscriptionTabRefreshHandler(tab)({
          t,
          showStartToast: true
        })

        if (result === null) {
          scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId)
        }
      } catch (error) {
        console.error(`Failed to auto refresh subscription ${tab}`, error)
        scheduleSubscriptionTabAutoRefreshRetry(
          tab,
          profileId,
          SUBSCRIPTION_AUTO_REFRESH_FAILURE_RETRY_INTERVAL
        )
      } finally {
        pendingSubscriptionAutoRefreshKeys.delete(key)
      }
    }
  } finally {
    processingSubscriptionAutoRefreshes = false
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 */
function scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId) {
  scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, SUBSCRIPTION_AUTO_REFRESH_LOCK_RETRY_INTERVAL)
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number} delay
 */
function scheduleSubscriptionTabAutoRefreshRetry(tab, profileId, delay) {
  if (profileId !== activeSubscriptionProfileId.value) {
    return
  }

  clearSubscriptionTabAutoRefreshTimer(tab)
  subscriptionAutoRefreshTimers[tab] = setTimeout(() => {
    subscriptionAutoRefreshTimers[tab] = null
    enqueueSubscriptionAutoRefresh(tab, profileId)
  }, delay)
}

function refreshOverdueSubscriptionFeeds() {
  const profileId = activeSubscriptionProfileId.value
  if (!dataReady.value || !profileId) {
    return
  }

  for (const tab of subscriptionAutoRefreshTabs) {
    const timestamp = getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab)
    if (timestamp !== null && timestamp <= Date.now() && isSubscriptionTabAutoRefreshEnabled(tab)) {
      enqueueSubscriptionAutoRefresh(tab, profileId)
    } else {
      scheduleSubscriptionTabAutoRefresh(tab, profileId, timestamp)
    }
  }
}

function handleSubscriptionAutoRefreshVisibilityChange() {
  if (!document.hidden) {
    synchronizeSubscriptionRefreshInProgress()
    refreshOverdueSubscriptionFeeds()
  }
}

async function synchronizeSubscriptionRefreshInProgress() {
  try {
    let inProgress
    if (process.env.IS_ELECTRON) {
      inProgress = await window.ftElectron.subscriptionAutoRefresh.isInProgress()
    } else if (navigator.locks) {
      const { held } = await navigator.locks.query()
      inProgress = held.some(lock => lock.name === SUBSCRIPTION_REFRESH_LOCK_NAME)
      if (!inProgress) {
        localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      }
    } else {
      inProgress = false
      localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    }

    store.commit('setSubscriptionFeedRefreshInProgress', inProgress)
  } catch {
    // Live start/finish events still keep the common path synchronized.
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionAutoRefreshInterval(tab) {
  switch (tab) {
    case 'shorts':
      return subscriptionShortsAutoRefreshInterval
    case 'live':
      return subscriptionLiveAutoRefreshInterval
    case 'posts':
      return subscriptionPostsAutoRefreshInterval
    default:
      return subscriptionFeedAutoRefreshInterval
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionTabRefreshHandler(tab) {
  switch (tab) {
    case 'shorts':
      return refreshSubscriptionShortsFromRemote
    case 'live':
      return refreshSubscriptionLiveFromRemote
    case 'posts':
      return refreshSubscriptionPostsFromRemote
    default:
      return refreshSubscriptionVideosFromRemote
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function isSubscriptionTabAutoRefreshEnabled(tab) {
  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)

  return (
    dataReady.value &&
    !isSubscriptionTabHidden(tab) &&
    !Number.isNaN(interval) &&
    interval > 0
  )
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function isSubscriptionTabHidden(tab) {
  switch (tab) {
    case 'shorts':
      return hideSubscriptionsShorts.value
    case 'live':
      return hideSubscriptionsLive.value
    case 'posts':
      return hideSubscriptionsPosts.value
    default:
      return hideSubscriptionsVideos.value
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {string} profileId
 * @param {number | null} timestamp
 */
function setSubscriptionTabNextAutoRefreshTimestamp(tab, profileId, timestamp) {
  setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp)

  if (profileId === activeSubscriptionProfileId.value) {
    commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function commitSubscriptionTabNextAutoRefreshTimestamp(tab, timestamp) {
  switch (tab) {
    case 'shorts':
      store.commit('setSubscriptionShortsNextAutoRefreshTimestamp', timestamp)
      break
    case 'live':
      store.commit('setSubscriptionLiveNextAutoRefreshTimestamp', timestamp)
      break
    case 'posts':
      store.commit('setSubscriptionPostsNextAutoRefreshTimestamp', timestamp)
      break
    default:
      store.commit('setSubscriptionFeedNextAutoRefreshTimestamp', timestamp)
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function commitSubscriptionTabLastRefreshTimestamp(tab, timestamp) {
  switch (tab) {
    case 'shorts':
      store.commit('setSubscriptionShortsLastRefreshTimestamp', timestamp)
      break
    case 'live':
      store.commit('setSubscriptionLiveLastRefreshTimestamp', timestamp)
      break
    case 'posts':
      store.commit('setSubscriptionPostsLastRefreshTimestamp', timestamp)
      break
    default:
      store.commit('setSubscriptionFeedLastRefreshTimestamp', timestamp)
  }
}

/**
 * @param {string} prefix
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getSubscriptionAutoRefreshStorageKey(prefix, profileId, tab) {
  return `${prefix}${encodeURIComponent(profileId)}/${tab}`
}

/**
 * @param {string} key
 */
function getStoredSubscriptionAutoRefreshTimestamp(key) {
  try {
    const timestamp = Number(localStorage.getItem(key))
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
  } catch {
    return null
  }
}

/**
 * @param {string} key
 * @param {number | null} timestamp
 */
function setStoredSubscriptionAutoRefreshTimestamp(key, timestamp) {
  try {
    if (timestamp === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, String(timestamp))
    }
  } catch {
    // Auto refresh still works for the current session when storage is unavailable.
  }
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab) {
  const key = getSubscriptionAutoRefreshStorageKey(
    SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
    profileId,
    tab
  )
  const timestamp = getStoredSubscriptionAutoRefreshTimestamp(key)
  return timestamp
}

function migrateLegacySubscriptionAutoRefreshDeadlines() {
  for (const tab of subscriptionAutoRefreshTabs) {
    const legacyKey = `${LEGACY_SUBSCRIPTION_AUTO_REFRESH_STORAGE_KEY_PREFIX}${tab}`
    const legacyTimestamp = getStoredSubscriptionAutoRefreshTimestamp(legacyKey)
    if (legacyTimestamp === null) {
      continue
    }

    for (const profile of store.getters.getProfileList) {
      const profileKey = getSubscriptionAutoRefreshStorageKey(
        SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
        profile._id,
        tab
      )
      if (getStoredSubscriptionAutoRefreshTimestamp(profileKey) === null) {
        setStoredSubscriptionAutoRefreshTimestamp(profileKey, legacyTimestamp)
      }
    }

    setStoredSubscriptionAutoRefreshTimestamp(legacyKey, null)
  }
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 * @param {number | null} timestamp
 */
function setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, timestamp) {
  setStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX,
      profileId,
      tab
    ),
    timestamp
  )
}

/**
 * @param {string} profileId
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab) {
  return getStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
      profileId,
      tab
    )
  )
}

/**
 * @param {string} profileId
 */
function synchronizeSubscriptionAutoRefreshProfile(profileId) {
  for (const tab of subscriptionAutoRefreshTabs) {
    commitSubscriptionTabLastRefreshTimestamp(
      tab,
      getStoredSubscriptionTabLastRefreshTimestamp(profileId, tab)
    )
    scheduleSubscriptionTabAutoRefresh(tab, profileId)
  }
}

/**
 * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string, timestamp: number}>} event
 */
function handleSubscriptionRefreshCompleted(event) {
  const { tab, profileId, timestamp } = event.detail
  if (!subscriptionAutoRefreshTabs.includes(tab) || typeof profileId !== 'string') {
    return
  }

  setStoredSubscriptionAutoRefreshTimestamp(
    getSubscriptionAutoRefreshStorageKey(
      SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX,
      profileId,
      tab
    ),
    timestamp
  )

  const interval = parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
  const nextTimestamp = isSubscriptionTabAutoRefreshEnabled(tab) ? timestamp + interval : null
  setStoredSubscriptionTabNextAutoRefreshTimestamp(profileId, tab, nextTimestamp)

  if (profileId === activeSubscriptionProfileId.value) {
    commitSubscriptionTabLastRefreshTimestamp(tab, timestamp)
    scheduleSubscriptionTabAutoRefresh(tab, profileId, nextTimestamp)
  }
}

/**
 * @param {CustomEvent<{tab: string, profileId: string}>} event
 */
function handleSubscriptionRefreshStarted(event) {
  if (!process.env.IS_ELECTRON) {
    try {
      localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify(event.detail))
    } catch {
      // The owner still has its renderer-local progress state.
    }
  }
  store.commit('setSubscriptionFeedRefreshInProgress', true)
}

function handleSubscriptionRefreshFinished() {
  if (!process.env.IS_ELECTRON) {
    try {
      localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    } catch {
      // The owner still clears its renderer-local progress state.
    }
  }
  store.commit('setSubscriptionFeedRefreshInProgress', false)
}

/**
 * @param {StorageEvent} event
 */
function handleSubscriptionAutoRefreshStorage(event) {
  if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY) {
    store.commit('setSubscriptionFeedRefreshInProgress', event.newValue !== null)
    return
  }

  const deadline = parseSubscriptionAutoRefreshStorageKey(
    event.key,
    SUBSCRIPTION_AUTO_REFRESH_DEADLINE_STORAGE_KEY_PREFIX
  )
  if (deadline && deadline.profileId === activeSubscriptionProfileId.value) {
    const timestamp = Number(event.newValue)
    if (event.newValue === null || !Number.isFinite(timestamp) || timestamp <= 0) {
      clearSubscriptionTabAutoRefreshTimer(deadline.tab)
      commitSubscriptionTabNextAutoRefreshTimestamp(deadline.tab, null)
    } else {
      scheduleSubscriptionTabAutoRefresh(deadline.tab, deadline.profileId, timestamp)
    }
    return
  }

  const completion = parseSubscriptionAutoRefreshStorageKey(
    event.key,
    SUBSCRIPTION_AUTO_REFRESH_COMPLETION_STORAGE_KEY_PREFIX
  )
  if (completion && completion.profileId === activeSubscriptionProfileId.value) {
    const timestamp = Number(event.newValue)
    commitSubscriptionTabLastRefreshTimestamp(
      completion.tab,
      Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
    )
  }
}

/**
 * @param {string | null} key
 * @param {string} prefix
 * @returns {{profileId: string, tab: 'videos' | 'shorts' | 'live' | 'posts'} | null}
 */
function parseSubscriptionAutoRefreshStorageKey(key, prefix) {
  if (!key?.startsWith(prefix)) {
    return null
  }

  const separatorIndex = key.lastIndexOf('/')
  const tab = key.slice(separatorIndex + 1)
  if (separatorIndex < prefix.length || !subscriptionAutoRefreshTabs.includes(tab)) {
    return null
  }

  try {
    return {
      profileId: decodeURIComponent(key.slice(prefix.length, separatorIndex)),
      tab
    }
  } catch {
    return null
  }
}

function clearSubscriptionFeedAutoRefreshTimer() {
  clearSubscriptionTabAutoRefreshTimer('videos')
  clearSubscriptionTabAutoRefreshTimer('shorts')
  clearSubscriptionTabAutoRefreshTimer('live')
  clearSubscriptionTabAutoRefreshTimer('posts')
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function clearSubscriptionTabAutoRefreshTimer(tab) {
  clearTimeout(subscriptionAutoRefreshTimers[tab])
  subscriptionAutoRefreshTimers[tab] = null
}

/** @type {import('vue').ComputedRef<string>} */
const baseTheme = computed(() => store.getters.getBaseTheme)

watch(baseTheme, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const mainColor = computed(() => store.getters.getMainColor)

watch(mainColor, updateTheme)

/** @type {import('vue').ComputedRef<string>} */
const secColor = computed(() => store.getters.getSecColor)

watch(secColor, updateTheme)

function updateTheme() {
  document.body.className = `${baseTheme.value || 'system'} main${mainColor.value || 'Red'} sec${secColor.value || 'Blue'}`
  document.body.dataset.systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

updateTheme()

const showUpdatesBanner = ref(false)
const latestVersionNumber = ref('')
const showReleaseNotes = ref(false)
const changeLogTitle = ref('')
const updateChangelog = ref('')

/** @type {import('vue').ComputedRef<boolean>} */
const checkForUpdates = computed(() => store.getters.getCheckForUpdates)

const updateBannerMessage = computed(() => {
  return t('Version {versionNumber} is now available!  Click for more details', {
    versionNumber: latestVersionNumber.value
  })
})

async function checkForNewUpdates() {
  if (!checkForUpdates.value) {
    return
  }

  try {
    const response = await fetch('https://api.github.com/repos/OpenTubeX/OpenTubeX/releases?per_page=1')
    const json = await response.json()

    const tagName = json[0].tag_name
    const versionNumber = tagName.replace('v', '').replace('-beta', '')

    let changelog = json[0].body
      // Link usernames to their GitHub profiles
      .replaceAll(/@(\S+)\b/g, '[@$1](https://github.com/$1)')
      // Shorten pull request links to #1234
      .replaceAll(/https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/pull\/(\d+)/g, '[#$1]($&)')

    // Add the title
    changelog = `${changelog}`

    updateChangelog.value = releaseNotesMarkdown.parse(changelog)
    changeLogTitle.value = json[0].name
    latestVersionNumber.value = versionNumber

    const appVersion = packageDetails.version.split('.')
    const latestVersion = versionNumber.split('.')

    if (parseInt(appVersion[0]) < parseInt(latestVersion[0])) {
      showUpdatesBanner.value = true
    } else if (parseInt(appVersion[1]) < parseInt(latestVersion[1])) {
      showUpdatesBanner.value = true
    } else if (parseInt(appVersion[2]) < parseInt(latestVersion[2]) && parseInt(appVersion[1]) <= parseInt(latestVersion[1])) {
      showUpdatesBanner.value = true
    }
  } catch (error) {
    console.error('errored while checking for updates', 'https://api.github.com/repos/OpenTubeX/OpenTubeX/releases?per_page=1', error)
  }
}

function toggleShowReleaseNotes() {
  showReleaseNotes.value = !showReleaseNotes.value
}

/**
 * @param {boolean} response
 */
function handleUpdateBannerClick(response) {
  if (response) {
    showReleaseNotes.value = true
  } else {
    showUpdatesBanner.value = false
  }
}

function openDownloadsPage() {
  openExternalLink('https://github.com/OpenTubeX/OpenTubeX/releases')
  showReleaseNotes.value = false
  showUpdatesBanner.value = false
}

/** @type {import('vue').ComputedRef<boolean>} */
const outlinesHidden = computed(() => store.getters.getOutlinesHidden)

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  const ctrlOrCmdPressed = isCtrlOrCmdPressed(event)

  if (ctrlOrCmdPressed && (event.key === 'f' || event.key === 'F') && !event.shiftKey) {
    event.preventDefault()
    openFindbar()
    return
  }

  if (findbarVisible.value && handleFindbarNavigationShortcut(event)) {
    return
  }

  if (tabSwitcherVisible.value && event.key === 'Escape') {
    event.preventDefault()
    cancelTabSwitcher()
    return
  }

  if (findbarVisible.value && event.key === 'Escape') {
    event.preventDefault()
    closeFindbar()
    return
  }

  if (findbarVisible.value && event.key === 'Enter' && !isTypingTarget(event.target)) {
    event.preventDefault()
    findInPage(event.shiftKey)
    return
  }

  if (event.shiftKey && event.key === '?' && !isTypingTarget(event.target)) {
    store.commit('setIsKeyboardShortcutPromptShown', !isKeyboardShortcutPromptShown.value)
  }

  if (event.key === 'Tab' && !event.ctrlKey) {
    store.dispatch('showOutlines')
  }

  // Tab keyboard shortcuts (Electron only)
  if (process.env.IS_ELECTRON) {
    // Ctrl+1..9: Switch to tab by number
    if (ctrlOrCmdPressed && event.key >= '1' && event.key <= '9' && !event.shiftKey) {
      if (!isTypingTarget(event.target)) {
        const index = parseInt(event.key, 10) - 1
        const tabs = store.state.tabs.tabs
        if (index < tabs.length) {
          event.preventDefault()
          store.dispatch('activateTab', tabs[index].id)
          return
        }
      }
    }

    // Ctrl+T: New tab
    if (ctrlOrCmdPressed && (event.key === 't' || event.key === 'T') && !event.shiftKey) {
      event.preventDefault()
      store.dispatch('createTab', { makeActive: true })
      return
    }

    // Ctrl+Shift+T: Restore closed tab
    if (ctrlOrCmdPressed && event.shiftKey && (event.key === 't' || event.key === 'T')) {
      event.preventDefault()
      store.dispatch('restoreClosedTab')
      return
    }

    // Ctrl+W: Close tab (handled in menu, but also here for robustness)
    if (ctrlOrCmdPressed && (event.key === 'w' || event.key === 'W') && !event.shiftKey) {
      event.preventDefault()
      store.dispatch('closeActiveTab').then((hasRemainingTabs) => {
        if (!hasRemainingTabs) {
          window.close()
        }
      })
      return
    }

    // Ctrl+Tab: Next tab
    if (event.ctrlKey && event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      cycleTabSwitcher(1)
      return
    }

    // Ctrl+Shift+Tab: Previous tab
    if (event.ctrlKey && event.shiftKey && event.key === 'Tab') {
      event.preventDefault()
      cycleTabSwitcher(-1)
      return
    }

    // Ctrl+R: Reload tab (unless the current view handles refresh itself)
    if (ctrlOrCmdPressed && (event.key === 'r' || event.key === 'R') && !event.shiftKey) {
      if (route.path.startsWith('/subscriptions')) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      prepareAndReloadTab()
    }
  }
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function isCtrlOrCmdPressed(event) {
  return (process.platform !== 'darwin' && event.ctrlKey) ||
    (process.platform === 'darwin' && event.metaKey)
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function handleFindbarNavigationShortcut(event) {
  const isFindNavigationShortcut = (
    isCtrlOrCmdPressed(event) && (event.key === 'g' || event.key === 'G') && !event.altKey
  ) || (
    event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey
  )

  if (!isFindNavigationShortcut) {
    return false
  }

  event.preventDefault()
  findInPage(event.shiftKey)
  return true
}

function openFindbar() {
  findbarVisible.value = true

  const selection = window.getSelection()?.toString().trim()
  if (selection) {
    findbarQuery.value = selection
  }

  nextTick(() => {
    findbarInputRef.value?.focus()
    findbarInputRef.value?.select()
    findInPage()
  })
}

function closeFindbar() {
  findbarVisible.value = false
  findbarMatchIndex.value = 0
  findbarMatchCount.value = 0
  clearFindbarHighlights()
}

/**
 * @param {boolean | Event} [backwards]
 */
function findInPage(backwards = null) {
  const query = findbarQuery.value.trim()
  if (query.length === 0) {
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0
    clearFindbarHighlights()
    return
  }

  const input = findbarInputRef.value
  const selectionStart = input?.selectionStart ?? query.length
  const selectionEnd = input?.selectionEnd ?? query.length
  const isNavigation = typeof backwards === 'boolean'
  const direction = backwards === true ? -1 : 1

  if (!isNavigation || findbarMatches.length === 0) {
    highlightFindbarMatches(query)
  } else {
    selectFindbarMatch(findbarMatchIndex.value - 1 + direction)
  }

  requestAnimationFrame(() => {
    input?.focus()
    input?.setSelectionRange(selectionStart, selectionEnd)
  })
}

/**
 * @param {string} query
 */
function highlightFindbarMatches(query) {
  clearFindbarHighlights()

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (
          isFindbarTextNode(node) ||
          isNonSearchableTextNode(node) ||
          isHiddenTextNode(node)
        ) {
          return NodeFilter.FILTER_REJECT
        }

        return NodeFilter.FILTER_ACCEPT
      }
    }
  )
  const normalizedQuery = query.toLocaleLowerCase()
  const ranges = []

  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = node.textContent ?? ''
    const normalizedText = text.toLocaleLowerCase()
    let index = normalizedText.indexOf(normalizedQuery)

    while (index !== -1) {
      ranges.push({
        node,
        start: index,
        end: index + normalizedQuery.length
      })
      index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length)
    }
  }

  const matches = ranges.map((rangeInfo) => {
    const range = document.createRange()
    range.setStart(rangeInfo.node, rangeInfo.start)
    range.setEnd(rangeInfo.node, rangeInfo.end)
    return range
  })

  findbarMatches = matches
  findbarMatchCount.value = matches.length
  paintFindbarHighlights()
  selectFindbarMatch(matches.length > 0 ? 0 : -1)
}

function clearFindbarHighlights() {
  window.CSS.highlights.delete('findbarmatch')
  window.CSS.highlights.delete('findbarmatchcurrent')
  findbarMatches = []
}

function paintFindbarHighlights() {
  const highlight = new window.Highlight(...findbarMatches)
  highlight.priority = 0
  window.CSS.highlights.set('findbarmatch', highlight)
}

/**
 * @param {number} index
 */
function selectFindbarMatch(index) {
  const matches = findbarMatches
  if (matches.length === 0) {
    findbarMatchIndex.value = 0
    findbarMatchCount.value = 0
    return
  }

  const nextIndex = (index + matches.length) % matches.length
  const currentMatch = matches[nextIndex]
  const currentHighlight = new window.Highlight(currentMatch)
  currentHighlight.priority = 1

  window.CSS.highlights.set('findbarmatchcurrent', currentHighlight)
  scrollFindbarMatchIntoView(currentMatch)

  findbarMatchIndex.value = nextIndex + 1
  findbarMatchCount.value = matches.length
}

/**
 * @param {Range} match
 */
function scrollFindbarMatchIntoView(match) {
  const rect = match.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return
  }

  const targetBlockCenter = rect.top + rect.height / 2
  const viewportBlockCenter = window.innerHeight / 2
  window.scrollBy({
    top: targetBlockCenter - viewportBlockCenter,
    behavior: 'smooth'
  })
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isFindbarTextNode(node) {
  return node.parentElement?.closest('.findbar') != null
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isNonSearchableTextNode(node) {
  return node.parentElement?.closest('datalist, input, option, optgroup, script, select, style, template, textarea') != null
}

/**
 * @param {Node} node
 * @returns {boolean}
 */
function isHiddenTextNode(node) {
  const element = node.parentElement
  if (element == null) {
    return true
  }

  const style = window.getComputedStyle(element)
  return style.display === 'none' ||
    style.visibility === 'hidden' ||
    element.closest('[aria-hidden="true"]') != null
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcutKeyup(event) {
  if (!tabSwitcherVisible.value) {
    return
  }

  if (event.key === 'Control' || !event.ctrlKey) {
    event.preventDefault()
    commitTabSwitcherSelection()
  }
}

/**
 * @param {number} direction
 */
function cycleTabSwitcher(direction) {
  const tabs = tabSwitcherTabs.value
  if (tabs.length <= 1) {
    return
  }

  if (!tabSwitcherVisible.value) {
    const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === store.getters.getActiveTabId))
    tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(activeIndex + direction, tabs.length)
    tabSwitcherPreviewUrls.value = {}
    tabSwitcherPointerActive.value = false
    tabSwitcherVisible.value = true
    scrollTabSwitcherSelectionIntoView()
    loadTabSwitcherPreviews()
    return
  }

  tabSwitcherSelectedIndex.value = wrapTabSwitcherIndex(
    tabSwitcherSelectedIndex.value + direction,
    tabs.length
  )
  scrollTabSwitcherSelectionIntoView()
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
function wrapTabSwitcherIndex(index, length) {
  return (index + length) % length
}

function loadTabSwitcherPreviews() {
  if (
    !process.env.IS_ELECTRON ||
    typeof window.ftElectron?.tabs?.capturePreview !== 'function'
  ) {
    return
  }

  const requestId = ++tabSwitcherPreviewRequestId
  for (const tab of tabSwitcherTabs.value) {
    window.ftElectron.tabs.capturePreview(tab.id).then((dataUrl) => {
      if (
        requestId !== tabSwitcherPreviewRequestId ||
        !tabSwitcherVisible.value ||
        typeof dataUrl !== 'string' ||
        dataUrl.length === 0
      ) {
        return
      }

      tabSwitcherPreviewUrls.value = {
        ...tabSwitcherPreviewUrls.value,
        [tab.id]: dataUrl
      }
    }).catch(() => {})
  }
}

/**
 * @param {number} index
 */
function setTabSwitcherSelectedIndex(index) {
  tabSwitcherSelectedIndex.value = index
}

function activateTabSwitcherPointer() {
  tabSwitcherPointerActive.value = true
}

function clearTabSwitcherSelection() {
  tabSwitcherSelectedIndex.value = -1
  tabSwitcherPointerActive.value = false
}

/**
 * @param {WheelEvent} event
 */
function handleTabSwitcherWheel(event) {
  const switcher = tabSwitcherRef.value
  if (!(switcher instanceof HTMLElement)) {
    return
  }

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY

  if (delta === 0) {
    return
  }

  switcher.scrollLeft += delta
}

function scrollTabSwitcherSelectionIntoView() {
  nextTick(() => {
    const selectedTabId = tabSwitcherSelectedTabId.value
    if (selectedTabId == null) {
      return
    }

    document.getElementById(selectedTabId)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    })
  })
}

/**
 * @param {number} [index]
 */
function commitTabSwitcherSelection(index) {
  if (typeof index === 'number') {
    tabSwitcherSelectedIndex.value = index
  }

  const selectedTab = tabSwitcherTabs.value[tabSwitcherSelectedIndex.value]
  cancelTabSwitcher()

  if (selectedTab && selectedTab.id !== store.getters.getActiveTabId) {
    store.dispatch('activateTab', selectedTab.id)
  }
}

function cancelTabSwitcher() {
  if (!tabSwitcherVisible.value) {
    return
  }

  tabSwitcherVisible.value = false
  tabSwitcherSelectedIndex.value = -1
  tabSwitcherPreviewUrls.value = {}
  tabSwitcherPointerActive.value = false
  tabSwitcherPreviewRequestId++
}

/**
 * @param {string} title
 * @returns {string}
 */
function formatTabSwitcherTitle(title) {
  if (!title) return title
  const suffix = ` - ${packageDetails.productName}`
  if (title.endsWith(suffix)) {
    return title.slice(0, -suffix.length)
  }
  return title
}

/**
 * @param {{color?: string | null}} tab
 * @returns {Record<string, string | undefined>}
 */
function getTabSwitcherItemStyle(tab) {
  return {
    '--tab-switcher-accent-color': getTabAccentColor(tab.color) || undefined
  }
}

function prepareAndReloadTab() {
  if (route.path.startsWith('/watch/')) {
    const timestamp = store.getters.getCurrentWatchTimestamp
    if (typeof timestamp === 'number' && timestamp > 0) {
      router.replace({
        path: route.path,
        query: { ...route.query, oneTimeTimestamp: Math.floor(timestamp) }
      })
    }
  }
  store.dispatch('reloadActiveTab')
}

function handleMouseDown() {
  store.dispatch('hideOutlines')
}

const lastExternalLinkToBeOpened = ref('')
const showExternalLinkOpeningPrompt = ref(false)
const EXTERNAL_LINK_OPENING_PROMPT_VALUES = ['yes', 'no']

const externalLinkOpeningPromptNames = computed(() => [
  t('Yes, Open Link'),
  t('No')
])

/** @type {import('vue').ComputedRef<'' | 'openLinkAfterPrompt' | 'doNothing'>} */
const externalLinkHandling = computed(() => store.getters.getExternalLinkHandling)

/**
 * @param {'yes' | 'no' | null} option
 */
function handleExternalLinkOpeningPromptAnswer(option) {
  showExternalLinkOpeningPrompt.value = false

  if (option === 'yes' && lastExternalLinkToBeOpened.value.length > 0) {
    // Maybe user should be notified
    // if `lastExternalLinkToBeOpened` is empty

    // Open links externally
    openExternalLink(lastExternalLinkToBeOpened.value)
  }
}

/**
 * @param {PointerEvent} event
 */
function isExternalLink(event) {
  return event.target.tagName === 'A' && !event.target.href.startsWith(window.location.origin)
}

/**
 * @param {PointerEvent} event
 */
function handleClick(event) {
  if (isExternalLink(event)) {
    handleLinkClick(event)
  }
}

/**
 * @param {PointerEvent} event
 */
function handleAuxClick(event) {
  // auxclick fires for all clicks not performed with the primary button
  // only handle the link click if it was the middle button,
  // otherwise the context menu breaks
  if (isExternalLink(event) && event.button === 1) {
    handleLinkClick(event)
  }
}

/**
 * @param {PointerEvent} event
 */
function handleLinkClick(event) {
  const href = event.target.href
  event.preventDefault()

  // Check if it's a YouTube link, but exclude live chat pop out
  const youtubeUrlPattern = /^https?:\/\/((www\.)?youtube\.com(\/embed)?|youtu\.be)\/(?!.*live_chat).*$/
  const isYoutubeLink = youtubeUrlPattern.test(href)

  // Determine if we should open in new tab or new window
  const ctrlOrCmdPressed = (process.platform !== 'darwin' && event.ctrlKey) ||
    (process.platform === 'darwin' && event.metaKey)
  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const doCreateNewTab = ctrlOrCmdPressed || isMiddleClick
  const doCreateNewWindow = event.shiftKey

  if (isYoutubeLink) {
    handleYoutubeLink(href, {
      doCreateNewWindow,
      doCreateNewTab,
      isMiddleClick
    })
  } else if (externalLinkHandling.value === 'doNothing') {
    // Let user know opening external link is disabled via setting
    showToast(t('External link opening has been disabled in the general settings'))
  } else if (externalLinkHandling.value === 'openLinkAfterPrompt') {
    // Storing the URL is necessary as
    // there is no other way to pass the URL to click callback
    lastExternalLinkToBeOpened.value = href
    showExternalLinkOpeningPrompt.value = true
  } else {
    // Open links externally
    openExternalLink(href)
  }
}

async function handleYoutubeLink(href, { doCreateNewWindow = false, doCreateNewTab = false, isMiddleClick = false } = {}) {
  const result = await store.dispatch('getYoutubeUrlInfo', href)
  // Middle clicks should open tabs in background (not make them active)
  const makeActive = !isMiddleClick

  switch (result.urlType) {
    case 'video': {
      const { videoId, timestamp, playlistId } = result

      const query = {}
      if (timestamp) {
        query.timestamp = timestamp
      }
      if (playlistId && playlistId.length > 0) {
        query.playlistId = playlistId
      }

      openInternalPath({
        path: `/watch/${videoId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'playlist': {
      const { playlistId, query } = result

      openInternalPath({
        path: `/playlist/${playlistId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'search': {
      const { searchQuery, query } = result

      openInternalPath({
        path: `/search/${encodeURIComponent(searchQuery)}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        searchQueryText: searchQuery
      })
      break
    }

    case 'hashtag': {
      const { hashtag } = result
      openInternalPath({
        path: `/hashtag/${encodeURIComponent(hashtag)}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'post': {
      const { postId, query } = result

      openInternalPath({
        path: `/post/${postId}`,
        query,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'channel': {
      const { channelId, subPath, url } = result

      openInternalPath({
        path: `/channel/${channelId}/${subPath}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive,
        query: {
          url
        }
      })
      break
    }

    case 'trending':
    case 'subscriptions':
    case 'history':
    case 'userplaylists':
      openInternalPath({
        path: `/${result.urlType}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break

    case 'invalid_url': {
      // Do nothing
      break
    }

    default: {
      // Unknown URL type
      showToast(t('Unknown YouTube url type, cannot be opened in app'))
    }
  }
}

function enableOpenUrl() {
  window.ftElectron.handleOpenUrl((url) => {
    if (url) {
      handleYoutubeLink(url)
    }
  })
}

const windowTitle = computed(() => {
  const routePath = route.path
  if (
    !routePath.startsWith('/channel/') &&
    !routePath.startsWith('/watch/') &&
    !routePath.startsWith('/hashtag/') &&
    !routePath.startsWith('/playlist/') &&
    !routePath.startsWith('/search/')
  ) {
    return translateWindowTitle(route.meta.title) ?? ''
  } else {
    return null
  }
})

/** @type {import('vue').ComputedRef<string>} */
const appTitle = computed(() => store.getters.getAppTitle)

function publishAppTitle(value) {
  if (value.length > 0) {
    document.title = `${value} - ${packageDetails.productName}`
  } else {
    document.title = packageDetails.productName
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.setWindowTitle(document.title)
  }
}

watch(appTitle, publishAppTitle)

watch(windowTitle, setWindowTitle)

function setWindowTitle() {
  if (windowTitle.value !== null) {
    store.commit('setAppTitle', windowTitle.value)
    publishAppTitle(windowTitle.value)
  }
}

const isLocaleRightToLeft = computed(() => {
  const locale_ = locale.value

  return locale_ === 'ar' || locale_ === 'fa' || locale_ === 'he' ||
  locale_ === 'ur' || locale_ === 'yi' || locale_ === 'ku'
})

watch(locale, (value) => {
  document.documentElement.lang = value

  document.body.dir = isLocaleRightToLeft.value ? 'rtl' : 'ltr'
}, { immediate: true })

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/**
 * Transforms dragged in-app URLs into YouTube ones, so they they can be dragged into other applications.
 * Cancels the drag operation if the URL is FreeTube specific and cannot be transformed e.g. user playlist URLs
 * @param {DragEvent} event
 */
function handleDragStart(event) {
  if (!event.dataTransfer.types.includes('text/uri-list')) {
    return
  }

  const originalUrlString = event.dataTransfer.getData('text/uri-list')
  const originalUrl = new URL(originalUrlString)

  // Check if this is an in-app URL
  if (originalUrl.origin !== window.location.origin || originalUrl.pathname !== window.location.pathname) {
    return
  }

  const [path, query] = originalUrl.hash.slice(2).split('?')
  const pathParts = path.split('/')
  const params = new URLSearchParams(query)

  let transformed = false
  let transformedURL = new URL('https://www.youtube.com')

  switch (pathParts[0]) {
    case 'watch':
      transformedURL.pathname = '/watch'
      transformedURL.searchParams.set('v', pathParts[1])

      if (params.has('timestamp')) {
        transformedURL.searchParams.set('t', params.get('timestamp') + 's')
      }

      if (params.has('playlistId') && params.get('playlistType') !== 'user') {
        transformedURL.searchParams.set('list', params.get('playlistId'))
      }

      transformed = true
      break
    case 'playlist':
      if (params.get('playlistType') !== 'user') {
        transformedURL.pathname = '/playlist'
        transformedURL.searchParams.set('list', pathParts[1])

        transformed = true
      }
      break
    case 'channel':
      transformedURL.pathname = `/channel/${pathParts[1]}`

      if (pathParts[2]) {
        switch (pathParts[2]) {
          case 'community':
            transformedURL.pathname += '/posts'
            break
          case 'search':
            transformedURL.pathname += '/search'
            if (params.has('searchQueryText')) {
              transformedURL.searchParams.set('query', params.get('searchQueryText'))
            }
            break
          case 'videos':
          case 'shorts':
          case 'releases':
          case 'podcasts':
          case 'courses':
          case 'playlists':
          case 'about':
            transformedURL.pathname += `/${pathParts[2]}`
            break
        }
      }

      transformed = true
      break
    case 'search':
      transformedURL.pathname = '/results'
      transformedURL.searchParams.set('search_query', decodeURIComponent(pathParts[1]))
      transformed = true
      break
    case 'hashtag':
    case 'post':
      transformedURL.pathname = `/${pathParts[0]}/${pathParts[1]}`
      transformed = true
      break
    case 'subscriptions':
    case 'history':
      transformedURL.pathname = `/feed/${pathParts[1]}`
      transformed = true
      break
    case 'userplaylists':
      transformedURL.pathname = '/feed/playlists'
      transformed = true
      break
    case 'settings':
      transformedURL.pathname = '/account'
      transformed = true
      break
    case 'about':
      transformedURL.pathname = '/about'
      transformed = true
      break
    case 'popular':
      transformedURL = new URL(`${currentInvidiousInstanceUrl.value}/feed/popular`)
      transformed = true
      break
  }

  if (transformed) {
    const transformedURLString = transformedURL.toString()

    event.dataTransfer.setData('text/uri-list', transformedURLString)

    const plainText = event.dataTransfer.getData('text/plain')
    if (plainText.length > 0) {
      event.dataTransfer.setData('text/plain', plainText.replaceAll(originalUrlString, transformedURLString))
    }

    const html = event.dataTransfer.getData('text/html')
    if (html.length > 0) {
      const originalUrlStringEncoded = originalUrlString.replaceAll('&', '&amp;')
      const transformedURLStringEncoded = transformedURLString.replaceAll('&', '&amp;')

      event.dataTransfer.setData('text/html', html.replaceAll(originalUrlStringEncoded, transformedURLStringEncoded))
    }
  } else {
    // Cancel the drag operation for FreeTube specific URLs that cannot be transformed such as user playlist URLs
    event.preventDefault()
    event.stopPropagation()
  }
}
</script>

<style src="./themes.css" />
<style scoped src="./App.css" />
