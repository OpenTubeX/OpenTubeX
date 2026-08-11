<template>
  <div
    v-if="dataReady"
    class="app"
    :class="{
      hideOutlines: outlinesHidden,
      isLocaleRightToLeft: isLocaleRightToLeft,
      isSideNavOpen: isSideNavOpen,
      hideLabelsSideBar: hideLabelsSideBar && !isSideNavOpen,
      verticalTabs: useVerticalTabBar,
      watchSideNavOverlay: useWatchSideNavOverlay,
      watchSideNavTransitionDisabled
    }"
    :style="appStyle"
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
      <template v-if="isElectron">
        <TabContent
          v-for="tab in tabContainers"
          :key="tab.id"
          :tab="tab"
        />
      </template>
      <RouterView
        v-else
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
    <Transition name="settings-window">
      <SettingsWindow v-if="settingsWindowOpen" />
    </Transition>
    <FtPrompt
      v-if="showReleaseNotes"
      theme="readable-width"
      @click="toggleShowReleaseNotes"
    >
      <template #label="{ labelId }">
        <h1
          :id="labelId"
          class="changeLogTitle"
        >
          {{ changeLogTitle }}
        </h1>
      </template>
      <div
        v-safer-html.lenient="updateChangelog"
        v-overlay-scrollbars
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
      autosize
      :label="t('Are you sure you want to open this link?')"
      :extra-labels="[lastExternalLinkToBeOpened]"
      :option-names="externalLinkOpeningPromptNames"
      :option-values="EXTERNAL_LINK_OPENING_PROMPT_VALUES"
      @click="handleExternalLinkOpeningPromptAnswer"
    />
    <FtPrompt
      v-if="multipleTabsActionPrompt != null"
      autosize
      :label="multipleTabsActionPromptTitle"
      :extra-labels="[multipleTabsActionPromptMessage, t('Confirmations.Settings Hint')]"
      :option-names="multipleTabsActionPromptNames"
      :option-values="MULTIPLE_TABS_ACTION_PROMPT_VALUES"
      @click="handleMultipleTabsActionPromptAnswer"
    />
    <FtSearchFilters
      v-if="showSearchFilters"
    />
    <FtPlaylistAddVideoPrompt
      v-if="showAddToPlaylistPrompt"
    />
    <FtCreatePlaylistPrompt
      v-if="showCreatePlaylistPrompt"
    />
    <FtContextMenu v-if="isElectron" />
    <FtToast
      :show-subscription-refresh="presentedRoutePath !== '/subscriptions'"
    />
    <FtProgressBar
      v-if="showProgressBar"
      :progress="displayedProgressBarPercentage"
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
      data-tab-preview-overlay
      @mousedown.prevent
      @wheel.prevent="handleTabSwitcherWheel"
    >
      <div
        ref="tabSwitcherRef"
        v-overlay-scrollbars
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
            <img
              v-else-if="!tabSwitcherPreviewPending[tab.id] && getTabPreviewFallbackUrl(tab)"
              :src="getTabPreviewFallbackUrl(tab)"
              :alt="`${formatTabSwitcherTitle(tab.title)} preview`"
              class="tabSwitcherPreviewAvatar"
              draggable="false"
            >
            <span
              v-else-if="!tabSwitcherPreviewPending[tab.id]"
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
            <img
              v-if="showTabIcons && getTabAvatarUrl(tab)"
              :src="getTabAvatarUrl(tab)"
              class="tabSwitcherTitleAvatar"
              alt=""
              draggable="false"
            >
            <FontAwesomeIcon
              v-else-if="showTabIcons && getTabPageIcon(tab)"
              :icon="getTabPageIcon(tab)"
              class="tabSwitcherTitleIcon"
              aria-hidden="true"
            />
            <span class="tabSwitcherTitleText">
              {{ formatTabSwitcherTitle(tab.title) }}
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { routerKey, useRoute, useRouter } from 'vue-router'

import FtFlexBox from './components/ft-flex-box/ft-flex-box.vue'
import TopNav from './components/TopNav/TopNav.vue'
import SideNav from './components/SideNav/SideNav.vue'
import TabBar from './components/TabBar/TabBar.vue'
import TabContent from './components/TabContent/TabContent.vue'
import FtNotificationBanner from './components/FtNotificationBanner/FtNotificationBanner.vue'
import FtPrompt from './components/FtPrompt/FtPrompt.vue'
import FtButton from './components/FtButton/FtButton.vue'
import FtToast from './components/FtToast/FtToast.vue'
import FtProgressBar from './components/FtProgressBar/FtProgressBar.vue'
import FtPlaylistAddVideoPrompt from './components/FtPlaylistAddVideoPrompt/FtPlaylistAddVideoPrompt.vue'
import FtCreatePlaylistPrompt from './components/FtCreatePlaylistPrompt/FtCreatePlaylistPrompt.vue'
import FtSearchFilters from './components/FtSearchFilters/FtSearchFilters.vue'
import FtContextMenu from './components/FtContextMenu/FtContextMenu.vue'
import { vSaferHtml } from './directives/vSaferHtml.js'

import store from './store/index'

import packageDetails from '../../package.json'
import { MULTIPLE_TABS_CONFIRM_THRESHOLD, KeyboardShortcuts } from '../constants'
import { matchesKeyboardShortcut } from './helpers/keyboardShortcuts'
import { fetchReleasePages, findUpdateReleases, formatReleaseChangelog } from './helpers/releaseUpdates'
import { createReleaseNotesMarkdown } from './helpers/releaseNotesMarkdown'
import { openExternalLink, openInternalPath, showToast } from './helpers/utils'
import {
  cancelSubscriptionRefresh,
  refreshSubscriptionLiveFromRemote,
  refreshSubscriptionPostsFromRemote,
  refreshSubscriptionShortsFromRemote,
  refreshSubscriptionVideosFromRemote,
  SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY,
  SUBSCRIPTION_REFRESH_CANCELLED_EVENT,
  SUBSCRIPTION_REFRESH_COMPLETED_EVENT,
  SUBSCRIPTION_REFRESH_FINISHED_EVENT,
  SUBSCRIPTION_REFRESH_LOCK_NAME,
  SUBSCRIPTION_REFRESH_PROGRESS_EVENT,
  SUBSCRIPTION_REFRESH_STARTED_EVENT
} from './helpers/subscriptions'
import { translateWindowTitle } from './helpers/strings'
import { initializePlatformInfo } from './helpers/platform'
import { normalizeScrollbarThumbWidth } from './constants/scrollbar'
import { getTabAccentColor } from './constants/tabColors'
import { getThumbnailListStyles } from './constants/thumbnailSize'
import { getTabNavigationService } from './tabs/TabNavigationService'
import { tabRuntimeRegistry } from './tabs/TabRuntimeRegistry'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from './tabs/tabPreview'
import { preloadUtilityRoutes } from './router/index'

const SettingsWindow = defineAsyncComponent(() => import('./views/Settings/Settings.vue'))

const releaseNotesMarkdown = createReleaseNotesMarkdown()

const route = useRoute()
const router = useRouter()
const navigation = process.env.IS_ELECTRON ? getTabNavigationService() : null
const isElectron = process.env.IS_ELECTRON
const platformInfoReady = initializePlatformInfo()
if (isElectron) {
  provide(routerKey, navigation.createPresentedRouterFacade())
}
const { locale, t } = useI18n()

const tabContainers = computed(() => {
  return store.getters.getTabContainerIds
    .map(tabId => store.getters.getTabById(tabId))
    .filter(Boolean)
})
const activeTabId = computed(() => store.getters.getActiveTabId)
const presentedTabId = computed(() => store.getters.getPresentedTabId)
const selectionRevision = computed(() => store.state.tabs.selectionRevision)

/** @type {import('vue').ComputedRef<boolean>} */
const isSideNavOpen = computed(() => store.getters.getIsSideNavOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const hideLabelsSideBar = computed(() => store.getters.getHideLabelsSideBar)

/** @type {import('vue').ComputedRef<boolean>} */
const useVerticalTabBar = computed(() => isElectron && store.getters.getUseVerticalTabBar)

const appStyle = computed(() => {
  if (!useVerticalTabBar.value) {
    return undefined
  }

  return { '--vertical-tab-bar-width': `${store.getters.getVerticalTabBarWidth}px` }
})

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
    // Leaving the overlay brings the sidebar back into normal flow and may
    // reopen it. Suppress its inline-size transition for the reflow so the
    // content snaps to its final position instead of sliding in from the right.
    disableWatchSideNavTransitionForNextFrame()

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
const settingsWindowOpen = computed(() => store.getters.getSettingsWindowOpen)

/** @type {import('vue').ComputedRef<boolean>} */
const showAddToPlaylistPrompt = computed(() => store.getters.getShowAddToPlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const showCreatePlaylistPrompt = computed(() => store.getters.getShowCreatePlaylistPrompt)

/** @type {import('vue').ComputedRef<boolean>} */
const localProgressBarVisible = computed(() => store.getters.getShowProgressBar)

/** @type {import('vue').ComputedRef<boolean>} */
const subscriptionRefreshInProgress = computed(() => store.getters.getSubscriptionFeedRefreshInProgress)
const progressUsesToast = computed(() => {
  return store.getters.getShowProgressBarToast
})

const presentedRoutePath = computed(() => {
  if (isElectron) {
    return store.getters.getTabById(presentedTabId.value)?.route.path ?? ''
  }
  return route.path
})

const showProgressBar = computed(() => {
  // The Subscriptions view shows its own progress bar below the tab bar
  return (localProgressBarVisible.value && !progressUsesToast.value) ||
    (subscriptionRefreshInProgress.value &&
      !progressUsesToast.value &&
      presentedRoutePath.value !== '/subscriptions')
})
const displayedProgressBarPercentage = computed(() => {
  return localProgressBarVisible.value
    ? store.getters.getProgressBarPercentage
    : store.getters.getSubscriptionFeedRefreshProgress
})

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
const tabSwitcherPreviewPending = ref({})
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
let removeSubscriptionAutoRefreshCancelListener = null
let removeSubscriptionAutoRefreshStateChangedListener = null
let removeTabsStateListener = null
let removeReloadRequestListener = null
let removeConfirmMultipleTabsActionListener = null
let removeOpenUrlListener = null
const pendingSubscriptionAutoRefreshes = []
const pendingSubscriptionAutoRefreshKeys = new Set()
const cancelledSubscriptionAutoRefreshKeys = new Set()
let processingSubscriptionAutoRefreshes = false
let tabSwitcherPreviewRequestId = 0
let findbarMatches = []
const findbarStateByTabId = new Map()

const tabSwitcherTabs = computed(() => store.getters.getTabs)
const showTabIcons = computed(() => store.getters.getShowTabIcons)
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

/**
 * Falls back to OpenTubeX-managed external software when the configured system
 * executables are unavailable and updates every selected managed executable.
 */
async function initializeManagedExternalSoftware() {
  if (!isElectron) {
    return
  }

  const info = await window.ftElectron.ytDlpGetInfo()
  if (info === null) {
    return
  }

  /** @type {('yt-dlp' | 'ffmpeg')[]} */
  const missingBinaries = []
  /** @type {('yt-dlp' | 'ffmpeg')[]} */
  const binariesToUpdate = []

  if (!info.ytDlp.available) {
    missingBinaries.push('yt-dlp')
  }
  if (!info.ffmpeg.available) {
    missingBinaries.push('ffmpeg')
  }

  if (store.getters.getYtDlpSource === 'managed' || missingBinaries.includes('yt-dlp')) {
    binariesToUpdate.push('yt-dlp')
  }
  if (store.getters.getYtDlpFfmpegSource === 'managed' || missingBinaries.includes('ffmpeg')) {
    binariesToUpdate.push('ffmpeg')
  }
  if (binariesToUpdate.length === 0) {
    return
  }

  const settingUpdates = []
  if (missingBinaries.includes('yt-dlp') && store.getters.getYtDlpSource !== 'managed') {
    settingUpdates.push(store.dispatch('updateYtDlpSource', 'managed'))
  }
  if (missingBinaries.includes('ffmpeg') && store.getters.getYtDlpFfmpegSource !== 'managed') {
    settingUpdates.push(store.dispatch('updateYtDlpFfmpegSource', 'managed'))
  }
  await Promise.all(settingUpdates)

  let downloadStarted = missingBinaries.length > 0
  let toolProgressPercentage = 0

  function showToolProgress(message) {
    store.commit('setProgressBarMessage', message)
    store.commit('setProgressBarIcon', ['fas', 'download'])
    store.commit('setProgressBarPercentage', toolProgressPercentage)
    store.commit('setShowProgressBar', true)
  }

  if (downloadStarted) {
    const tools = binariesToUpdate.join(' and ')
    const message = t('Settings.Download Settings.Managed Tools Download Started Template', { tools })
    if (!progressUsesToast.value) {
      showToast({ message, icon: ['fas', 'download'] })
    }
    showToolProgress(message)
  }

  const progressByBinary = Object.fromEntries(
    binariesToUpdate.map(binary => [binary, 0])
  )
  const removeProgressListener = window.ftElectron.addYtDlpBinaryDownloadProgressListener(({ binary, percent, inProgress }) => {
    if (!binariesToUpdate.includes(binary) || !inProgress || percent === null) {
      return
    }

    if (!downloadStarted) {
      downloadStarted = true
      const tools = binariesToUpdate.join(' and ')
      const message = t('Settings.Download Settings.Managed Tools Update Started Template', { tools })
      if (!progressUsesToast.value) {
        showToast({ message, icon: ['fas', 'download'] })
      }
      showToolProgress(message)
    }

    progressByBinary[binary] = Math.max(progressByBinary[binary] ?? 0, percent)
    const percentages = Object.values(progressByBinary)
    const combinedPercentage = percentages.reduce((sum, value) => sum + value, 0) / percentages.length
    toolProgressPercentage = Math.max(toolProgressPercentage, combinedPercentage)
    store.commit('setProgressBarPercentage', toolProgressPercentage)
  })

  try {
    const results = await Promise.all(binariesToUpdate.map(async binary => {
      try {
        return { binary, result: await window.ftElectron.ytDlpDownloadBinary(binary) }
      } catch (error) {
        return { binary, result: { error: String(error) } }
      }
    }))
    const failures = results.filter(({ result }) => result === null || 'error' in result)
    const updatedBinaries = results
      .filter(({ result }) => result !== null && 'version' in result && result.updated)
      .map(({ binary }) => binary)

    if (failures.length === 0 && updatedBinaries.length > 0) {
      toolProgressPercentage = 100
      store.commit('setProgressBarPercentage', toolProgressPercentage)
      const updatedTools = updatedBinaries.join(' and ')
      showToast({
        message: missingBinaries.length > 0
          ? t('Settings.Download Settings.Managed Tools Download Finished Template', { tools: updatedTools })
          : t('Settings.Download Settings.Managed Tools Update Finished Template', { tools: updatedTools }),
        icon: ['fas', 'check'],
      })
    } else {
      if (failures.length > 0) {
        const errors = failures.map(({ binary, result }) => `${binary}: ${result?.error ?? ''}`).join('; ')
        showToast({
          message: t('Settings.Download Settings.Managed Tools Download Error Template', { errors }),
          icon: ['fas', 'circle-exclamation'],
        })
      }
    }
  } finally {
    removeProgressListener()
    if (downloadStarted) {
      store.commit('setShowProgressBar', false)
      store.commit('setProgressBarPercentage', 0)
      store.commit('setProgressBarMessage', '')
      store.commit('setProgressBarIcon', ['fas', 'sync'])
    }
  }
}

onMounted(async () => {
  preloadUtilityRoutes()

  if (isElectron) {
    removeTabsStateListener = await store.dispatch('initializeTabs')
    window.ftElectron.tabs.rendererReady()
  }

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

  store.dispatch('grabAllProfiles', t('Profile.All Channels')).then(async () => {
    const syncDataReady = Promise.all([
      store.dispatch('grabHistory'),
      store.dispatch('grabAllPlaylists'),
    ])
    store.dispatch('grabAllSubscriptions')
    store.dispatch('grabSearchHistoryEntries')

    // YouTube links have to be caught in both builds, otherwise the browser
    // navigates away from the app instead of opening the linked video,
    // channel, playlist or hashtag in it
    document.addEventListener('click', handleClick)
    document.addEventListener('auxclick', handleAuxClick)

    if (process.env.IS_ELECTRON) {
      store.dispatch('setupListenersToSyncWindows')
      removeOpenUrlListener = enableOpenUrl()
      store.dispatch('getExternalPlayerCmdArgumentsData')
      removeReloadRequestListener = window.ftElectron.tabs.onRequestReload(prepareAndReloadTab)
      removeConfirmMultipleTabsActionListener = window.ftElectron.tabs
        .onConfirmMultipleAction(handleConfirmMultipleTabsActionRequest)
    }

    await Promise.all([syncDataReady, platformInfoReady])
    store.dispatch('initializeSyncServer').catch(error => {
      console.error('Initial sync server sync failed', error)
    })

    dataReady.value = true

    await nextTick()
    initializeManagedExternalSoftware().catch(error => console.error('Failed to initialize managed external software', error))

    setTimeout(() => {
      checkForNewUpdates()
    }, 500)
  })

  await router.isReady()

  if (isElectron) {
    const activeTab = store.getters.getActiveTab
    if (activeTab?.route.path === '/') {
      await navigation.replace(activeTab.id, { path: landingPage.value })
    }
  } else if (route.path === '/') {
    await router.replace({ path: landingPage.value })
  }

  setWindowTitle()

  document.addEventListener('keydown', handleKeyboardShortcuts)
  document.addEventListener('keyup', handleKeyboardShortcutKeyup)
  document.addEventListener('mousedown', handleMouseDown)
  document.addEventListener('dragstart', handleDragStart)
  window.addEventListener('blur', cancelTabSwitcher)
  window.addEventListener('online', refreshOverdueSubscriptionFeeds)
  window.addEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.addEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
  window.addEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.addEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.addEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
  window.addEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.addEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  if (process.env.IS_ELECTRON) {
    removeSubscriptionAutoRefreshStateChangedListener = window.ftElectron.subscriptionAutoRefresh.onStateChanged(
      applySubscriptionAutoRefreshState
    )
    removeSubscriptionAutoRefreshCancelListener = window.ftElectron.subscriptionAutoRefresh.onCancelRequested(
      cancelSubscriptionRefresh
    )
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
  if (isElectron) {
    window.ftElectron.tabs.setPreviewCapturePaused(false)
  }
  cancelWatchSideNavTransitionReset()
  clearSubscriptionFeedAutoRefreshTimer()
  clearInterval(historyCleanupTimer)
  store.dispatch('stopSyncServerAutoSync')
  document.removeEventListener('keydown', handleKeyboardShortcuts)
  document.removeEventListener('keyup', handleKeyboardShortcutKeyup)
  document.removeEventListener('mousedown', handleMouseDown)
  document.removeEventListener('dragstart', handleDragStart)
  document.removeEventListener('click', handleClick)
  document.removeEventListener('auxclick', handleAuxClick)
  window.removeEventListener('blur', cancelTabSwitcher)
  window.removeEventListener('online', refreshOverdueSubscriptionFeeds)
  window.removeEventListener('storage', handleSubscriptionAutoRefreshStorage)
  window.removeEventListener(SUBSCRIPTION_REFRESH_CANCELLED_EVENT, handleSubscriptionRefreshCancelled)
  window.removeEventListener(SUBSCRIPTION_REFRESH_COMPLETED_EVENT, handleSubscriptionRefreshCompleted)
  window.removeEventListener(SUBSCRIPTION_REFRESH_FINISHED_EVENT, handleSubscriptionRefreshFinished)
  window.removeEventListener(SUBSCRIPTION_REFRESH_PROGRESS_EVENT, handleSubscriptionRefreshProgress)
  window.removeEventListener(SUBSCRIPTION_REFRESH_STARTED_EVENT, handleSubscriptionRefreshStarted)
  document.removeEventListener('visibilitychange', handleSubscriptionAutoRefreshVisibilityChange)
  removeSubscriptionAutoRefreshActiveChangedListener?.()
  removeSubscriptionAutoRefreshCancelListener?.()
  removeSubscriptionAutoRefreshStateChangedListener?.()
  removeTabsStateListener?.()
  removeReloadRequestListener?.()
  removeConfirmMultipleTabsActionListener?.()
  removeOpenUrlListener?.()
})

watch([activeTabId, selectionRevision], ([tabId, revision]) => {
  if (isElectron && tabId) {
    navigation.requestPresentation(tabId, revision)
  }
}, { immediate: true })

watch(presentedTabId, async (tabId, previousTabId) => {
  if (!isElectron || tabId === previousTabId) {
    return
  }

  if (previousTabId) {
    findbarStateByTabId.set(previousTabId, {
      visible: findbarVisible.value,
      query: findbarQuery.value,
      matchIndex: Math.max(0, findbarMatchIndex.value - 1)
    })
  }

  clearFindbarHighlights()
  const state = findbarStateByTabId.get(tabId) ?? {
    visible: false,
    query: '',
    matchIndex: 0
  }
  findbarVisible.value = state.visible
  findbarQuery.value = state.query
  findbarMatchIndex.value = 0
  findbarMatchCount.value = 0

  if (state.visible && state.query.trim().length > 0) {
    await nextTick()
    highlightFindbarMatches(state.query.trim())
    selectFindbarMatch(state.matchIndex)
  }
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

        cancelledSubscriptionAutoRefreshKeys.delete(key)
        const result = await getSubscriptionTabRefreshHandler(tab)({
          t,
          showStartToast: true
        })
        const wasCancelled = cancelledSubscriptionAutoRefreshKeys.delete(key)

        if (result === null) {
          if (wasCancelled) {
            scheduleSubscriptionTabAutoRefresh(tab, profileId, Date.now() + getSubscriptionTabAutoRefreshInterval(tab))
          } else {
            scheduleSubscriptionTabAutoRefreshLockRetry(tab, profileId)
          }
        }
      } catch (error) {
        cancelledSubscriptionAutoRefreshKeys.delete(key)
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
    let state
    if (process.env.IS_ELECTRON) {
      state = await window.ftElectron.subscriptionAutoRefresh.isInProgress()
    } else if (navigator.locks) {
      const { held } = await navigator.locks.query()
      const inProgress = held.some(lock => lock.name === SUBSCRIPTION_REFRESH_LOCK_NAME)
      if (!inProgress) {
        localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
      }
      const progressState = inProgress ? getStoredSubscriptionRefreshProgressState() : null
      state = {
        inProgress,
        percentage: progressState?.percentage ?? 0,
        tab: progressState?.tab ?? null
      }
    } else {
      const progressState = getStoredSubscriptionRefreshProgressState()
      state = {
        inProgress: progressState !== null,
        percentage: progressState?.percentage ?? 0,
        tab: progressState?.tab ?? null
      }
    }

    applySubscriptionAutoRefreshState(state)
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
function getSubscriptionTabAutoRefreshInterval(tab) {
  return parseInt(getSubscriptionAutoRefreshInterval(tab).value, 10)
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} tab
 */
function isSubscriptionTabAutoRefreshEnabled(tab) {
  const interval = getSubscriptionTabAutoRefreshInterval(tab)

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
 * @param {CustomEvent<{tab: 'videos' | 'shorts' | 'live' | 'posts', profileId: string}>} event
 */
function handleSubscriptionRefreshCancelled(event) {
  const { tab, profileId } = event.detail
  if (
    profileId !== activeSubscriptionProfileId.value ||
    !subscriptionAutoRefreshTabs.includes(tab)
  ) {
    return
  }

  cancelledSubscriptionAutoRefreshKeys.add(`${profileId}:${tab}`)
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
      localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
        ...event.detail,
        percentage: 0
      }))
    } catch {
      // The owner still has its renderer-local progress state.
    }
  }
  applySubscriptionAutoRefreshState({
    inProgress: true,
    percentage: 0,
    tab: event.detail.tab
  })
}

/**
 * @param {CustomEvent<{percentage: number, ownerTabId?: string | null}>} event
 */
function handleSubscriptionRefreshProgress(event) {
  const percentage = normalizeSubscriptionRefreshProgress(event.detail.percentage)
  store.commit('setSubscriptionFeedRefreshProgress', percentage)

  if (process.env.IS_ELECTRON) {
    window.ftElectron.subscriptionAutoRefresh.setProgress(
      event.detail.ownerTabId ?? store.getters.getActiveTabId,
      percentage
    )
    return
  }

  try {
    const progressState = getStoredSubscriptionRefreshProgressState() ?? {}
    localStorage.setItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...progressState,
      percentage
    }))
  } catch {
    // The owner still has its renderer-local progress state.
  }
}

function handleSubscriptionRefreshFinished() {
  if (!process.env.IS_ELECTRON) {
    try {
      localStorage.removeItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    } catch {
      // The owner still clears its renderer-local progress state.
    }
  }
  applySubscriptionAutoRefreshState({ inProgress: false, percentage: 0 })
}

/**
 * @param {StorageEvent} event
 */
function handleSubscriptionAutoRefreshStorage(event) {
  if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_REFRESH_CANCEL_STORAGE_KEY) {
    if (event.newValue !== null) {
      cancelSubscriptionRefresh()
    }
    return
  }

  if (!process.env.IS_ELECTRON && event.key === SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY) {
    const state = getSubscriptionRefreshProgressState(event.newValue)
    applySubscriptionAutoRefreshState({
      inProgress: state !== null,
      percentage: state?.percentage ?? 0,
      tab: state?.tab ?? null
    })
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
 * @param {{inProgress: boolean, percentage: number, tab?: string | null}} state
 */
function applySubscriptionAutoRefreshState(state) {
  const wasInProgress = store.getters.getSubscriptionFeedRefreshInProgress
  const previousTab = store.getters.getSubscriptionFeedRefreshTab
  const nextTab = state.inProgress ? state.tab ?? null : null
  let percentage = normalizeSubscriptionRefreshProgress(state.percentage)

  // The refresh owner updates progress locally before the main process broadcasts
  // it to every renderer. An older broadcast can therefore arrive after a newer
  // local update, so keep progress monotonic for the duration of this refresh.
  if (state.inProgress && wasInProgress && nextTab === previousTab) {
    percentage = Math.max(store.getters.getSubscriptionFeedRefreshProgress, percentage)
  }

  store.commit('setSubscriptionFeedRefreshInProgress', state.inProgress)
  store.commit('setSubscriptionFeedRefreshTab', nextTab)
  store.commit('setSubscriptionFeedRefreshProgress', percentage)
}

/**
 * @param {number} percentage
 */
function normalizeSubscriptionRefreshProgress(percentage) {
  return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0
}

function getStoredSubscriptionRefreshProgressState() {
  try {
    return getSubscriptionRefreshProgressState(
      localStorage.getItem(SUBSCRIPTION_AUTO_REFRESH_PROGRESS_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

/**
 * @param {string | null} value
 * @returns {{percentage: number, tab?: string} | null}
 */
function getSubscriptionRefreshProgressState(value) {
  if (value === null) {
    return null
  }

  try {
    const state = JSON.parse(value)
    return {
      ...state,
      percentage: normalizeSubscriptionRefreshProgress(state.percentage)
    }
  } catch {
    return null
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

/** @type {import('vue').ComputedRef<number>} */
const uiRoundness = computed(() => store.getters.getUiRoundness)

watch(uiRoundness, updateUiRoundness)

/** @type {import('vue').ComputedRef<number>} */
const scrollbarThumbWidth = computed(() => store.getters.getScrollbarThumbWidth)

watch(scrollbarThumbWidth, updateScrollbarThumbWidth)

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)

watch(thumbnailSize, updateThumbnailListSize)

function updateTheme() {
  document.body.className = `${baseTheme.value || 'system'} main${mainColor.value || 'Red'} sec${secColor.value || 'Blue'}`
  document.body.dataset.systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function updateUiRoundness() {
  document.body.style.setProperty('--ui-roundness', String(uiRoundness.value / 100))
}

function updateScrollbarThumbWidth() {
  document.body.style.setProperty(
    '--scrollbar-thumb-width',
    `${normalizeScrollbarThumbWidth(scrollbarThumbWidth.value)}px`
  )
}

// Setting these once on the body keeps a thumbnail size change from
// re-rendering every list that shows thumbnails.
function updateThumbnailListSize() {
  for (const [property, value] of Object.entries(getThumbnailListStyles(thumbnailSize.value))) {
    document.body.style.setProperty(property, value)
  }
}

updateTheme()
updateUiRoundness()
updateScrollbarThumbWidth()
updateThumbnailListSize()

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

  const releasesUrl = 'https://api.github.com/repos/OpenTubeX/OpenTubeX/releases?per_page=100'

  try {
    const availableReleases = await fetchReleasePages(releasesUrl, fetch)
    const releases = findUpdateReleases(availableReleases, packageDetails.version)
    if (releases.length === 0) {
      return
    }

    const release = releases[0]
    const tagName = release.tag_name
    const versionNumber = tagName.replace('v', '').replace('-beta', '')

    const changelog = formatReleaseChangelog(releases)
      // Link usernames to their GitHub profiles
      .replaceAll(/@(\S+)\b/g, '[@$1](https://github.com/$1)')
      // Shorten pull request links to #1234
      .replaceAll(/https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/pull\/(\d+)/g, '[#$1]($&)')

    updateChangelog.value = releaseNotesMarkdown.parse(changelog)
    changeLogTitle.value = t('Update to {version}', { version: release.name ?? tagName })
    latestVersionNumber.value = versionNumber
    showUpdatesBanner.value = true
  } catch (error) {
    console.error('errored while checking for updates', releasesUrl, error)
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
  openExternalLink('https://opentubex.org/downloads/')
  showReleaseNotes.value = false
  showUpdatesBanner.value = false
}

/** @type {import('vue').ComputedRef<boolean>} */
const outlinesHidden = computed(() => store.getters.getOutlinesHidden)

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  const shortcuts = KeyboardShortcuts.APP.GENERAL

  if (matchesKeyboardShortcut(event, shortcuts.FIND_IN_PAGE)) {
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

  if (matchesKeyboardShortcut(event, shortcuts.SHOW_SHORTCUTS) && !isTypingTarget(event.target)) {
    event.preventDefault()
    store.dispatch(isKeyboardShortcutPromptShown.value
      ? 'hideKeyboardShortcutPrompt'
      : 'showKeyboardShortcutPrompt')
  }

  if (event.key === 'Tab' && !event.ctrlKey) {
    store.dispatch('showOutlines')
  }

  // Tab keyboard shortcuts (Electron only)
  if (process.env.IS_ELECTRON) {
    // Ctrl+1..9: Switch to tab by number
    if (matchesKeyboardShortcut(event, shortcuts.SWITCH_TO_TAB)) {
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

    // F1: Toggle between horizontal and vertical tabs
    if (matchesKeyboardShortcut(event, shortcuts.TOGGLE_TAB_ORIENTATION) && !isTypingTarget(event.target)) {
      event.preventDefault()
      toggleTabOrientation()
      return
    }

    // Ctrl+T: New tab
    if (matchesKeyboardShortcut(event, shortcuts.NEW_TAB)) {
      event.preventDefault()
      store.dispatch('createTab', { makeActive: true })
      return
    }

    // Ctrl+Shift+T: Restore closed tab
    if (matchesKeyboardShortcut(event, shortcuts.RESTORE_CLOSED_TAB)) {
      event.preventDefault()
      store.dispatch('restoreClosedTab')
      return
    }

    // Ctrl+W: Close tab (handled in menu, but also here for robustness)
    if (matchesKeyboardShortcut(event, shortcuts.CLOSE_TAB)) {
      event.preventDefault()
      closeShortcutTabs().then((hasRemainingTabs) => {
        if (!hasRemainingTabs) {
          window.close()
        }
      })
      return
    }

    // Ctrl+Tab: Next tab
    if (matchesKeyboardShortcut(event, shortcuts.NEXT_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(1)
      return
    }

    // Ctrl+Shift+Tab: Previous tab
    if (matchesKeyboardShortcut(event, shortcuts.PREV_TAB)) {
      event.preventDefault()
      cycleTabSwitcher(-1)
      return
    }

    // Ctrl+R: Reload tab (unless the current view handles refresh itself)
    if (matchesKeyboardShortcut(event, shortcuts.RELOAD_TAB)) {
      const tabIds = getShortcutTabIds()
      if (tabIds.length === 1 && route.path.startsWith('/subscriptions')) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      for (const tabId of tabIds) {
        prepareAndReloadTab(tabId)
      }
    }
  }
}

/**
 * The setting is only committed to the store once it has been persisted, so
 * consecutive presses are queued to keep every one of them from negating the
 * same stale value.
 */
let pendingTabOrientationUpdate = Promise.resolve()

function toggleTabOrientation() {
  pendingTabOrientationUpdate = pendingTabOrientationUpdate.then(() =>
    store.dispatch('updateUseVerticalTabBar', !useVerticalTabBar.value)
  )
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
  const shortcuts = KeyboardShortcuts.APP.GENERAL
  const isNextShortcut = [
    shortcuts.FIND_NEXT,
    shortcuts.FIND_NEXT_ALT,
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
  const isPreviousShortcut = [
    shortcuts.FIND_PREVIOUS,
    shortcuts.FIND_PREVIOUS_ALT,
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))

  if (!isNextShortcut && !isPreviousShortcut) {
    return false
  }

  event.preventDefault()
  findInPage(isPreviousShortcut)
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
    tabRuntimeRegistry.getRoot(presentedTabId.value) ?? document.body,
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
    window.ftElectron.tabs.setPreviewCapturePaused(true)
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
    typeof window.ftElectron?.tabs?.getCachedPreviews !== 'function'
  ) {
    return
  }

  const requestId = ++tabSwitcherPreviewRequestId
  const tabIds = tabSwitcherTabs.value.map(tab => tab.id)
  tabSwitcherPreviewPending.value = Object.fromEntries(tabIds.map(tabId => [tabId, true]))

  window.ftElectron.tabs.getCachedPreviews(tabIds).then((previews) => {
    if (requestId !== tabSwitcherPreviewRequestId || !tabSwitcherVisible.value) {
      return
    }

    tabSwitcherPreviewUrls.value = Object.fromEntries(
      Object.entries(previews).filter(([, dataUrl]) => typeof dataUrl === 'string' && dataUrl.length > 0)
    )
  }).catch(() => {}).finally(() => {
    if (requestId === tabSwitcherPreviewRequestId && tabSwitcherVisible.value) {
      tabSwitcherPreviewPending.value = {}
    }
  })
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

  // Prefer vertical scrolling when the switcher wraps into multiple rows;
  // fall back to horizontal when that is the only overflow axis.
  if (switcher.scrollHeight > switcher.clientHeight) {
    switcher.scrollTop += delta
  } else {
    switcher.scrollLeft += delta
  }
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
  tabSwitcherPreviewPending.value = {}
  tabSwitcherPointerActive.value = false
  tabSwitcherPreviewRequestId++
  window.ftElectron.tabs.setPreviewCapturePaused(false)
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

async function prepareAndReloadTab(tabId = activeTabId.value) {
  const tab = store.getters.getTabById(tabId)
  if (!tab) {
    return
  }

  if (tab.route.path.startsWith('/watch/')) {
    const timestamp = store.getters.getWatchTimestamp(tabId)
    if (typeof timestamp === 'number' && timestamp > 0) {
      navigation.prepareReload(tabId, {
        path: tab.route.path,
        query: { ...tab.route.query, oneTimeTimestamp: Math.floor(timestamp) }
      })
    }
  }
  store.dispatch('reloadTab', tabId)
}

function getShortcutTabIds() {
  const selectedTabIds = store.getters.getSelectedTabIds
  return selectedTabIds.length > 1
    ? [...selectedTabIds]
    : activeTabId.value ? [activeTabId.value] : []
}

const multipleTabsActionPrompt = ref(null)
const multipleTabsActionPromptCount = ref(0)
const MULTIPLE_TABS_ACTION_PROMPT_VALUES = ['confirm', 'cancel', 'neverAskAgain']

/** @type {((confirmed: boolean) => void) | null} */
let multipleTabsActionPromptResolve = null
/** @type {Promise<boolean> | null} */
let multipleTabsActionPromptPromise = null

const multipleTabsActionPromptTitle = computed(() => {
  if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Title')
  if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Title')
  return t('Close Multiple Tabs Confirmation.Title')
})
const multipleTabsActionPromptMessage = computed(() => {
  const parameters = { count: multipleTabsActionPromptCount.value }
  if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Message', parameters)
  if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Message', parameters)
  return t('Close Multiple Tabs Confirmation.Message', parameters)
})
const multipleTabsActionPromptNames = computed(() => [
  multipleTabsActionPrompt.value === 'load'
    ? t('Load Multiple Tabs Confirmation.Load Tabs', { count: multipleTabsActionPromptCount.value })
    : multipleTabsActionPrompt.value === 'unload'
      ? t('Unload Multiple Tabs Confirmation.Unload Tabs', { count: multipleTabsActionPromptCount.value })
      : t('Close Multiple Tabs Confirmation.Close Tabs', { count: multipleTabsActionPromptCount.value }),
  t('Cancel'),
  t('Confirmations.Never Ask Again')
])

/**
 * @param {'close' | 'load' | 'unload'} action
 */
function isMultipleTabsActionConfirmationEnabled(action) {
  if (action === 'load') return store.getters.getConfirmLoadMultipleTabs
  if (action === 'unload') return store.getters.getConfirmUnloadMultipleTabs
  return store.getters.getConfirmCloseMultipleTabs
}

/**
 * @param {'close' | 'load' | 'unload'} action
 */
function disableMultipleTabsActionConfirmation(action) {
  if (action === 'load') return store.dispatch('updateConfirmLoadMultipleTabs', false)
  if (action === 'unload') return store.dispatch('updateConfirmUnloadMultipleTabs', false)
  return store.dispatch('updateConfirmCloseMultipleTabs', false)
}

/**
 * Ask the user to confirm an action affecting several tabs at once. Concurrent
 * requests for the same action share one prompt; a different action is rejected.
 * @param {number} count
 * @param {'close' | 'load' | 'unload'} action
 * @returns {Promise<boolean>}
 */
function confirmMultipleTabsAction(count, action) {
  if (!isMultipleTabsActionConfirmationEnabled(action)) return Promise.resolve(true)

  if (multipleTabsActionPromptPromise) {
    if (multipleTabsActionPrompt.value !== action) return Promise.resolve(false)

    multipleTabsActionPromptCount.value = Math.max(multipleTabsActionPromptCount.value, count)
    return multipleTabsActionPromptPromise
  }

  multipleTabsActionPrompt.value = action
  multipleTabsActionPromptCount.value = count
  multipleTabsActionPromptPromise = new Promise(resolve => {
    multipleTabsActionPromptResolve = resolve
  })
  return multipleTabsActionPromptPromise
}

/**
 * @param {'confirm' | 'cancel' | 'neverAskAgain' | null} option
 */
async function handleMultipleTabsActionPromptAnswer(option) {
  const action = multipleTabsActionPrompt.value
  multipleTabsActionPrompt.value = null
  multipleTabsActionPromptCount.value = 0
  const resolve = multipleTabsActionPromptResolve
  multipleTabsActionPromptResolve = null
  multipleTabsActionPromptPromise = null
  if (option === 'neverAskAgain' && action != null) {
    try {
      await disableMultipleTabsActionConfirmation(action)
    } catch (error) {
      console.error('Failed to disable the bulk tab action confirmation', error)
    }
  }
  resolve?.(option === 'confirm' || option === 'neverAskAgain')
}

/**
 * @param {{ requestId: string, count: number, action: 'close' | 'load' | 'unload' }} request
 */
async function handleConfirmMultipleTabsActionRequest({ requestId, count, action }) {
  const confirmed = await confirmMultipleTabsAction(count, action)
  window.ftElectron.tabs.respondConfirmMultipleAction(requestId, confirmed)
}

async function closeShortcutTabs() {
  const tabIds = getShortcutTabIds()
  if (tabIds.length >= MULTIPLE_TABS_CONFIRM_THRESHOLD && !await confirmMultipleTabsAction(tabIds.length, 'close')) {
    return true
  }

  if (tabIds.length === 0) {
    return true
  }
  if (tabIds.length === 1) {
    return await store.dispatch('closeTab', tabIds[0])
  }

  return await store.dispatch('closeTabs', tabIds)
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
    return
  }

  // The tab rework replaced the browser's navigation history with a per-tab
  // logical history, so Chromium's native mouse back/forward buttons no longer
  // navigate anything. Route buttons 3 (back) and 4 (forward) through the tab
  // navigation service instead. auxclick fires once per click, avoiding the
  // double dispatch seen with mousedown/mouseup for these buttons.
  // The web build has no logical tabs and the browser's own history still
  // works there, so those buttons are left alone.
  if (process.env.IS_ELECTRON && (event.button === 3 || event.button === 4)) {
    event.preventDefault()

    const tabId = activeTabId.value
    if (tabId != null) {
      navigation.go(tabId, event.button === 3 ? -1 : 1)
    }
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

  // Determine if we should open in new tab or new window.
  // `process.platform` is `undefined` in the web build, where the app can be
  // opened from any OS, so both modifiers count there.
  const ctrlOrCmdPressed = process.env.IS_ELECTRON
    ? ((process.platform !== 'darwin' && event.ctrlKey) || (process.platform === 'darwin' && event.metaKey))
    : (event.ctrlKey || event.metaKey)
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
    showToast({
      message: t('External link opening has been disabled in the general settings'),
      icon: ['fas', 'link-slash'],
    })
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

async function handleYoutubeLink(href, {
  doCreateNewWindow = false,
  doCreateNewTab = false,
  isMiddleClick = false,
  tabId = null
} = {}) {
  const result = await store.dispatch('getYoutubeUrlInfo', href)
  // Middle clicks should open tabs in background (not make them active)
  const makeActive = !isMiddleClick
  const openPath = (options) => {
    if (isElectron && tabId && !options.doCreateNewWindow && !options.doCreateNewTab) {
      return navigation.push(tabId, { path: options.path, query: options.query })
    }
    return openInternalPath(options)
  }

  switch (result.urlType) {
    case 'video': {
      const { videoId, timestamp, playlistId, commentId, isShort } = result

      const query = {}
      if (isShort) {
        query.short = 'true'
      }
      if (timestamp) {
        query.timestamp = timestamp
      }
      if (playlistId && playlistId.length > 0) {
        query.playlistId = playlistId
      }
      if (commentId) {
        query.commentId = commentId
      }

      openPath({
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

      openPath({
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

      openPath({
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
      openPath({
        path: `/hashtag/${encodeURIComponent(hashtag)}`,
        doCreateNewWindow,
        doCreateNewTab,
        makeActive
      })
      break
    }

    case 'post': {
      const { postId, query } = result

      openPath({
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

      openPath({
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
      openPath({
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
      showToast({
        message: t('Unknown YouTube url type, cannot be opened in app'),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  }
}

function enableOpenUrl() {
  return window.ftElectron.handleOpenUrl((url, tabId) => {
    if (url) {
      handleYoutubeLink(url, { tabId })
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
    return translateWindowTitle(route.meta.title)
  } else {
    return null
  }
})

/** @type {import('vue').ComputedRef<string>} */
const appTitle = computed(() => {
  if (isElectron) {
    const tab = store.getters.getTabById(presentedTabId.value)
    return tab?.contentTitle ?? ''
  }
  return store.getters.getAppTitle
})

function publishAppTitle(value) {
  if (value.length > 0) {
    document.title = `${value} - ${packageDetails.productName}`
  } else {
    document.title = packageDetails.productName
  }

  if (isElectron && presentedTabId.value) {
    window.ftElectron.setWindowTitle(document.title, presentedTabId.value)
  }
}

watch(appTitle, publishAppTitle)

// Also watch the route: the title string alone can stay identical across a
// route change (e.g. '/' and '/subscriptions' share the same title), which
// would leave a tab's placeholder title in place when the route-match guard
// in setWindowTitle deferred an earlier update.
watch([windowTitle, () => route.fullPath], setWindowTitle)

function setWindowTitle() {
  if (windowTitle.value === null) {
    return
  }

  const titleTabId = store.state.tabs.transitionTargetTabId ?? presentedTabId.value
  if (isElectron && titleTabId) {
    // During startup the shared router briefly sits on its initial route while
    // the restored tab's own route hasn't been projected yet. Only attribute
    // the router's title to the tab when it is actually on this route.
    const tab = store.getters.getTabById(titleTabId)
    if (tab && tab.route.fullPath !== route.fullPath) {
      return
    }
    navigation.setTitle(titleTabId, windowTitle.value)
  } else {
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
