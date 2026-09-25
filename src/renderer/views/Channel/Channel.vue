<template>
  <div>
    <FtLoader
      v-if="isLoading && !errorMessage"
      :fullscreen="true"
    />
    <ChannelDetails
      v-else-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      :id="id"
      :name="channelName"
      :banner-url="bannerUrl"
      :has-error-message="!!errorMessage"
      :thumbnail-url="thumbnailUrl"
      :sub-count="subCount"
      :show-share-menu="showShareMenu"
      :show-search-bar="showSearchBar"
      :is-subscribed="isSubscribed"
      :visible-tabs="tabInfoValues"
      :current-tab="currentTab"
      :query="lastSearchQuery"
      class="card channelDetails"
      @change-tab="handleTabChange"
      @search="newSearchWithStatePersist"
      @subscribed="handleSubscription"
    />
    <FtCard
      v-if="!isLoading && !errorMessage && (isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="card"
    >
      <ChannelAbout
        v-if="currentTab === 'about'"
        id="aboutPanel"
        role="tabpanel"
        aria-labelledby="aboutTab"
        :description="description"
        :joined="joined"
        :views="viewCount"
        :videos="videoCount"
        :location="location"
        :tags="tags"
        :related-channels="relatedChannels"
      />
      <div class="select-container">
        <FtButton
          v-if="showViewAllButton"
          theme="channel-view-all"
          :label="$t('Channel.View All')"
          :icon="['fas', 'arrow-right']"
          @click="router.push(currentTabViewAllRoute)"
        />
        <FtSelect
          v-if="showVideoSortBy"
          v-show="currentTab === 'videos' && (showFetchMoreButton || filteredVideos.length > 1)"
          :value="videoSortBy"
          :select-names="videoLiveShortSelectNames"
          :select-values="videoLiveShortSelectValues"
          :placeholder="$t('Global.Sort By')"
          :icon="getIconForSortPreference(videoSortBy)"
          @change="videoSortBy = $event"
        />
        <FtSelect
          v-if="!hideChannelShorts && showShortSortBy"
          v-show="currentTab === 'shorts' && (showFetchMoreButton || filteredShorts.length > 1)"
          :value="shortSortBy"
          :select-names="videoLiveShortSelectNames"
          :select-values="videoLiveShortSelectValues"
          :placeholder="$t('Global.Sort By')"
          :icon="getIconForSortPreference(shortSortBy)"
          @change="shortSortBy = $event"
        />
        <FtSelect
          v-if="showLiveSortBy"
          v-show="currentTab === 'live' && (showFetchMoreButton || filteredLive.length > 1)"
          :value="liveSortBy"
          :select-names="videoLiveShortSelectNames"
          :select-values="videoLiveShortSelectValues"
          :placeholder="$t('Global.Sort By')"
          :icon="getIconForSortPreference(liveSortBy)"
          @change="liveSortBy = $event"
        />
        <FtSelect
          v-if="!hideChannelPlaylists && showPlaylistSortBy"
          v-show="currentTab === 'playlists' && latestPlaylists.length > 0"
          :value="playlistSortBy"
          :select-names="playlistSelectNames"
          :select-values="PLAYLIST_SELECT_VALUES"
          :placeholder="$t('Global.Sort By')"
          :icon="getIconForSortPreference(playlistSortBy)"
          @change="playlistSortBy = $event"
        />
      </div>
      <div
        v-if="currentTab === 'search'"
        class="channelSearchFilters"
        role="group"
        :aria-label="$t('Channel.Search Result Types')"
      >
        <button
          v-for="filter in availableChannelSearchFilters"
          :key="filter.value"
          type="button"
          class="channelSearchFilter"
          :class="{ selected: channelSearchFilter === filter.value }"
          :aria-pressed="channelSearchFilter === filter.value"
          @click="channelSearchFilter = filter.value"
        >
          {{ filter.label }}
        </button>
      </div>
      <FtLoader
        v-if="isCurrentTabLoading"
      />
      <div
        v-if="currentTab !== 'about' && !isElementListLoading"
        class="elementList"
      >
        <ChannelHome
          v-show="currentTab === 'home'"
          id="homePanel"
          :shelves="homeData"
          role="tabpanel"
          aria-labelledby="homeTab"
        />
        <FtElementList
          v-if="currentTab === 'videos'"
          id="videoPanel"
          appear
          :data="filteredVideos"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="videosTab"
        />
        <FtFlexBox
          v-if="currentTab === 'videos' && latestVideos.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Videos.This channel does not currently have any videos") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelShorts && currentTab === 'shorts'"
          id="shortPanel"
          :data="filteredShorts"
          :use-channels-hidden-preference="false"
          :youtube-style-shorts="useCustomShortsPlayer"
          role="tabpanel"
          aria-labelledby="shortsTab"
        />
        <FtFlexBox
          v-if="!hideChannelShorts && currentTab === 'shorts' && latestShorts.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Shorts.This channel does not currently have any shorts") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="currentTab === 'live'"
          id="livePanel"
          appear
          :data="filteredLive"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="liveTab"
        />
        <FtFlexBox
          v-if="currentTab === 'live' && filteredLive.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Live.This channel does not currently have any live streams") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelPodcasts && currentTab === 'podcasts'"
          id="podcastPanel"
          :data="latestPodcasts"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="podcastsTab"
        />
        <FtFlexBox
          v-if="!hideChannelPodcasts && currentTab === 'podcasts' && latestPodcasts.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Podcasts.This channel does not currently have any podcasts") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelReleases && currentTab === 'releases'"
          id="releasePanel"
          :data="latestReleases"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="releasesTab"
        />
        <FtFlexBox
          v-if="!hideChannelReleases && currentTab === 'releases' && latestReleases.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Releases.This channel does not currently have any releases") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelCourses && currentTab === 'courses'"
          id="coursesPanel"
          :data="latestCourses"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="coursesTab"
        />
        <FtFlexBox
          v-if="!hideChannelCourses && currentTab === 'courses' && latestCourses.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Courses.This channel does not currently have any courses") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelPlaylists && currentTab === 'playlists'"
          id="playlistPanel"
          :data="latestPlaylists"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="playlistsTab"
        />
        <FtFlexBox
          v-if="!hideChannelPlaylists && currentTab === 'playlists' && latestPlaylists.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Playlists.This channel does not currently have any playlists") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-if="!hideChannelCommunity && currentTab === 'community'"
          id="communityPanel"
          class="communityPanel"
          :data="latestCommunityPosts"
          :use-channels-hidden-preference="false"
          role="tabpanel"
          aria-labelledby="communityTab"
          display="list"
        />
        <FtFlexBox
          v-if="!hideChannelCommunity && currentTab === 'community' && latestCommunityPosts.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Posts.This channel currently does not have any posts") }}
          </p>
        </FtFlexBox>
        <FtElementList
          v-show="currentTab === 'search'"
          class="channelSearchResults"
          :data="filteredSearchResults"
          :use-channels-hidden-preference="false"
        />
        <FtFlexBox
          v-if="currentTab === 'search' && !isSearchTabLoading && filteredSearchResults.length === 0"
        >
          <p class="message">
            {{ $t("Channel.Your search results have returned 0 results") }}
          </p>
        </FtFlexBox>
        <FtAutoLoadNextPageWrapper
          v-if="showFetchMoreButton && !isFetchMoreLoading"
          @load-next-page="handleFetchMore"
        >
          <div
            class="getNextPage"
            role="button"
            tabindex="0"
            @click="handleFetchMore"
            @keydown.enter.space.prevent="handleFetchMore"
          >
            <FtIcon :icon="['fas', 'search']" /> {{ $t("Search Filters.Fetch more results") }}
          </div>
        </FtAutoLoadNextPageWrapper>
      </div>
    </FtCard>
    <FtCard
      v-if="errorMessage"
      class="card"
    >
      <p>
        {{ errorMessage }}
      </p>
    </FtCard>
    <FtAgeRestricted
      v-else-if="!isLoading && (!isFamilyFriendly && showFamilyFriendlyOnly)"
      class="ageRestricted"
      :is-channel="true"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import autolinker from 'autolinker'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'
import { YTNodes } from 'youtubei.js'

import ChannelAbout from '../../components/ChannelAbout/ChannelAbout.vue'
import ChannelDetails from '../../components/ChannelDetails/ChannelDetails.vue'
import ChannelHome from '../../components/ChannelHome/ChannelHome.vue'
import FtAgeRestricted from '../../components/FtAgeRestricted/FtAgeRestricted.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtButton from '../../components/FtButton/FtButton.vue'

import store from '../../store/index'
import { contentApi } from '../../helpers/api/contentApi'
import { channelContentApi } from '../../helpers/api/channelContentApi'

import {
  extractNumberFromString,
  getChannelPlaylistId,
  getIconForSortPreference,
  removeFromArrayIfExists,
  showApiErrorToast,
  showToast,
} from '../../helpers/utils'
import { isNullOrEmpty } from '../../helpers/strings'
import {
  parseLocalChannelHeader,
  parseLocalSubscriberCount,
  parseChannelHomeTab
} from '../../helpers/api/local'
import { useTabAvatar, useTabContext, useTabTitle } from '../../tabs/TabContext'
import { setChannelShortsNavigationContext } from '../../helpers/player/shorts'
import {
  CHANNEL_SEARCH_FILTERS,
  filterChannelSearchResults,
} from './channel-search'

const { locale, t } = useI18n()
const route = useRoute()
const router = useRouter()
const setTabTitle = useTabTitle()
const setTabAvatar = useTabAvatar()
const { isTabPresented } = useTabContext()

let skipRouteChangeWatcherOnce = false
let pendingTabRoute = null
let isReplacingTabRoute = false
let channelRouteGeneration = 0
let autoRefreshOnSortByChangeEnabled = false
/** @type {import('youtubei.js').YT.Channel|null} */
let channelInstance = null
/** @type {'local' | 'invidious' | ''} */
let apiUsed = ''
let mayContainContentFromOtherChannels = false

const isLoading = ref(true)
const elementListLoadingTabs = ref({})
const elementListRequestIds = {}
const isSearchTabLoading = ref(false)
const isFetchMoreLoading = ref(false)
const currentTab = ref('videos')
const isElementListLoading = computed(() => !!elementListLoadingTabs.value[currentTab.value])

function setElementListLoading(tab, loading) {
  elementListLoadingTabs.value[tab] = loading
}

function startElementListRequest(tab) {
  elementListRequestIds[tab] = (elementListRequestIds[tab] || 0) + 1
  return currentElementListRequest(tab)
}

function currentElementListRequest(tab) {
  const requestId = elementListRequestIds[tab]
  const routeGeneration = channelRouteGeneration
  const channelId = id.value
  return () => requestId === elementListRequestIds[tab] &&
    routeGeneration === channelRouteGeneration && channelId === id.value
}

const isCurrentTabLoading = computed(() => {
  return currentTab.value === 'search' ? isSearchTabLoading.value : isElementListLoading.value
})

const id = ref('')
const channelName = ref('')
const bannerUrl = ref('')
const thumbnailUrl = ref('')
const subCount = ref(0)
const description = ref('')
const tags = shallowRef([])
const viewCount = ref(0)
const videoCount = ref(0)
const joined = ref(0)
const location = ref(null)
const relatedChannels = shallowRef([])
const isArtistTopicChannel = ref(false)
const isFamilyFriendly = ref(false)

// Publish the resolved name or its fallback only after channel loading finishes.
// This keeps a late tab-mount or route projection from restoring the route placeholder.
watch([channelName, isLoading, locale], ([name, loading]) => {
  if (!loading) {
    setTabTitle(name || t('Channel.Channel Name Unavailable'))
  }
})

// Cache the resolved profile picture so tab previews can fall back to it when no
// screenshot has been captured for this channel's tab yet.
watch(thumbnailUrl, (thumbnail) => {
  if (id.value && thumbnail) {
    store.commit('setChannelThumbnail', { channelId: id.value, thumbnail })
    setTabAvatar(thumbnail)
  }
})

const errorMessage = ref('')
const showSearchBar = ref(true)
const showShareMenu = ref(true)

const PLAYLIST_SELECT_VALUES = ['newest', 'last']
const playlistSelectNames = computed(() => [
  t('Channel.Playlists.Sort Types.Newest'),
  t('Channel.Playlists.Sort Types.Last Video Added')
])

const videoLiveShortSelectValues = computed(() => {
  return isArtistTopicChannel.value
    ? ['newest', 'popular']
    : ['newest', 'popular', 'oldest']
})

const videoLiveShortSelectNames = computed(() => {
  if (isArtistTopicChannel.value) {
    return [
      t('Channel.Videos.Sort Types.Newest'),
      t('Channel.Videos.Sort Types.Most Popular'),
    ]
  }

  return [
    t('Channel.Videos.Sort Types.Newest'),
    t('Channel.Videos.Sort Types.Most Popular'),
    t('Channel.Videos.Sort Types.Oldest')
  ]
})

const SUPPORTED_CHANNEL_TABS = [
  'home',
  'videos',
  'shorts',
  'live',
  'releases',
  'podcasts',
  'courses',
  'playlists',
  'community',
  'about'
]

const channelTabs = shallowRef([
  'videos',
  'shorts',
  'live',
  'releases',
  'podcasts',
  'courses',
  'playlists',
  'community',
  'about'
])

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<boolean>} */
const showFamilyFriendlyOnly = computed(() => store.getters.getShowFamilyFriendlyOnly)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

const activeProfile = computed(() => store.getters.getActiveProfile)

const subscriptionInfo = computed(() => {
  return activeProfile.value.subscriptions.find((channel) => {
    return channel.id === id.value
  }) ?? null
})

const isSubscribed = computed(() => subscriptionInfo.value !== null)

/** @type {import('vue').ComputedRef<boolean>} */
const isSubscribedInAnyProfile = computed(() => {
  return store.getters.getSubscribedChannelIdSet.has(id.value)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelHome = computed(() => store.getters.getHideChannelHome)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelShorts = computed(() => store.getters.getHideChannelShorts)

/** @type {import('vue').ComputedRef<boolean>} */
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)

/** @type {import('vue').ComputedRef<boolean>} */
const hideLiveStreams = computed(() => store.getters.getHideLiveStreams)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelPodcasts = computed(() => store.getters.getHideChannelPodcasts)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelReleases = computed(() => store.getters.getHideChannelReleases)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelCourses = computed(() => store.getters.getHideChannelCourses)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelPlaylists = computed(() => store.getters.getHideChannelPlaylists)

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelCommunity = computed(() => store.getters.getHideChannelCommunity)

/** @type {import('vue').ComputedRef<boolean>} */
const hideWatchedSubs = computed(() => store.getters.getHideWatchedSubs)

/**
 * @param {{
 *  liveNow?: boolean,
 *  isUpcoming?: boolean,
 * }} video
 */
function shouldHideLiveStreamVideo(video) {
  return hideLiveStreams.value && (video.liveNow || video.isUpcoming)
}

const tabInfoValues = computed(() => {
  const values = [...channelTabs.value]

  // remove tabs from the array based on user settings
  if (hideChannelHome.value || !homeData.value || homeData.value.length === 0) {
    removeFromArrayIfExists(values, 'home')
  }

  if (hideChannelShorts.value) {
    removeFromArrayIfExists(values, 'shorts')
  }

  if (hideChannelPlaylists.value) {
    removeFromArrayIfExists(values, 'playlists')
  }

  if (hideChannelCommunity.value) {
    removeFromArrayIfExists(values, 'community')
  }

  if (hideChannelPodcasts.value) {
    removeFromArrayIfExists(values, 'podcasts')
  }

  if (hideChannelReleases.value) {
    removeFromArrayIfExists(values, 'releases')
  }

  if (hideChannelCourses.value) {
    removeFromArrayIfExists(values, 'courses')
  }

  return values
})

const showViewAllButton = computed(() => {
  switch (currentTab.value) {
    case 'videos': return (videoSortBy.value === 'newest' || videoSortBy.value === 'popular') && (showFetchMoreButton.value || filteredVideos.value.length > 1)
    case 'shorts': return (shortSortBy.value === 'newest' || shortSortBy.value === 'popular') && (showFetchMoreButton.value || filteredShorts.value.length > 1)
    case 'live': return (liveSortBy.value === 'newest' || liveSortBy.value === 'popular') && (showFetchMoreButton.value || filteredLive.value.length > 1)
    default: return false
  }
})

const currentTabViewAllRoute = computed(() => {
  switch (currentTab.value) {
    case 'videos': return `/playlist/${getChannelPlaylistId(id.value, 'videos', videoSortBy.value)}`
    case 'shorts': return `/playlist/${getChannelPlaylistId(id.value, 'shorts', shortSortBy.value)}`
    case 'live': return `/playlist/${getChannelPlaylistId(id.value, 'live', liveSortBy.value)}`
    default: return ''
  }
})

watch(route, () => {
  if (skipRouteChangeWatcherOnce) {
    skipRouteChangeWatcherOnce = false
    return
  }
  channelRouteGeneration += 1
  isLoading.value = true

  if (route.query.url) {
    resolveChannelUrl(route.query.url, route.params.currentTab)
    return
  }

  // Disable auto refresh on sort value change during state reset
  autoRefreshOnSortByChangeEnabled = false

  id.value = route.params.id
  elementListLoadingTabs.value = {}
  relatedChannels.value = []
  latestVideos.value = []
  latestShorts.value = []
  latestLive.value = []
  videoSortBy.value = 'newest'
  shortSortBy.value = 'newest'
  liveSortBy.value = 'newest'
  playlistSortBy.value = 'newest'
  latestPlaylists.value = []
  latestPodcasts.value = []
  latestReleases.value = []
  latestCommunityPosts.value = []
  searchResults.value = []
  apiUsed = ''
  channelInstance = null
  mayContainContentFromOtherChannels = false
  isArtistTopicChannel.value = false
  videoContinuationData.value = null
  shortContinuationData.value = null
  liveContinuationData.value = null
  playlistContinuationData.value = null
  podcastContinuationData.value = null
  releaseContinuationData.value = null
  searchContinuationData.value = null
  communityContinuationData.value = null
  showSearchBar.value = true
  showVideoSortBy.value = true
  showShortSortBy.value = true
  showLiveSortBy.value = true
  showPlaylistSortBy.value = true

  currentTab.value = currentOrFirstTab(route.params.currentTab)

  if (id.value === '@@@') {
    showShareMenu.value = false
    setErrorMessage(t('Channel.This channel does not exist'))
    return
  }

  showShareMenu.value = true
  errorMessage.value = ''

  // Re-enable auto refresh on sort value change AFTER update done
  loadChannelOverview().finally(() => {
    autoRefreshOnSortByChangeEnabled = true
  })
}, { deep: true })

onMounted(async () => {
  document.addEventListener('keydown', handlePanelTabNavigation)

  if (route.query.url) {
    await resolveChannelUrl(route.query.url, route.params.currentTab)
    return
  }

  id.value = route.params.id

  currentTab.value = currentOrFirstTab(route.params.currentTab)

  if (id.value === '@@@') {
    showShareMenu.value = false
    setErrorMessage(t('Channel.This channel does not exist'))
    return
  }

  // Enable auto refresh on sort value change AFTER initial update done
  await loadChannelOverview().finally(() => {
    autoRefreshOnSortByChangeEnabled = true
  })

  const oldQuery = route.query.searchQueryText ?? ''
  if (oldQuery !== '') {
    newSearch(oldQuery)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handlePanelTabNavigation)
})

/**
 * @param {string} url
 * @param {string|undefined} tab
 */
async function resolveChannelUrl(url, tab = undefined) {
  let id = await channelContentApi.getId(url, backendPreference.value)

  if (id === null) {
    // the channel page shows an error about the channel not existing when the id is @@@
    id = '@@@'
  }

  // use router.replace to replace the current history entry
  // with the one with the resolved channel id
  // that way if you navigate back or forward in the history to this entry
  // we don't need to resolve the URL again as we already know it
  if (tab) {
    router.replace({ path: `/channel/${id}/${tab}` })
  } else {
    router.replace({ path: `/channel/${id}` })
  }
}

/**
 * @param {string} currentTab
 */
function currentOrFirstTab(currentTab) {
  return tabInfoValues.value.includes(currentTab) ? currentTab : tabInfoValues.value[0]
}

async function ensureChannelInstance() {
  if (!channelInstance) {
    channelInstance = await channelContentApi.getInfo(id.value, 'local')
  }
}

/** @param {'local' | 'invidious'} [failedProvider] */
async function loadChannelOverview(failedProvider) {
  return channelContentApi.loadOverview({
    preference: backendPreference.value,
    fallback: backendFallback.value,
    failedProvider,
    loadLocal: getChannelLocal,
    loadInvidious: getChannelInfoInvidious,
    onFallback: (_from, to) => {
      const message = to === 'local'
        ? t('Falling back to Local API')
        : t('Falling back to Invidious API')
      showToast({ message, icon: ['fas', 'exchange-alt'] })
    },
    onNoProvider: () => { isLoading.value = false },
  })
}

async function getChannelLocal() {
  apiUsed = 'local'
  isLoading.value = true
  const expectedId = id.value

  try {
    await ensureChannelInstance()

    // Bail out if the channel changed while we were resolving this instance, so a
    // delayed response can't update the tab title (including the age-gate branch).
    if (expectedId !== id.value) {
      return
    }

    let channelName_
    let channelThumbnailUrl

    if (channelInstance.alert) {
      setErrorMessage(channelInstance.alert)
      return
    } else if (channelInstance.memo.has('ChannelAgeGate')) {
      /** @type {import('youtubei.js').YTNodes.ChannelAgeGate} */
      const ageGate = channelInstance.memo.get('ChannelAgeGate')[0]

      channelName_ = ageGate.channel_title
      channelThumbnailUrl = ageGate.avatar[0].url

      channelName.value = channelName_
      thumbnailUrl.value = channelThumbnailUrl

      store.dispatch('updateSubscriptionDetails', { channelThumbnailUrl, channelName: channelName_, channelId: id.value })

      setErrorMessage(t('Channel["This channel is age-restricted and currently cannot be viewed in OpenTubeX."]'), true)
      return
    }

    errorMessage.value = ''

    const parsedHeader = parseLocalChannelHeader(channelInstance)

    const channelId = parsedHeader.id ?? id.value
    const subscriberText = parsedHeader.subscriberText ?? null
    let tags_ = parsedHeader.tags

    channelThumbnailUrl = parsedHeader.thumbnailUrl ?? subscriptionInfo.value?.thumbnail
    channelName_ = parsedHeader.name ?? subscriptionInfo.value?.name

    if (channelThumbnailUrl?.startsWith('//')) {
      channelThumbnailUrl = `https:${channelThumbnailUrl}`
    }

    channelName.value = channelName_
    thumbnailUrl.value = channelThumbnailUrl
    bannerUrl.value = parsedHeader.bannerUrl ?? null
    isFamilyFriendly.value = !!channelInstance.metadata.is_family_safe
    isArtistTopicChannel.value = channelName_.endsWith('- Topic') && !!channelInstance.metadata.music_artist_name

    mayContainContentFromOtherChannels = isArtistTopicChannel.value ||
      !!channelInstance.header?.is(YTNodes.CarouselHeader, YTNodes.InteractiveTabbedHeader) ||
      !!(channelInstance.header?.is(YTNodes.PageHeader) && channelInstance.header.content?.animated_image)

    if (channelInstance.metadata.tags) {
      tags_.push(...channelInstance.metadata.tags)
    }

    // deduplicate tags
    // a Set can only ever contain unique elements,
    // so this is an easy way to get rid of duplicates
    if (tags_.length > 0) {
      tags_ = Array.from(new Set(tags_))
    }
    tags.value = tags_

    if (subscriberText) {
      const subCount_ = parseLocalSubscriberCount(subscriberText)

      if (isNaN(subCount_)) {
        subCount.value = null
      } else {
        subCount.value = subCount_
      }
    } else {
      subCount.value = null
    }

    store.dispatch('updateSubscriptionDetails', { channelThumbnailUrl, channelName: channelName_, channelId })

    if (channelInstance.has_about) {
      getChannelAboutLocal()
    } else {
      description.value = ''
      viewCount.value = null
      videoCount.value = null
      joined.value = 0
      location.value = null
    }
    const tabs = ['about']

    // we'll count it as home page if it's not video. This will help us support some special channels
    if ((channelInstance.has_home || channelInstance.tabs[0] !== 'Videos')) {
      if (!hideChannelHome.value) {
        tabs.push('home')
      }
      // we still parse the home page so we can set related channels
      getChannelHomeLocal()
    }

    if (channelInstance.has_videos || isArtistTopicChannel.value) {
      tabs.push('videos')
      getChannelVideosLocal()
    }

    if (!hideChannelShorts.value && channelInstance.has_shorts) {
      tabs.push('shorts')
      getChannelShortsLocal()
    }

    if (channelInstance.has_live_streams) {
      tabs.push('live')
      getChannelLiveLocal()
    }

    if (!hideChannelPodcasts.value && channelInstance.has_podcasts) {
      tabs.push('podcasts')
      getChannelPodcastsLocal()
    }

    if (!hideChannelReleases.value && (channelInstance.has_releases || isArtistTopicChannel.value)) {
      tabs.push('releases')
      getChannelReleasesLocal()
    }

    if (!hideChannelCourses.value && channelInstance.has_courses) {
      tabs.push('courses')
      getChannelCoursesLocal()
    }

    if (!hideChannelPlaylists.value) {
      if (channelInstance.has_playlists) {
        tabs.push('playlists')
        getChannelPlaylistsLocal()
      }
    }

    if (!hideChannelCommunity.value && channelInstance.has_community) {
      tabs.push('community')
      getCommunityPostsLocal()
    }

    channelTabs.value = SUPPORTED_CHANNEL_TABS.filter(tab => {
      return tabs.includes(tab)
    })

    currentTab.value = currentOrFirstTab(route.params.currentTab)
    showSearchBar.value = channelInstance.has_search

    isLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    return loadChannelOverview('local')
  }
}

async function getChannelAboutLocal() {
  try {
    await ensureChannelInstance()
    const about = await channelInstance.getAbout()

    if (about.is(YTNodes.ChannelAboutFullMetadata)) {
      description.value = about.description.isEmpty() ? '' : autolinker.link(about.description.text)

      const viewCount_ = extractNumberFromString(about.view_count.text)
      viewCount.value = isNaN(viewCount_) ? null : viewCount_

      videoCount.value = null

      joined.value = about.joined_date.isEmpty() ? 0 : Date.parse(about.joined_date.text.replace('Joined').trim())

      location.value = about.country.isEmpty() ? null : about.country.text
    } else {
      description.value = about.metadata.description ? autolinker.link(about.metadata.description) : ''

      const viewCount_ = extractNumberFromString(about.metadata.view_count)
      viewCount.value = isNaN(viewCount_) ? null : viewCount_

      const videoCount_ = extractNumberFromString(about.metadata.video_count)
      videoCount.value = isNaN(videoCount_) ? null : videoCount_

      joined.value = about.metadata.joined_date && !about.metadata.joined_date.isEmpty() ? Date.parse(about.metadata.joined_date.text.replace('Joined').trim()) : 0

      location.value = about.metadata.country ?? null
    }
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    loadChannelOverview('local')
  }
}

const homeData = shallowRef([])

function getChannelHomeLocal() {
  setElementListLoading('home', true)
  const expectedId = id.value

  try {
    const homeTab = channelInstance //  await channel.getHome()

    if (expectedId !== id.value) {
      return
    }

    let homeData_

    if (mayContainContentFromOtherChannels) {
      homeData_ = parseChannelHomeTab(homeTab)
    } else {
      homeData_ = parseChannelHomeTab(homeTab, id.value, channelName.value)
    }

    const homeShorts = []
    homeData_ = homeData_.map(shelf => ({
      ...shelf,
      content: shelf.content.map(item => {
        if (!item.isShort) {
          return item
        }

        const short = {
          ...item,
          shortSource: 'channel',
          shortChannelId: id.value,
        }
        homeShorts.push(short)
        return short
      })
    }))
    if (homeShorts.length > 0 && latestShorts.value.length === 0) {
      setChannelShortsNavigationContext(id.value, homeShorts)
    }

    if (!hideChannelHome.value) {
      homeData.value = homeData_
    }

    // parse related channels from home page data
    const relatedChannels_ = []
    /** @type {Set<string>} */
    const knownChannelIds = new Set()

    for (const shelf of homeData_) {
      for (const item of shelf.content) {
        if (item.type === 'channel' && !knownChannelIds.has(item.id)) {
          knownChannelIds.add(item)
          relatedChannels_.push({
            name: item.name,
            id: item.id,
            thumbnailUrl: item.thumbnail
          })
        }
      }
    }
    relatedChannels.value = relatedChannels_

    setElementListLoading('home', false)
  } catch (err) {
    setElementListLoading('home', false)
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function getChannelInfoInvidious() {
  isLoading.value = true
  apiUsed = 'invidious'
  channelInstance = null

  const expectedId = id.value
  try {
    const response = await channelContentApi.getInfo(id.value, 'invidious')

    if (expectedId !== id.value) {
      return
    }

    const channelName_ = response.author
    const channelId = response.authorId
    channelName.value = channelName_
    id.value = channelId
    isFamilyFriendly.value = response.isFamilyFriendly
    subCount.value = response.subCount
    const thumbnail = response.authorThumbnails.at(-1)?.url ?? null
    thumbnailUrl.value = channelContentApi.mapImage(thumbnail, currentInvidiousInstanceUrl.value)
    store.dispatch('updateSubscriptionDetails', { channelThumbnailUrl: thumbnail, channelName: channelName_, channelId })
    description.value = autolinker.link(response.description)
    viewCount.value = response.totalViews
    videoCount.value = null
    joined.value = response.joined * 1000
    relatedChannels.value = response.relatedChannels.map((channel) => {
      const thumbnailUrl = channel.authorThumbnails.at(-1)?.url ?? null

      return {
        name: channel.author,
        id: channel.authorId,
        thumbnailUrl: channelContentApi.mapImage(thumbnailUrl, currentInvidiousInstanceUrl.value)
      }
    })

    if (Array.isArray(response.authorBanners) && response.authorBanners.length > 0) {
      bannerUrl.value = channelContentApi.mapImage(response.authorBanners[0].url, currentInvidiousInstanceUrl.value)
    } else {
      bannerUrl.value = null
    }

    errorMessage.value = ''

    // some channels only have a few tabs
    // here are all possible values: home, videos, shorts, streams, playlists, community, channels, about

    channelTabs.value = SUPPORTED_CHANNEL_TABS.filter(tab => {
      return response.tabs.includes(tab) && tab !== 'home'
    })

    currentTab.value = currentOrFirstTab(route.params.currentTab)

    if (response.tabs.includes('videos')) {
      channelInvidiousVideos()
    }

    if (!hideChannelShorts.value && response.tabs.includes('shorts')) {
      channelInvidiousShorts()
    }

    if (response.tabs.includes('live')) {
      channelInvidiousLive()
    }

    if (!hideChannelPodcasts.value && response.tabs.includes('podcasts')) {
      channelInvidiousPodcasts()
    }

    if (!hideChannelReleases.value && response.tabs.includes('releases')) {
      channelInvidiousReleases()
    }

    if (!hideChannelCourses.value && response.tabs.includes('courses')) {
      channelInvidiousCourses()
    }

    if (!hideChannelPlaylists.value && response.tabs.includes('playlists')) {
      getPlaylistsInvidious()
    }

    if (!hideChannelCommunity.value && response.tabs.includes('community')) {
      getCommunityPostsInvidious()
    }

    isLoading.value = false
  } catch (err) {
    setErrorMessage(err)
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    return loadChannelOverview('invidious')
  }
}

const latestVideos = shallowRef([])
const videoContinuationData = shallowRef(null)
const showVideoSortBy = ref(true)
const videoSortBy = ref('newest')

const filteredVideos = computed(() => {
  if (hideWatchedSubs.value) {
    return filterWatchedArray(latestVideos.value)
  } else {
    return latestVideos.value
  }
})

const filteredShorts = computed(() => {
  let shorts
  if (hideWatchedSubs.value) {
    shorts = filterWatchedArray(latestShorts.value)
  } else {
    shorts = latestShorts.value
  }

  return shorts.map(video => ({
    ...video,
    shortSource: 'channel',
    shortChannelId: id.value,
  }))
})

const filteredLive = computed(() => {
  let videos = latestLive.value

  if (hideWatchedSubs.value) {
    videos = filterWatchedArray(videos)
  }

  if (hideLiveStreams.value) {
    videos = videos.filter(video => !shouldHideLiveStreamVideo(video))
  }

  return videos
})

watch(videoSortBy, () => {
  if (!autoRefreshOnSortByChangeEnabled) { return }

  setElementListLoading('videos', true)
  latestVideos.value = []
  videoContinuationData.value = null

  if (apiUsed === 'local') {
    getChannelVideosLocal()
  } else {
    channelInvidiousVideos(true)
  }
})

async function getChannelVideosLocal() {
  const isCurrentRequest = startElementListRequest('videos')
  setElementListLoading('videos', true)

  try {
    if (!isArtistTopicChannel.value) {
      await ensureChannelInstance()
      if (!isCurrentRequest()) return
    }

    const result = await contentApi.getChannelVideosPage({
      id: id.value,
      channelName: channelName.value,
      provider: 'local',
      channel: channelInstance,
      artistTopic: isArtistTopicChannel.value,
      sort: videoSortBy.value,
      sortValues: videoLiveShortSelectValues.value,
      isCurrent: isCurrentRequest,
    })
    if (!result || !isCurrentRequest()) return

    latestVideos.value = result.videos
    videoContinuationData.value = result.cursor
    if (result.canSort !== null) showVideoSortBy.value = result.canSort
    setElementListLoading('videos', false)

    if (isSubscribedInAnyProfile.value && latestVideos.value.length > 0 && videoSortBy.value === 'newest') {
      store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId: id.value,
        videos: latestVideos.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('videos', false)
    if (isArtistTopicChannel.value && err.message === 'The playlist does not exist.') return

    console.error(err)
    showApiErrorToast(t('Local API Error (Click to copy)'), err)
    loadChannelOverview('local')
  }
}

async function getChannelVideosLocalMore() {
  const isCurrentRequest = currentElementListRequest('videos')
  try {
    const result = await contentApi.getChannelVideosPage({
      id: id.value,
      channelName: channelName.value,
      provider: 'local',
      channel: channelInstance,
      artistTopic: isArtistTopicChannel.value,
      sort: videoSortBy.value,
      cursor: videoContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!result || !isCurrentRequest()) return
    latestVideos.value = latestVideos.value.concat(result.videos)
    videoContinuationData.value = result.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    showApiErrorToast(t('Local API Error (Click to copy)'), err)
  }
}

/**
 * @param {boolean} sortByChanged
 */
async function channelInvidiousVideos(sortByChanged = false) {
  const isCurrentRequest = startElementListRequest('videos')
  if (sortByChanged) videoContinuationData.value = null

  const more = videoContinuationData.value !== null
  if (!more) setElementListLoading('videos', true)

  try {
    const result = await contentApi.getChannelVideosPage({
      id: id.value,
      provider: 'invidious',
      sort: videoSortBy.value,
      cursor: videoContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!result || !isCurrentRequest()) return
    latestVideos.value = more
      ? latestVideos.value.concat(result.videos)
      : result.videos
    videoContinuationData.value = result.cursor
    setElementListLoading('videos', false)

    if (isSubscribedInAnyProfile.value && !more && latestVideos.value.length > 0 && videoSortBy.value === 'newest') {
      store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId: id.value,
        videos: latestVideos.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('videos', false)
    console.error(err)
    showApiErrorToast(t('Invidious API Error (Click to copy)'), err)
  }
}

const latestShorts = shallowRef([])
const shortContinuationData = shallowRef(null)
const showShortSortBy = ref(true)
const shortSortBy = ref('newest')

watch(filteredShorts, shorts => {
  setChannelShortsNavigationContext(id.value, shorts)
}, { immediate: true })

watch(shortSortBy, () => {
  if (!autoRefreshOnSortByChangeEnabled) { return }

  setElementListLoading('shorts', true)
  latestShorts.value = []
  shortContinuationData.value = null

  if (apiUsed === 'local') {
    getChannelShortsLocal()
  } else {
    channelInvidiousShorts(true)
  }
})

async function getChannelShortsLocal() {
  const isCurrentRequest = startElementListRequest('shorts')
  setElementListLoading('shorts', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return

    const page = await channelContentApi.getPage({
      section: 'shorts',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: shortSortBy.value,
      sortValues: videoLiveShortSelectValues.value,
      mayContainOtherChannels: mayContainContentFromOtherChannels,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestShorts.value = page.items
    shortContinuationData.value = page.cursor
    showShortSortBy.value = page.canSort
    setElementListLoading('shorts', false)

    if (isSubscribedInAnyProfile.value && latestShorts.value.length > 0 && shortSortBy.value === 'newest') {
      // As the shorts tab API response doesn't include the published dates,
      // we can't just write the results to the subscriptions cache like we do with videos and live (can't sort chronologically without the date).
      // However we can still update the metadata in the cache such as the view count and title that might have changed since it was cached
      store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: id.value,
        videos: latestShorts.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('shorts', false)
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    loadChannelOverview('local')
  }
}

async function getChannelShortsLocalMore() {
  const isCurrentRequest = currentElementListRequest('shorts')
  try {
    const page = await channelContentApi.getPage({
      section: 'shorts',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: shortSortBy.value,
      cursor: shortContinuationData.value,
      mayContainOtherChannels: mayContainContentFromOtherChannels,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestShorts.value = latestShorts.value.concat(page.items)
    shortContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

/**
 * @param {boolean} sortByChanged
 */
async function channelInvidiousShorts(sortByChanged = false) {
  const isCurrentRequest = startElementListRequest('shorts')
  if (sortByChanged) {
    shortContinuationData.value = null
  }

  let more = false
  if (shortContinuationData.value) {
    more = true
  } else {
    setElementListLoading('shorts', true)
  }

  try {
    const page = await channelContentApi.getPage({
      section: 'shorts',
      provider: 'invidious',
      id: id.value,
      sort: shortSortBy.value,
      cursor: shortContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestShorts.value = more ? latestShorts.value.concat(page.items) : page.items
    shortContinuationData.value = page.cursor
    setElementListLoading('shorts', false)

    if (isSubscribedInAnyProfile.value && !more && latestShorts.value.length > 0 && shortSortBy.value === 'newest') {
      // As the shorts tab API response doesn't include the published dates,
      // we can't just write the results to the subscriptions cache like we do with videos and live (can't sort chronologically without the date).
      // However we can still update the metadata in the cache e.g. adding the duration, as that isn't included in the RSS feeds
      // and updating the view count and title that might have changed since it was cached
      store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: id.value,
        videos: latestShorts.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('shorts', false)
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestLive = shallowRef([])
const liveContinuationData = shallowRef(null)
const showLiveSortBy = ref(true)
const liveSortBy = ref('newest')

watch(liveSortBy, () => {
  if (!autoRefreshOnSortByChangeEnabled) { return }

  setElementListLoading('live', true)
  latestLive.value = []
  liveContinuationData.value = null

  if (apiUsed === 'local') {
    getChannelLiveLocal()
  } else {
    channelInvidiousLive(true)
  }
})

async function getChannelLiveLocal() {
  const isCurrentRequest = startElementListRequest('live')
  setElementListLoading('live', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return

    const page = await channelContentApi.getPage({
      section: 'live',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: liveSortBy.value,
      sortValues: videoLiveShortSelectValues.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestLive.value = page.items
    liveContinuationData.value = page.cursor
    showLiveSortBy.value = page.canSort
    setElementListLoading('live', false)

    if (isSubscribedInAnyProfile.value && latestLive.value.length > 0 && liveSortBy.value === 'newest') {
      store.dispatch('updateSubscriptionLiveCacheByChannel', {
        channelId: id.value,
        videos: latestLive.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('live', false)
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    loadChannelOverview('local')
  }
}

async function getChannelLiveLocalMore() {
  const isCurrentRequest = currentElementListRequest('live')
  try {
    const page = await channelContentApi.getPage({
      section: 'live',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: liveSortBy.value,
      cursor: liveContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestLive.value = latestLive.value.concat(page.items)
    liveContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

/**
 * @param {boolean} sortByChanged
 */
async function channelInvidiousLive(sortByChanged) {
  const isCurrentRequest = startElementListRequest('live')
  if (sortByChanged) {
    liveContinuationData.value = null
  }

  let more = false
  if (liveContinuationData.value) {
    more = true
  } else {
    setElementListLoading('live', true)
  }

  try {
    const page = await channelContentApi.getPage({
      section: 'live',
      provider: 'invidious',
      id: id.value,
      sort: liveSortBy.value,
      cursor: liveContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestLive.value = more ? latestLive.value.concat(page.items) : page.items
    liveContinuationData.value = page.cursor
    setElementListLoading('live', false)

    if (isSubscribedInAnyProfile.value && !more && latestLive.value.length > 0 && liveSortBy.value === 'newest') {
      store.dispatch('updateSubscriptionLiveCacheByChannel', {
        channelId: id.value,
        videos: latestLive.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('live', false)
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestPlaylists = shallowRef([])
const playlistContinuationData = shallowRef(null)
const showPlaylistSortBy = ref(true)
const playlistSortBy = ref('newest')

watch(playlistSortBy, () => {
  if (!autoRefreshOnSortByChangeEnabled) { return }

  setElementListLoading('playlists', true)
  latestPlaylists.value = []
  playlistContinuationData.value = null

  if (apiUsed === 'local') {
    getChannelPlaylistsLocal()
  } else {
    getPlaylistsInvidious(true)
  }
})

async function getChannelPlaylistsLocal() {
  const isCurrentRequest = startElementListRequest('playlists')
  setElementListLoading('playlists', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return
    const page = await channelContentApi.getPage({
      section: 'playlists',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: playlistSortBy.value,
      sortValues: PLAYLIST_SELECT_VALUES,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestPlaylists.value = page.items
    playlistContinuationData.value = page.cursor
    showPlaylistSortBy.value = page.canSort
    setElementListLoading('playlists', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('playlists', false)
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getPlaylistsInvidious()
    } else {
      isLoading.value = false
    }
  }
}

async function getChannelPlaylistsLocalMore() {
  const isCurrentRequest = currentElementListRequest('playlists')
  try {
    const page = await channelContentApi.getPage({
      section: 'playlists',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      sort: playlistSortBy.value,
      cursor: playlistContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestPlaylists.value = latestPlaylists.value.concat(page.items)
    playlistContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function getPlaylistsInvidious() {
  const isCurrentRequest = startElementListRequest('playlists')
  setElementListLoading('playlists', true)

  try {
    const page = await channelContentApi.getPage({
      section: 'playlists',
      provider: 'invidious',
      id: id.value,
      sort: playlistSortBy.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    playlistContinuationData.value = page.cursor
    latestPlaylists.value = page.items
    setElementListLoading('playlists', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('playlists', false)
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getChannelPlaylistsLocal()
    } else {
      isLoading.value = false
    }
  }
}

async function getPlaylistsInvidiousMore() {
  const isCurrentRequest = currentElementListRequest('playlists')
  try {
    const page = await channelContentApi.getPage({
      section: 'playlists',
      provider: 'invidious',
      id: id.value,
      sort: playlistSortBy.value,
      cursor: playlistContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    playlistContinuationData.value = page.cursor
    latestPlaylists.value = latestPlaylists.value.concat(page.items)
    setElementListLoading('playlists', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestReleases = shallowRef([])
const releaseContinuationData = shallowRef(null)

async function getChannelReleasesLocal() {
  const isCurrentRequest = startElementListRequest('releases')
  setElementListLoading('releases', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return
    const page = await channelContentApi.getPage({
      section: 'releases',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestReleases.value = page.items
    releaseContinuationData.value = page.cursor
    setElementListLoading('releases', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('releases', false)
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      channelInvidiousReleases()
    } else {
      isLoading.value = false
    }
  }
}

async function getChannelReleasesLocalMore() {
  const isCurrentRequest = currentElementListRequest('releases')
  try {
    const page = await channelContentApi.getPage({
      section: 'releases',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      cursor: releaseContinuationData.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestReleases.value = latestReleases.value.concat(page.items)
    releaseContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function channelInvidiousReleases() {
  const isCurrentRequest = startElementListRequest('releases')
  setElementListLoading('releases', true)

  try {
    const page = await channelContentApi.getPage({
      section: 'releases',
      provider: 'invidious',
      id: id.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    releaseContinuationData.value = page.cursor
    latestReleases.value = page.items
    setElementListLoading('releases', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('releases', false)
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getChannelReleasesLocal()
    } else {
      isLoading.value = false
    }
  }
}

async function channelInvidiousReleasesMore() {
  const isCurrentRequest = currentElementListRequest('releases')
  try {
    const page = await channelContentApi.getPage({
      section: 'releases',
      provider: 'invidious',
      id: id.value,
      cursor: releaseContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    releaseContinuationData.value = page.cursor
    latestReleases.value = latestReleases.value.concat(page.items)
    setElementListLoading('releases', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestPodcasts = shallowRef([])
const podcastContinuationData = shallowRef(null)

async function getChannelPodcastsLocal() {
  const isCurrentRequest = startElementListRequest('podcasts')
  setElementListLoading('podcasts', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return
    const page = await channelContentApi.getPage({
      section: 'podcasts',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestPodcasts.value = page.items
    podcastContinuationData.value = page.cursor
    setElementListLoading('podcasts', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('podcasts', false)
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      channelInvidiousPodcasts()
    } else {
      isLoading.value = false
    }
  }
}

async function getChannelPodcastsLocalMore() {
  const isCurrentRequest = currentElementListRequest('podcasts')
  try {
    const page = await channelContentApi.getPage({
      section: 'podcasts',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      cursor: podcastContinuationData.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestPodcasts.value = latestPodcasts.value.concat(page.items)
    podcastContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function channelInvidiousPodcasts() {
  const isCurrentRequest = startElementListRequest('podcasts')
  setElementListLoading('podcasts', true)

  try {
    const page = await channelContentApi.getPage({
      section: 'podcasts',
      provider: 'invidious',
      id: id.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    podcastContinuationData.value = page.cursor
    latestPodcasts.value = page.items
    setElementListLoading('podcasts', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('podcasts', false)
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getChannelPodcastsLocal()
    } else {
      isLoading.value = false
    }
  }
}

async function channelInvidiousPodcastsMore() {
  const isCurrentRequest = currentElementListRequest('podcasts')
  try {
    const page = await channelContentApi.getPage({
      section: 'podcasts',
      provider: 'invidious',
      id: id.value,
      cursor: podcastContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    podcastContinuationData.value = page.cursor
    latestPodcasts.value = latestPodcasts.value.concat(page.items)
    setElementListLoading('podcasts', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestCourses = shallowRef([])
const coursesContinuationData = shallowRef(null)

async function getChannelCoursesLocal() {
  const isCurrentRequest = startElementListRequest('courses')
  setElementListLoading('courses', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return
    const page = await channelContentApi.getPage({
      section: 'courses',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestCourses.value = page.items
    coursesContinuationData.value = page.cursor
    setElementListLoading('courses', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('courses', false)
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      channelInvidiousCourses()
    } else {
      isLoading.value = false
    }
  }
}

async function getChannelCoursesLocalMore() {
  const isCurrentRequest = currentElementListRequest('courses')
  try {
    const page = await channelContentApi.getPage({
      section: 'courses',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      cursor: coursesContinuationData.value,
      artistTopic: isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestCourses.value = latestCourses.value.concat(page.items)
    coursesContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function channelInvidiousCourses() {
  const isCurrentRequest = startElementListRequest('courses')
  setElementListLoading('courses', true)

  try {
    const page = await channelContentApi.getPage({
      section: 'courses',
      provider: 'invidious',
      id: id.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    coursesContinuationData.value = page.cursor
    latestCourses.value = page.items
    setElementListLoading('courses', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('courses', false)
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getChannelCoursesLocal()
    } else {
      isLoading.value = false
    }
  }
}

async function channelInvidiousCoursesMore() {
  const isCurrentRequest = currentElementListRequest('courses')
  try {
    const page = await channelContentApi.getPage({
      section: 'courses',
      provider: 'invidious',
      id: id.value,
      cursor: coursesContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    coursesContinuationData.value = page.cursor
    latestCourses.value = latestCourses.value.concat(page.items)
    setElementListLoading('courses', false)
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

const latestCommunityPosts = shallowRef([])
const communityContinuationData = shallowRef(null)

async function getCommunityPostsLocal() {
  const isCurrentRequest = startElementListRequest('community')
  setElementListLoading('community', true)

  try {
    await ensureChannelInstance()
    if (!isCurrentRequest()) return
    const page = await channelContentApi.getPage({
      section: 'community',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestCommunityPosts.value = page.items
    communityContinuationData.value = page.cursor
    setElementListLoading('community', false)

    if (latestCommunityPosts.value.length > 0) {
      store.dispatch('updateSubscriptionPostsCacheByChannel', {
        channelId: id.value,
        posts: latestCommunityPosts.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('community', false)
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getCommunityPostsInvidious()
    } else {
      isLoading.value = false
    }
  }
}

async function getCommunityPostsLocalMore() {
  const isCurrentRequest = currentElementListRequest('community')
  try {
    const page = await channelContentApi.getPage({
      section: 'community',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      cursor: communityContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestCommunityPosts.value = latestCommunityPosts.value.concat(page.items)
    communityContinuationData.value = page.cursor
  } catch (err) {
    if (!isCurrentRequest()) return
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
  }
}

async function getCommunityPostsInvidious() {
  const isCurrentRequest = startElementListRequest('community')
  const more = !isNullOrEmpty(communityContinuationData.value)
  if (!more) {
    setElementListLoading('community', true)
  }

  try {
    const page = await channelContentApi.getPage({
      section: 'community',
      provider: 'invidious',
      id: id.value,
      cursor: communityContinuationData.value,
      isCurrent: isCurrentRequest,
    })
    if (!page || !isCurrentRequest()) return
    latestCommunityPosts.value = more
      ? latestCommunityPosts.value.concat(page.items)
      : page.items
    communityContinuationData.value = page.cursor
    setElementListLoading('community', false)

    if (isSubscribedInAnyProfile.value && !more && latestCommunityPosts.value.length > 0) {
      store.dispatch('updateSubscriptionPostsCacheByChannel', {
        channelId: id.value,
        posts: latestCommunityPosts.value
      })
    }
  } catch (err) {
    if (!isCurrentRequest()) return
    setElementListLoading('community', false)
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      getCommunityPostsLocal()
    }
  }
}

const lastSearchQuery = ref('')
const searchResults = shallowRef([])
const searchContinuationData = shallowRef(null)
const channelSearchFilter = ref(CHANNEL_SEARCH_FILTERS.ALL)

const filteredSearchResults = computed(() => {
  return filterChannelSearchResults(searchResults.value, channelSearchFilter.value)
})

const availableChannelSearchFilters = computed(() => {
  const filters = [{
    value: CHANNEL_SEARCH_FILTERS.ALL,
    label: t('Channel.All Results'),
  }]

  if (channelTabs.value.includes('videos')) {
    filters.push({
      value: CHANNEL_SEARCH_FILTERS.VIDEOS,
      label: t('Global.Videos'),
    })
  }

  if (channelTabs.value.includes('shorts') && !hideChannelShorts.value) {
    filters.push({
      value: CHANNEL_SEARCH_FILTERS.SHORTS,
      label: t('Global.Shorts'),
    })
  }

  if (channelTabs.value.includes('live')) {
    filters.push({
      value: CHANNEL_SEARCH_FILTERS.LIVE,
      label: t('Global.Live'),
    })
  }

  if (channelTabs.value.includes('playlists') && !hideChannelPlaylists.value) {
    filters.push({
      value: CHANNEL_SEARCH_FILTERS.PLAYLISTS,
      label: t('Channel.Playlists.Playlists'),
    })
  }

  return filters
})

async function searchChannelLocal() {
  const isNewSearch = searchContinuationData.value === null

  try {
    await ensureChannelInstance()

    const page = await channelContentApi.getPage({
      section: 'search',
      provider: 'local',
      channel: channelInstance,
      id: id.value,
      channelName: channelName.value,
      query: lastSearchQuery.value,
      cursor: searchContinuationData.value,
      hidePlaylists: hideChannelPlaylists.value,
    })
    if (page.notSearchable) {
      showToast({
        message: t('Channel.This channel does not allow searching'),
        time: 5000,
        icon: ['fas', 'search'],
      })
      showSearchBar.value = false
      return
    }
    searchResults.value = isNewSearch
      ? page.items
      : searchResults.value.concat(page.items)
    searchContinuationData.value = page.cursor

    isSearchTabLoading.value = false
  } catch (err) {
    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')

    showApiErrorToast(errorMessage, err)

    if (isNewSearch) {
      if (channelContentApi.getFallbackProvider('local', backendPreference.value, backendFallback.value) !== null) {
        showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
        searchChannelInvidious()
      } else {
        isLoading.value = false
      }
    }
  }
}

async function searchChannelInvidious() {
  try {
    const page = await channelContentApi.getPage({
      section: 'search',
      provider: 'invidious',
      id: id.value,
      query: lastSearchQuery.value,
      hidePlaylists: hideChannelPlaylists.value,
      cursor: searchContinuationData.value,
    })
    searchResults.value = searchResults.value.concat(page.items)
    searchContinuationData.value = page.cursor

    isSearchTabLoading.value = false
  } catch (err) {
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (channelContentApi.getFallbackProvider('invidious', backendPreference.value, backendFallback.value) !== null) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      searchChannelLocal()
    } else {
      isLoading.value = false
    }
  }
}

/**
 * @param {string} query
 */
function newSearch(query) {
  if (query === '') {
    clearSearch()
    return
  }

  lastSearchQuery.value = query
  searchContinuationData.value = null
  isSearchTabLoading.value = true
  searchResults.value = []
  channelSearchFilter.value = CHANNEL_SEARCH_FILTERS.ALL
  changeTab('search')

  if (apiUsed === 'local') {
    searchChannelLocal()
  } else {
    searchChannelInvidious()
  }
}

/**
 * @param {string} query
 */
function newSearchWithStatePersist(query) {
  saveStateInRouter(query)
  newSearch(query)
}

function clearSearch() {
  lastSearchQuery.value = ''
  searchContinuationData.value = null
  isSearchTabLoading.value = false
  searchResults.value = []
  channelSearchFilter.value = CHANNEL_SEARCH_FILTERS.ALL
  changeTab(currentOrFirstTab(undefined))
}

async function saveStateInRouter(query) {
  skipRouteChangeWatcherOnce = true

  let location

  if (query === '') {
    location = {
      path: `/channel/${id.value}`,
      state: { skipTabRouteLoading: true }
    }
  } else {
    location = {
      path: `/channel/${id.value}`,
      params: {
        currentTab: 'search',
      },
      query: {
        searchQueryText: query,
      },
      state: { skipTabRouteLoading: true }
    }
  }

  try {
    await router.replace(location)
  } catch (failure) {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      return
    }

    throw failure
  }

  skipRouteChangeWatcherOnce = false
}

/**
 * @param {string} message
 * @param {boolean} responseHasNameAndThumbnail
 */
function setErrorMessage(message, responseHasNameAndThumbnail = false) {
  isLoading.value = false
  errorMessage.value = message

  if (!responseHasNameAndThumbnail) {
    channelName.value = subscriptionInfo.value?.name
    thumbnailUrl.value = subscriptionInfo.value?.thumbnail
  }

  bannerUrl.value = null
  subCount.value = null
}

const showFetchMoreButton = computed(() => {
  switch (currentTab.value) {
    case 'videos':
      return !isNullOrEmpty(videoContinuationData.value)
    case 'shorts':
      return !isNullOrEmpty(shortContinuationData.value)
    case 'live':
      return !isNullOrEmpty(liveContinuationData.value)
    case 'releases':
      return !isNullOrEmpty(releaseContinuationData.value)
    case 'podcasts':
      return !isNullOrEmpty(podcastContinuationData.value)
    case 'courses':
      return !isNullOrEmpty(coursesContinuationData.value)
    case 'playlists':
      return !isNullOrEmpty(playlistContinuationData.value)
    case 'community':
      return !isNullOrEmpty(communityContinuationData.value)
    case 'search':
      return !isNullOrEmpty(searchContinuationData.value)
    default:
      return false
  }
})

async function handleFetchMore() {
  if (isFetchMoreLoading.value) return

  isFetchMoreLoading.value = true

  switch (currentTab.value) {
    case 'videos':
      if (apiUsed === 'local') {
        await getChannelVideosLocalMore()
      } else {
        await channelInvidiousVideos()
      }
      break
    case 'shorts':
      if (apiUsed === 'local') {
        await getChannelShortsLocalMore()
      } else {
        await channelInvidiousShorts()
      }
      break
    case 'live':
      if (apiUsed === 'local') {
        await getChannelLiveLocalMore()
      } else {
        await channelInvidiousLive()
      }
      break
    case 'releases':
      if (apiUsed === 'local') {
        await getChannelReleasesLocalMore()
      } else {
        await channelInvidiousReleasesMore()
      }
      break
    case 'podcasts':
      if (apiUsed === 'local') {
        await getChannelPodcastsLocalMore()
      } else {
        await channelInvidiousPodcastsMore()
      }
      break
    case 'courses':
      if (apiUsed === 'local') {
        await getChannelCoursesLocalMore()
      } else {
        await channelInvidiousCoursesMore()
      }
      break
    case 'playlists':
      if (apiUsed === 'local') {
        await getChannelPlaylistsLocalMore()
      } else {
        await getPlaylistsInvidiousMore()
      }
      break
    case 'search':
      if (apiUsed === 'local') {
        await searchChannelLocal()
      } else {
        await searchChannelInvidious()
      }
      break
    case 'community':
      if (apiUsed === 'local') {
        await getCommunityPostsLocalMore()
      } else {
        await getCommunityPostsInvidious()
      }
      break
    default:
      console.error(currentTab.value)
  }

  isFetchMoreLoading.value = false
}

/**
 * Handles a user-initiated tab change from the tab bar.
 * Replaces the current route so the selected tab is preserved without
 * adding every tab change to the navigation history.
 * @param {string} tab
 * @param {boolean} moveFocus
 */
async function handleTabChange(tab, moveFocus = true) {
  if (tab !== currentTab.value) {
    changeTab(tab, moveFocus)
    await replaceTabRoute(tab)
  } else {
    changeTab(tab, moveFocus)
  }
}

/**
 * Coalesces rapid tab changes so their route replacements cannot race the
 * route watcher and reload the channel.
 * @param {string} tab
 */
async function replaceTabRoute(tab) {
  pendingTabRoute = tab

  if (isReplacingTabRoute) {
    return
  }

  isReplacingTabRoute = true

  try {
    while (pendingTabRoute !== null) {
      const nextTab = pendingTabRoute
      pendingTabRoute = null

      // We already have the data and only need to switch the visible tab.
      skipRouteChangeWatcherOnce = true

      try {
        await router.replace({
          path: `/channel/${id.value}/${nextTab}`,
          state: { skipTabRouteLoading: true }
        })
      } catch (failure) {
        if (!isNavigationFailure(failure, NavigationFailureType.duplicated)) {
          throw failure
        }
      } finally {
        skipRouteChangeWatcherOnce = false
      }
    }
  } finally {
    isReplacingTabRoute = false
  }
}

/**
 * @param {KeyboardEvent} event
 */
function handlePanelTabNavigation(event) {
  if (
    (isTabPresented && !isTabPresented.value) ||
    event.altKey ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  ) {
    return
  }

  const target = event.target
  const isDocumentTarget = target === document.body || target === document.documentElement
  const isPanelTarget = target instanceof Element && target.closest('[role="tabpanel"]') !== null
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

  const visibleTabs = tabInfoValues.value
  const currentIndex = visibleTabs.indexOf(currentTab.value)

  if (currentIndex === -1) {
    return
  }

  const offset = event.key === 'ArrowLeft' ? -1 : 1
  const nextIndex = (currentIndex + offset + visibleTabs.length) % visibleTabs.length

  event.preventDefault()
  handleTabChange(visibleTabs[nextIndex], false)
}

function changeTab(tab, moveFocus = true) {
  // `newTabNode` can be `null` when `tab` === "search"
  const newTabNode = document.getElementById(`${tab}Tab`)
  currentTab.value = tab

  if (moveFocus && newTabNode != null) {
    newTabNode.focus()
  }
}

function handleSubscription() {
  // We can't cache the shorts data as YouTube doesn't return published dates on the shorts channel tab

  if (videoSortBy.value === 'newest') {
    store.dispatch('updateSubscriptionVideosCacheByChannel', {
      channelId: id.value,
      videos: latestVideos.value
    })
  }

  if (liveSortBy.value === 'newest') {
    store.dispatch('updateSubscriptionLiveCacheByChannel', {
      channelId: id.value,
      videos: latestLive.value
    })
  }

  store.dispatch('updateSubscriptionPostsCacheByChannel', {
    channelId: id.value,
    posts: latestCommunityPosts.value
  })
}

function filterWatchedArray(videos) {
  const historyCache = store.getters.getHistoryCacheById
  return videos.filter(video => historyCache[video.videoId] === undefined)
}
</script>

<style scoped src="./Channel.css" />
