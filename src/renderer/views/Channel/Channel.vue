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

/** @param {'local' | 'invidious'} provider */
function channelApiErrorMessage(provider) {
  return provider === 'local'
    ? t('Local API Error (Click to copy)')
    : t('Invidious API Error (Click to copy)')
}

/** @param {'local' | 'invidious'} provider */
function channelFallbackMessage(provider) {
  return provider === 'local'
    ? t('Falling back to Local API')
    : t('Falling back to Invidious API')
}

async function ensureChannelInstance() {
  if (!channelInstance) {
    channelInstance = await channelContentApi.getInfo(id.value, 'local')
  }
}

/** @param {'local' | 'invidious'} [failedProvider] */
async function loadChannelOverview(failedProvider) {
  const expectedId = id.value
  isLoading.value = true
  let overview

  try {
    overview = await channelContentApi.loadOverview({
      id: expectedId,
      preference: backendPreference.value,
      fallback: backendFallback.value,
      failedProvider,
      subscriptionName: subscriptionInfo.value?.name,
      subscriptionThumbnail: subscriptionInfo.value?.thumbnail,
      instanceUrl: currentInvidiousInstanceUrl.value,
      existingChannel: channelInstance,
      isCurrent: () => expectedId === id.value,
      onSelected: provider => {
        apiUsed = provider
        if (provider === 'invidious') channelInstance = null
      },
      onError: (provider, error) => {
        if (provider === 'invidious') setErrorMessage(error)
        console.error(error)
        const message = provider === 'local'
          ? t('Local API Error (Click to copy)')
          : t('Invidious API Error (Click to copy)')
        showApiErrorToast(message, error)
      },
      onFallback: (_from, to) => {
        const message = to === 'local'
          ? t('Falling back to Local API')
          : t('Falling back to Invidious API')
        showToast({ message, icon: ['fas', 'exchange-alt'] })
      },
      onNoProvider: () => { isLoading.value = false },
    })
    if (!overview || expectedId !== id.value) return

    apiUsed = overview.provider
    channelInstance = overview.channel

    if (overview.kind === 'alert') {
      setErrorMessage(overview.message)
      return
    }
    if (overview.kind === 'age-gate') {
      channelName.value = overview.name
      thumbnailUrl.value = overview.thumbnail
      store.dispatch('updateSubscriptionDetails', {
        channelThumbnailUrl: overview.thumbnail,
        channelName: overview.name,
        channelId: expectedId,
      })
      setErrorMessage(t('Channel["This channel is age-restricted and currently cannot be viewed in OpenTubeX."]'), true)
      return
    }

    errorMessage.value = ''
    if (overview.routeId !== null) id.value = overview.routeId
    channelName.value = overview.name
    thumbnailUrl.value = overview.thumbnail
    bannerUrl.value = overview.banner
    isFamilyFriendly.value = overview.familyFriendly
    subCount.value = overview.subscriberCount
    if (overview.provider === 'local') {
      isArtistTopicChannel.value = overview.artistTopic
      mayContainContentFromOtherChannels = overview.mayContainOtherChannels
      tags.value = overview.tags
    }

    store.dispatch('updateSubscriptionDetails', {
      channelThumbnailUrl: overview.subscriptionThumbnail,
      channelName: overview.name,
      channelId: overview.id,
    })

    if (overview.aboutPending) {
      getChannelAboutLocal()
    } else {
      description.value = overview.description === null ? '' : autolinker.link(overview.description)
      viewCount.value = overview.viewCount
      videoCount.value = overview.videoCount
      joined.value = overview.joined
      if (overview.provider === 'local') location.value = overview.location
    }
    if (overview.relatedChannels !== null) relatedChannels.value = overview.relatedChannels
    if (overview.homePending) getChannelHomeLocal()

    const hiddenLocalTabs = {
      home: hideChannelHome.value,
      shorts: hideChannelShorts.value,
      podcasts: hideChannelPodcasts.value,
      releases: hideChannelReleases.value,
      courses: hideChannelCourses.value,
      playlists: hideChannelPlaylists.value,
      community: hideChannelCommunity.value,
    }
    const visibleTabs = overview.provider === 'local'
      ? overview.availableTabs.filter(tab => !hiddenLocalTabs[tab])
      : overview.availableTabs
    const applyTabs = () => {
      channelTabs.value = SUPPORTED_CHANNEL_TABS.filter(tab => visibleTabs.includes(tab))
      currentTab.value = currentOrFirstTab(route.params.currentTab)
      if (overview.showSearchBar !== null) showSearchBar.value = overview.showSearchBar
    }
    if (overview.provider === 'invidious') applyTabs()

    const loaders = {
      videos: () => loadChannelVideos(),
      shorts: () => loadChannelStream('shorts'),
      live: () => loadChannelStream('live'),
      podcasts: () => loadChannelList('podcasts'),
      releases: () => loadChannelList('releases'),
      courses: () => loadChannelList('courses'),
      playlists: () => loadChannelList('playlists'),
      community: () => loadChannelList('community'),
    }
    for (const tab of overview.availableTabs.filter(tab => !hiddenLocalTabs[tab])) loaders[tab]?.()
    if (overview.provider === 'local') applyTabs()
    isLoading.value = false
  } catch (error) {
    if (expectedId !== id.value && overview?.routeId !== id.value) return
    if (overview) {
      if (overview.provider === 'invidious') setErrorMessage(error)
      console.error(error)
      const message = overview.provider === 'local'
        ? t('Local API Error (Click to copy)')
        : t('Invidious API Error (Click to copy)')
      showApiErrorToast(message, error)
      return loadChannelOverview(overview.provider)
    }
    isLoading.value = false
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

  loadChannelVideos()
})

/** @param {boolean} [more] */
async function loadChannelVideos(more = false) {
  const isCurrentRequest = more ? currentElementListRequest('videos') : startElementListRequest('videos')
  if (!more) setElementListLoading('videos', true)

  try {
    const page = await channelContentApi.loadVideosPage({
      id: id.value,
      channelName: channelName.value,
      provider: apiUsed,
      preference: backendPreference.value,
      fallback: backendFallback.value,
      more,
      channel: channelInstance,
      artistTopic: isArtistTopicChannel.value,
      sort: videoSortBy.value,
      sortValues: videoLiveShortSelectValues.value,
      cursor: more ? videoContinuationData.value : null,
      isCurrent: isCurrentRequest,
      onError: (provider, error) => {
        console.error(error)
        showApiErrorToast(
          channelApiErrorMessage(provider),
          error
        )
      },
      onOverviewFallback: from => loadChannelOverview(from),
    })
    if (!page || !isCurrentRequest()) {
      if (isCurrentRequest()) setElementListLoading('videos', false)
      return
    }
    if (page.provider === 'local') channelInstance = page.channel
    latestVideos.value = more ? latestVideos.value.concat(page.videos) : page.videos
    videoContinuationData.value = page.cursor
    if (page.canSort !== null) showVideoSortBy.value = page.canSort
    setElementListLoading('videos', false)

    if (!more && isSubscribedInAnyProfile.value && latestVideos.value.length > 0 && videoSortBy.value === 'newest') {
      store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId: id.value,
        videos: latestVideos.value
      })
    }
  } catch {
    if (!isCurrentRequest()) return
    setElementListLoading('videos', false)
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

  loadChannelStream('shorts')
})

const latestLive = shallowRef([])
const liveContinuationData = shallowRef(null)
const showLiveSortBy = ref(true)
const liveSortBy = ref('newest')

watch(liveSortBy, () => {
  if (!autoRefreshOnSortByChangeEnabled) { return }

  setElementListLoading('live', true)
  latestLive.value = []
  liveContinuationData.value = null
  loadChannelStream('live')
})

const channelStreamState = {
  shorts: {
    items: latestShorts,
    cursor: shortContinuationData,
    sort: shortSortBy,
    showSort: showShortSortBy,
    cacheAction: 'updateSubscriptionShortsCacheWithChannelPageShorts',
  },
  live: {
    items: latestLive,
    cursor: liveContinuationData,
    sort: liveSortBy,
    showSort: showLiveSortBy,
    cacheAction: 'updateSubscriptionLiveCacheByChannel',
  },
}

/** @param {'shorts' | 'live'} section @param {boolean} [more] */
async function loadChannelStream(section, more = false) {
  const state = channelStreamState[section]
  const isCurrentRequest = more ? currentElementListRequest(section) : startElementListRequest(section)
  if (!more) setElementListLoading(section, true)

  try {
    const page = await channelContentApi.loadPage({
      section,
      provider: apiUsed,
      preference: backendPreference.value,
      fallback: backendFallback.value,
      more,
      id: id.value,
      channel: channelInstance,
      channelName: channelName.value,
      cursor: more ? state.cursor.value : null,
      sort: state.sort.value,
      sortValues: videoLiveShortSelectValues.value,
      mayContainOtherChannels: section === 'shorts' && mayContainContentFromOtherChannels,
      isCurrent: isCurrentRequest,
      onError: (provider, error) => {
        console.error(error)
        showApiErrorToast(
          channelApiErrorMessage(provider),
          error
        )
      },
      onOverviewFallback: from => loadChannelOverview(from),
    })
    if (!page || !isCurrentRequest()) {
      if (isCurrentRequest()) setElementListLoading(section, false)
      return
    }
    if (page.provider === 'local') channelInstance = page.channel
    state.items.value = more ? state.items.value.concat(page.items) : page.items
    state.cursor.value = page.cursor
    if (page.canSort !== null) state.showSort.value = page.canSort
    setElementListLoading(section, false)

    if (!more && isSubscribedInAnyProfile.value && state.items.value.length > 0 && state.sort.value === 'newest') {
      store.dispatch(state.cacheAction, { channelId: id.value, videos: state.items.value })
    }
  } catch {
    if (!isCurrentRequest()) return
    setElementListLoading(section, false)
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

  loadChannelList('playlists')
})

const latestReleases = shallowRef([])
const releaseContinuationData = shallowRef(null)
const latestPodcasts = shallowRef([])
const podcastContinuationData = shallowRef(null)
const latestCourses = shallowRef([])
const coursesContinuationData = shallowRef(null)
const latestCommunityPosts = shallowRef([])
const communityContinuationData = shallowRef(null)

const channelListState = {
  playlists: { items: latestPlaylists, cursor: playlistContinuationData, sort: playlistSortBy, sortValues: PLAYLIST_SELECT_VALUES, showSort: showPlaylistSortBy },
  releases: { items: latestReleases, cursor: releaseContinuationData },
  podcasts: { items: latestPodcasts, cursor: podcastContinuationData },
  courses: { items: latestCourses, cursor: coursesContinuationData },
  community: { items: latestCommunityPosts, cursor: communityContinuationData },
}

/** @param {'playlists' | 'releases' | 'podcasts' | 'courses' | 'community'} section
 *  @param {boolean} [more]
 */
async function loadChannelList(section, more = false) {
  const state = channelListState[section]
  const isCurrentRequest = more ? currentElementListRequest(section) : startElementListRequest(section)
  if (!more) setElementListLoading(section, true)

  try {
    const page = await channelContentApi.loadPage({
      section,
      provider: apiUsed,
      preference: backendPreference.value,
      fallback: backendFallback.value,
      more,
      id: id.value,
      channel: channelInstance,
      channelName: channelName.value,
      cursor: more ? state.cursor.value : null,
      sort: state.sort?.value ?? 'newest',
      sortValues: state.sortValues ?? [],
      artistTopic: section === 'releases' && isArtistTopicChannel.value,
      isCurrent: isCurrentRequest,
      onError: (provider, error) => {
        console.error(error)
        showApiErrorToast(
          channelApiErrorMessage(provider),
          error
        )
      },
      onFallback: (_from, to) => {
        showToast({
          message: channelFallbackMessage(to),
          icon: ['fas', 'exchange-alt'],
        })
      },
    })
    if (!page || !isCurrentRequest()) return
    if (page.provider === 'local') channelInstance = page.channel
    state.items.value = more ? state.items.value.concat(page.items) : page.items
    state.cursor.value = page.cursor
    if (state.showSort && page.canSort !== null) state.showSort.value = page.canSort
    setElementListLoading(section, false)

    if (section === 'community' && !more && state.items.value.length > 0 &&
        (page.provider === 'local' || isSubscribedInAnyProfile.value)) {
      store.dispatch('updateSubscriptionPostsCacheByChannel', {
        channelId: id.value,
        posts: state.items.value
      })
    }
  } catch {
    if (!isCurrentRequest()) return
    setElementListLoading(section, false)
    if (!more) isLoading.value = false
  }
}

const lastSearchQuery = ref('')
const searchResults = shallowRef([])
const searchContinuationData = shallowRef(null)
const channelSearchFilter = ref(CHANNEL_SEARCH_FILTERS.ALL)
let searchRequestId = 0

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

async function searchChannel() {
  const isNewSearch = searchContinuationData.value === null
  const requestId = searchRequestId
  const routeGeneration = channelRouteGeneration
  const channelId = id.value
  const isCurrentRequest = () => requestId === searchRequestId &&
    routeGeneration === channelRouteGeneration && channelId === id.value

  try {
    const page = await channelContentApi.loadPage({
      section: 'search',
      provider: apiUsed,
      preference: backendPreference.value,
      fallback: isNewSearch && backendFallback.value,
      more: !isNewSearch,
      id: id.value,
      channel: channelInstance,
      channelName: channelName.value,
      query: lastSearchQuery.value,
      cursor: searchContinuationData.value,
      hidePlaylists: hideChannelPlaylists.value,
      isCurrent: isCurrentRequest,
      onError: (provider, error) => {
        console.error(error)
        showApiErrorToast(
          channelApiErrorMessage(provider),
          error
        )
      },
      onFallback: (_from, to) => {
        showToast({
          message: channelFallbackMessage(to),
          icon: ['fas', 'exchange-alt'],
        })
      },
    })
    if (!page || !isCurrentRequest()) return
    if (page.provider === 'local') channelInstance = page.channel
    if (page.notSearchable) {
      showToast({
        message: t('Channel.This channel does not allow searching'),
        time: 5000,
        icon: ['fas', 'search'],
      })
      showSearchBar.value = false
      return
    }
    searchResults.value = isNewSearch ? page.items : searchResults.value.concat(page.items)
    searchContinuationData.value = page.cursor
    isSearchTabLoading.value = false
  } catch {
    if (!isCurrentRequest()) return
    if (isNewSearch) isLoading.value = false
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
  searchRequestId += 1
  searchContinuationData.value = null
  isSearchTabLoading.value = true
  searchResults.value = []
  channelSearchFilter.value = CHANNEL_SEARCH_FILTERS.ALL
  changeTab('search')

  searchChannel()
}

/**
 * @param {string} query
 */
function newSearchWithStatePersist(query) {
  saveStateInRouter(query)
  newSearch(query)
}

function clearSearch() {
  searchRequestId += 1
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
      await loadChannelVideos(true)
      break
    case 'shorts':
      await loadChannelStream('shorts', true)
      break
    case 'live':
      await loadChannelStream('live', true)
      break
    case 'releases':
      await loadChannelList('releases', true)
      break
    case 'podcasts':
      await loadChannelList('podcasts', true)
      break
    case 'courses':
      await loadChannelList('courses', true)
      break
    case 'playlists':
      await loadChannelList('playlists', true)
      break
    case 'search':
      await searchChannel()
      break
    case 'community':
      await loadChannelList('community', true)
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
