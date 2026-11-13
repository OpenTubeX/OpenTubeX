<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else
      class="card"
    >
      <div class="titleRow">
        <h2 class="pageTitle">
          <FtIcon
            :icon="['fas', 'search']"
            class="headingIcon"
          />
          {{ t("Search Filters.Search Results") }}
        </h2>
        <div
          v-if="supportsYtDlp"
          class="searchControls"
        >
          <div class="searchControl">
            <FtSelect
              :placeholder="t('Subscriptions.Platforms.Platform')"
              :value="searchPlatform"
              :select-names="searchPlatformNames"
              :select-values="searchPlatformValues"
              :option-icons="searchPlatformIcons"
              :icon="['fas', 'globe']"
              @change="changeSearchPlatform"
            />
          </div>
          <div
            v-if="platform && platform.searchTypes.length > 1"
            class="searchControl"
          >
            <FtSelect
              :placeholder="t('Search Filters.Type.Type')"
              :value="platformSearchType"
              :select-names="platform.searchTypes.map(value => platformSearchTypeLabels[value])"
              :select-values="platform.searchTypes"
              :icon="['fas', 'filter']"
              @change="value => selectedPlatformSearchType = value"
            />
          </div>
        </div>
      </div>
      <PlatformSearchResults
        v-if="platform"
        :platform="platform"
        :query="processedQuery"
        :type="platformSearchType"
      />
      <template v-else>
        <div
          v-if="searchCorrection"
          class="searchCorrection"
          :class="{ centered: shownResults.length === 0 }"
          role="status"
        >
          <I18nT
            v-if="searchCorrection.type === 'didYouMean'"
            keypath="Search Filters.Did you mean"
            tag="p"
            scope="global"
          >
            <template #query>
              <RouterLink :to="getSearchRoute(searchCorrection.correctedQuery, true)">
                <strong>{{ searchCorrection.correctedQuery }}</strong>
              </RouterLink>
            </template>
          </I18nT>
          <template v-else>
            <I18nT
              :keypath="searchCorrection.type === 'showingResultsFor' ? 'Search Filters.Showing results for' : 'Search Filters.Including results for'"
              tag="p"
              scope="global"
            >
              <template #query>
                <strong>{{ searchCorrection.correctedQuery }}</strong>
              </template>
            </I18nT>
            <I18nT
              v-if="searchCorrection.canSearchOriginal"
              :keypath="searchCorrection.type === 'showingResultsFor' ? 'Search Filters.Search instead for' : 'Search Filters.Search only for'"
              tag="p"
              scope="global"
            >
              <template #query>
                <RouterLink :to="getSearchRoute(processedQuery, false)">
                  {{ processedQuery }}
                </RouterLink>
              </template>
            </I18nT>
          </template>
        </div>
        <div
          v-if="searchNotice"
          class="searchNotice"
          role="status"
        >
          <h3>{{ searchNotice.title }}</h3>
          <p>{{ searchNotice.body }}</p>
          <template v-if="searchNotice.requiresAuthentication && supportsCookieSearch && !showFamilyFriendlyOnly">
            <p v-if="!cookiesConfigured">
              {{ t('Video.Configure Restricted Playback Cookies Hint') }}
            </p>
            <FtButton
              v-else
              class="searchRetryButton"
              :label="t('Video.Try With Configured Cookies')"
              :icon="['fas', 'cookie']"
              :disabled="isRetryingWithCookies"
              @click="retrySearchWithCookies"
            />
            <FtLoader
              v-if="isRetryingWithCookies"
              :label="t('Search Filters[&quot;Fetching results. Please wait&quot;]')"
            />
          </template>
        </div>
        <p
          v-if="cookieSearchFailed"
          class="searchStatus"
          role="alert"
        >
          {{ t('Search Filters.Cookie Search Failed') }}
        </p>
        <FtElementList
          :data="shownResults"
        />
        <!-- Recheck visibility when results are appended or replaced. -->
        <FtAutoLoadNextPageWrapper
          v-if="hasMoreResults"
          :key="autoLoadMore ? paginationRevision : 0"
          :loading="isLoadingMore"
          :paused="nextPageFailed"
          @load-next-page="nextPage"
        >
          <div
            class="getNextPage"
            role="button"
            tabindex="0"
            @click="nextPage"
            @keydown.enter.space.prevent="nextPage"
          >
            <FtIcon :icon="['fas', 'search']" /> {{ t("Search Filters.Fetch more results") }}
          </div>
        </FtAutoLoadNextPageWrapper>
        <p
          v-else-if="!searchNotice && !cookieSearchFailed && !isRetryingWithCookies"
          class="searchStatus"
          role="status"
        >
          {{ exhaustedSearchMessage }}
        </p>
        <p
          v-if="isEmptyLocalSearch && !searchNotice && !showFamilyFriendlyOnly && !isRetryingWithCookies"
          class="searchHint"
        >
          {{ t('Search Filters.Possible Age Restriction Hint') }}
        </p>
        <FtButton
          v-if="showCookieRetryWithoutNotice"
          class="searchRetryButton"
          :label="t('Video.Try With Configured Cookies')"
          :icon="['fas', 'cookie']"
          :disabled="isRetryingWithCookies"
          @click="retrySearchWithCookies"
        />
        <FtLoader
          v-if="isRetryingWithCookies && !searchNotice && !isLoadingMore"
          :label="t('Search Filters[&quot;Fetching results. Please wait&quot;]')"
        />
      </template>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { Translation as I18nT, useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import PlatformSearchResults from '../../components/PlatformSearchResults/PlatformSearchResults.vue'

import store from '../../store'
import { usesInvidiousApi } from '../../../apiBackends'

import {
  getInvidiousApiErrorMessage,
  showInvidiousFallbackToast,
  searchFiltersMatch,
  showApiErrorToast,
  showToast,
} from '../../helpers/utils'
import {
  extractLocalCacheableSearchContinuation,
  getLocalMissingPublicationDates,
  getLocalSearchContinuation,
  getLocalSearchResults
} from '../../helpers/api/local'
import { applyPublicationDates } from '../../helpers/api/missing-publication'
import { getInvidiousSearchResults } from '../../helpers/api/invidious'
import { SEARCH_CHAR_LIMIT } from '../../../constants'
import { getSearchSettingsFromRouteQuery } from '../../../search-history'
import { useTabContext, useTabLifecycle, useTabTitle } from '../../tabs/TabContext'
import { ytDlp } from '../../helpers/ytDlp'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { getPlatform, PLATFORM_ICONS, PLATFORMS } from '../../../platforms/index'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const SEARCH_PLATFORM_STORAGE_KEY = 'searchPlatform'
// The last platform searched stays selected for later searches
const searchPlatform = computed(() => {
  if (!supportsYtDlp) return 'youtube'
  const requested = route.query.platform ?? localStorage.getItem(SEARCH_PLATFORM_STORAGE_KEY)
  return getPlatform(requested) ? requested : 'youtube'
})
const searchPlatformValues = ['youtube', ...PLATFORMS.map(platform => platform.id)]
const searchPlatformNames = ['YouTube', ...PLATFORMS.map(platform => platform.name)]
const searchPlatformIcons = [['fab', 'youtube'], ...PLATFORMS.map(platform => PLATFORM_ICONS[platform.id])]
// Searches on YouTube have none
const platform = computed(() => getPlatform(searchPlatform.value))

const platformSearchTypeLabels = computed(() => ({
  videos: t('Search Filters.Type.Videos'),
  tracks: t('Platforms.Tracks'),
  channels: t('Search Filters.Type.Channels'),
  playlists: t('Platforms.Playlists')
}))
// The type stays selected for later searches on platforms that have it
const selectedPlatformSearchType = ref('')
const platformSearchType = computed(() => platform.value?.searchTypes.includes(selectedPlatformSearchType.value)
  ? selectedPlatformSearchType.value
  : platform.value?.searchTypes[0] ?? '')

/**
 * @param {string} platform
 */
function changeSearchPlatform(platform) {
  localStorage.setItem(SEARCH_PLATFORM_STORAGE_KEY, platform)
  router.replace({ query: { ...route.query, platform } })
}
const { tabId: injectedTabId } = useTabContext()
const tabId = injectedTabId ?? 'web'
const setTabTitle = useTabTitle()

const isLoading = ref(false)
const isLoadingMore = ref(false)
// A failed continuation waits for the user to retry, so auto-loading cannot loop.
const nextPageFailed = ref(false)
const autoLoadMore = computed(() => store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled)
const hasMoreResults = ref(true)
const apiUsed = ref('local')
const localSearchCompleted = ref(false)
const searchSettings = ref({})
const searchPage = ref(1)
/** @type {import('vue').ShallowRef<import('youtubei.js').YT.Search | string | null>} */
const nextPageRef = shallowRef(null)
const shownResults = shallowRef([])
const paginationRevision = ref(0)
const searchNotice = shallowRef(null)
/** @type {import('vue').ShallowRef<import('../../helpers/search-correction').SearchCorrection | null>} */
const searchCorrection = shallowRef(null)
const spellCorrection = ref(true)
const searchParams = ref('')
const isRetryingWithCookies = ref(false)
const cookieSearchFailed = ref(false)
const supportsCookieSearch = supportsYtDlp && !process.env.IS_IOS
const cookiesConfigured = computed(() => hasConfiguredRestrictedPlaybackAuthentication(store.getters, supportsCookieSearch))
let searchRequestId = 0

const query = ref('')
const processedQuery = computed(() => query.value.trim())
const exhaustedSearchMessage = computed(() => shownResults.value.length === 0
  ? t('Channel.Your search results have returned 0 results')
  : t('Search Filters.There are no more results for this search'))

/** @type {import('vue').ComputedRef<any[]>} */
const sessionSearchHistory = computed(() => store.getters.getSessionSearchHistory)

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<boolean>} */
const showFamilyFriendlyOnly = computed(() => store.getters.getShowFamilyFriendlyOnly)

const isEmptyLocalSearch = computed(() => localSearchCompleted.value && apiUsed.value === 'local' && shownResults.value.length === 0)

// YouTube sometimes returns no usable results without an age-confirmation notice.
const showCookieRetryWithoutNotice = computed(() => supportsCookieSearch &&
  cookiesConfigured.value && !showFamilyFriendlyOnly.value && !searchNotice.value &&
  (cookieSearchFailed.value || isEmptyLocalSearch.value))

/** @type {import('vue').ComputedRef<boolean>} */
const rememberSearchHistory = computed(() => store.getters.getRememberSearchHistory)

function restoreActiveSearchFilters(settings) {
  store.commit('setSearchPrioritize', { tabId, value: settings.prioritize })
  store.commit('setSearchTime', { tabId, value: settings.time })
  store.commit('setSearchType', { tabId, value: settings.type })
  store.commit('setSearchDuration', { tabId, value: settings.duration })
  store.commit('setSearchFeatures', { tabId, value: [...settings.features] })
  store.commit('setSearchFilterValueChanged', {
    tabId,
    value: settings.prioritize !== 'relevance' ||
    settings.time !== '' ||
    settings.type !== 'all' ||
    settings.duration !== '' ||
    settings.features.length > 0
  })
}

function getRouteSearchSettings() {
  return getSearchSettingsFromRouteQuery(route.query)
}

/**
 * @param {string} searchQuery
 * @param {boolean} useSpellCorrection
 */
function getSearchRoute(searchQuery, useSpellCorrection) {
  const { spellCorrection: _, ...filters } = route.query
  return {
    path: `/search/${encodeURIComponent(searchQuery)}`,
    query: useSpellCorrection ? filters : { ...filters, spellCorrection: 'false' }
  }
}

watch(shownResults, () => {
  paginationRevision.value++
})

watch(route, () => {
  const query_ = route.params.query.trim()
  const searchSettings = getRouteSearchSettings()

  const payload = {
    query: query_,
    options: {},
    searchSettings: searchSettings,
    spellCorrection: route.query.spellCorrection !== 'false'
  }

  query.value = query_
  restoreActiveSearchFilters(searchSettings)

  setTabTitle(processedQuery.value)
  checkSearchCache(payload)
}, { deep: true })

// Android keeps a search page mounted for Back. Showing it again changes no
// route, so give the tab's shared filters back to the search on screen.
useTabLifecycle({
  afterNavigate: () => restoreActiveSearchFilters(getRouteSearchSettings())
})

watch(showFamilyFriendlyOnly, (enabled) => {
  // Replace unrestricted results and ignore responses still loading for them,
  // the setting cleared the search cache before this runs
  if (enabled) {
    checkSearchCache({
      query: processedQuery.value,
      options: {},
      searchSettings: getRouteSearchSettings(),
      spellCorrection: route.query.spellCorrection !== 'false'
    })
  }
})

onMounted(() => {
  query.value = route.params.query
  setTabTitle(processedQuery.value)

  searchSettings.value = getRouteSearchSettings()
  restoreActiveSearchFilters(searchSettings.value)

  const payload = {
    query: processedQuery.value,
    options: {},
    searchSettings: searchSettings.value,
    spellCorrection: route.query.spellCorrection !== 'false'
  }

  checkSearchCache(payload)
})

function updateSearchHistoryEntry(searchSettings) {
  const persistentSearchHistoryPayload = {
    query: processedQuery.value,
    lastUpdatedAt: Date.now(),
    searchSettings: {
      prioritize: searchSettings.prioritize,
      time: searchSettings.time,
      type: searchSettings.type,
      duration: searchSettings.duration,
      features: [...searchSettings.features]
    }
  }

  store.dispatch('updateSearchHistoryEntry', persistentSearchHistoryPayload)
}

function checkSearchCache(payload) {
  searchRequestId++
  // Other platforms search on their own
  if (searchPlatform.value !== 'youtube') {
    isLoading.value = false
    return
  }
  localSearchCompleted.value = false
  searchNotice.value = null
  searchCorrection.value = null
  spellCorrection.value = payload.spellCorrection ?? true
  searchParams.value = ''
  // Cached local results don't restore a page, so start Invidious pagination over.
  searchPage.value = 1
  cookieSearchFailed.value = false
  isRetryingWithCookies.value = false
  isLoadingMore.value = false
  nextPageFailed.value = false

  if (payload.query.length > SEARCH_CHAR_LIMIT) {
    isLoading.value = false
    shownResults.value = []
    nextPageRef.value = null
    hasMoreResults.value = false
    console.warn(`Search character limit is: ${SEARCH_CHAR_LIMIT}`)
    showToast({
      message: t('Search character limit', { searchCharacterLimit: SEARCH_CHAR_LIMIT }),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  const sameSearch = sessionSearchHistory.value.filter((search) => {
    return search.query === payload.query && searchFiltersMatch(payload.searchSettings, search.searchSettings) &&
      (search.spellCorrection ?? true) === spellCorrection.value
  })

  if (sameSearch.length > 0) {
    // No loading effect needed here, only rendered result update
    replaceShownResults(sameSearch[0])
  } else {
    // Show loading effect coz there will be network request(s)
    isLoading.value = true
    hasMoreResults.value = true
    searchSettings.value = payload.searchSettings

    switch (backendPreference.value) {
      case 'local':
        performSearchLocal(payload)
        break
      case 'invidious':
      case 'yattee':
        performSearchInvidious(payload, { resetSearchPage: true })
        break
    }
  }

  if (rememberSearchHistory.value) {
    updateSearchHistoryEntry(payload.searchSettings)
  }
}

async function performSearchLocal(payload) {
  isLoading.value = true
  const requestId = searchRequestId

  try {
    const response = await getLocalSearchResults(
      payload.query,
      payload.searchSettings,
      showFamilyFriendlyOnly.value,
      undefined,
      spellCorrection.value
    )
    if (requestId !== searchRequestId) return
    const { results, continuationData } = response
    searchNotice.value = response.searchNotice
    searchCorrection.value = response.searchCorrection
    searchParams.value = response.searchParams

    apiUsed.value = 'local'
    localSearchCompleted.value = true

    shownResults.value = results
    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    isLoading.value = false

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      searchNotice: searchNotice.value,
      searchCorrection: searchCorrection.value,
      searchParams: searchParams.value,
      spellCorrection: spellCorrection.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
    fillPublicationDates(payload.query, results)
  } catch (err) {
    if (requestId !== searchRequestId) return
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      await performSearchInvidious(payload)
    } else {
      isLoading.value = false
    }
  }
}

async function fillPublicationDates(query, results) {
  const requestId = searchRequestId
  const dates = await getLocalMissingPublicationDates(results)
  // Authenticated yt-dlp results replace these without a new request ID and stay out of the shared cache.
  if (dates.size === 0 || requestId !== searchRequestId || apiUsed.value !== 'local') return

  shownResults.value = applyPublicationDates(shownResults.value, dates)
  store.commit('addToSessionSearchHistory', {
    query,
    data: shownResults.value,
    searchSettings: searchSettings.value,
    spellCorrection: spellCorrection.value,
    apiUsed: apiUsed.value
  })
}

async function retrySearchWithCookies() {
  if (!cookiesConfigured.value || isRetryingWithCookies.value || showFamilyFriendlyOnly.value) return
  if (apiUsed.value !== 'yt-dlp') searchPage.value = 1
  await performSearchWithCookies()
}

async function performSearchWithCookies() {
  if (showFamilyFriendlyOnly.value) return
  const requestId = searchRequestId
  const page = searchPage.value
  isRetryingWithCookies.value = true
  cookieSearchFailed.value = false
  try {
    const response = await ytDlp.ytDlpSearch(processedQuery.value, searchParams.value, page)
    if (requestId !== searchRequestId || showFamilyFriendlyOnly.value) return
    if (!response || response.error || (page === 1 && response.results.length === 0)) {
      throw new Error('Authenticated search failed')
    }
    searchNotice.value = null
    shownResults.value = page === 1 ? response.results : shownResults.value.concat(response.results)
    apiUsed.value = 'yt-dlp'
    hasMoreResults.value = response.hasMoreResults
    nextPageRef.value = null
    searchPage.value++
    // Account-derived results stay in this tab and do not enter the shared cache.
    updateSubscriptionDetails(response.results)
  } catch {
    if (requestId === searchRequestId) {
      cookieSearchFailed.value = true
      if (page > 1) hasMoreResults.value = false
    }
  } finally {
    if (requestId === searchRequestId) isRetryingWithCookies.value = false
  }
}

async function getNextpageLocal(payload) {
  const requestId = searchRequestId
  try {
    const { results, continuationData } = await getLocalSearchContinuation(payload.options.nextPageRef)
    if (requestId !== searchRequestId) return

    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    apiUsed.value = 'local'

    shownResults.value = shownResults.value.concat(results)
    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      spellCorrection: spellCorrection.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
    fillPublicationDates(payload.query, results)
  } catch (err) {
    if (requestId !== searchRequestId) return
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    // Another backend can only start over at its first page, which would
    // replace the loaded results, so keep them and let the user retry.
    nextPageFailed.value = true
  }
}

async function performSearchInvidious(payload, options = { resetSearchPage: false }) {
  const requestId = searchRequestId
  if (options.resetSearchPage) {
    searchPage.value = 1
  }

  if (searchPage.value === 1) {
    isLoading.value = true
  }

  try {
    const results = await getInvidiousSearchResults(payload.query, searchPage.value, payload.searchSettings)
    if (requestId !== searchRequestId) return
    // An empty response is a failure; returning would leave the search loading.
    if (!results) throw new Error('Invidious returned no search results')

    hasMoreResults.value = results.length > 0

    apiUsed.value = 'invidious'
    // A local correction notice doesn't apply to Invidious results, e.g. after a failed local continuation.
    searchCorrection.value = null

    if (searchPage.value !== 1) {
      shownResults.value = shownResults.value.concat(results)
    } else {
      shownResults.value = results
    }

    isLoading.value = false

    searchPage.value++

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      searchPage: searchPage.value,
      hasMoreResults: hasMoreResults.value,
      searchNotice: searchNotice.value,
      searchCorrection: null,
      searchParams: searchParams.value,
      spellCorrection: spellCorrection.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    if (requestId !== searchRequestId) return
    console.error(err)

    const errorMessage = getInvidiousApiErrorMessage(backendPreference.value)
    showApiErrorToast(errorMessage, err)

    if (searchPage.value > 1) {
      // Keep the loaded results; see getNextpageLocal.
      nextPageFailed.value = true
    } else if (process.env.SUPPORTS_LOCAL_API && usesInvidiousApi(backendPreference.value) && backendFallback.value) {
      showInvidiousFallbackToast(backendPreference.value)
      await performSearchLocal(payload)
    } else {
      isLoading.value = false
    }
  }
}

async function nextPage() {
  if (isLoadingMore.value) {
    return
  }

  const requestId = searchRequestId
  nextPageFailed.value = false
  const payload = {
    query: processedQuery.value,
    searchSettings: searchSettings.value,
    options: {
      nextPageRef: nextPageRef.value
    }
  }

  if (apiUsed.value === 'yt-dlp') {
    isLoadingMore.value = true
    await performSearchWithCookies()
    if (requestId === searchRequestId) isLoadingMore.value = false
  } else if (apiUsed.value === 'local') {
    if (nextPageRef.value !== null) {
      isLoadingMore.value = true
      try {
        await getNextpageLocal(payload)
      } finally {
        if (requestId === searchRequestId) isLoadingMore.value = false
      }
    } else {
      showToast({ message: t('Search Filters.There are no more results for this search'), icon: ['fas', 'search'] })
    }
  } else {
    isLoadingMore.value = true
    try {
      await performSearchInvidious(payload)
    } finally {
      if (requestId === searchRequestId) isLoadingMore.value = false
    }
  }
}

function replaceShownResults(history) {
  query.value = history.query
  shownResults.value = history.data
  searchSettings.value = history.searchSettings
  apiUsed.value = history.apiUsed
  localSearchCompleted.value = history.apiUsed === 'local'
  searchNotice.value = history.searchNotice ?? null
  searchCorrection.value = history.searchCorrection ?? null
  searchParams.value = history.searchParams ?? ''
  nextPageRef.value = history.nextPageRef ?? null
  hasMoreResults.value = history.hasMoreResults ?? (
    history.apiUsed === 'local' ? nextPageRef.value !== null : true
  )

  if (typeof (history.searchPage) !== 'undefined') {
    searchPage.value = history.searchPage
  }

  // This is kept in case there is some race condition
  isLoading.value = false
}

/**
 * @param {any[]} results
 */
function updateSubscriptionDetails(results) {
  /** @type {Set<string>} */
  const subscribedChannelIds = store.getters.getSubscribedChannelIdSet

  const channels = []

  for (const result of results) {
    if (result.type !== 'channel' || !subscribedChannelIds.has(result.id ?? result.authorId)) {
      continue
    }

    if (result.dataSource === 'local') {
      channels.push({
        channelId: result.id,
        // Keep the saved name until the channel card resolves its original name.
        channelName: store.getters.getAvoidTranslation === 'entire_app' && !result.isGame ? undefined : result.name,
        channelThumbnailUrl: result.thumbnail.replace(/^\/\//, 'https://'),
        channelHandle: result.handle
      })
    } else {
      channels.push({
        channelId: result.authorId,
        channelName: result.author,
        // Yattee servers can return channels without avatars
        channelThumbnailUrl: result.authorThumbnails[0]?.url.replace(/^\/\//, 'https://'),
        channelHandle: result.channelHandle
      })
    }
  }

  if (channels.length === 1) {
    store.dispatch('updateSubscriptionDetails', channels[0])
  } else if (channels.length > 1) {
    store.dispatch('batchUpdateSubscriptionDetails', channels)
  }
}
</script>

<style scoped src="./SearchPage.css" />
