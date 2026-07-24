<template>
  <nav
    class="topNav"
    :class="{ topNavBarColor: barColor }"
  >
    <div class="topNavInner">
      <div class="side">
        <button
          class="menuButton navButton"
          :aria-label="expandCollapseSideBarLabel"
          :title="expandCollapseSideBarLabel"
          @click="toggleSideNav"
        >
          <FontAwesomeIcon
            class="navIcon"
            :icon="['fas', 'bars']"
          />
        </button>
        <FtIconButton
          class="navIconButton"
          :disabled="isArrowBackwardDisabled"
          :class="{ arrowDisabled: isArrowBackwardDisabled }"
          :icon="['fas', 'arrow-left']"
          :theme="null"
          :size="20"
          :use-shadow="false"
          dropdown-position-x="right"
          :dropdown-options="navigationHistoryDropdownOptions"
          open-on-right-or-long-click
          :title="backwardText"
          @click="historyBack"
        />
        <FtIconButton
          class="navIconButton"
          :disabled="isArrowForwardDisabled"
          :class="{ arrowDisabled: isArrowForwardDisabled }"
          :icon="['fas', 'arrow-right']"
          :theme="null"
          :size="20"
          :use-shadow="false"
          dropdown-position-x="right"
          :dropdown-options="navigationHistoryDropdownOptions"
          open-on-right-or-long-click
          :title="forwardText"
          @click="historyForward"
        />
        <button
          v-if="!hideSearchBar"
          class="navSearchButton navButton"
          @click="toggleSearchContainer"
        >
          <FontAwesomeIcon
            class="navIcon"
            :icon="['fas', 'search']"
          />
        </button>
        <button
          class="navNewWindowButton navButton"
          :aria-label="t('Open New Window')"
          :title="newWindowText"
          @click="createNewWindow"
        >
          <FontAwesomeIcon
            class="navIcon"
            :icon="['fas', 'clone']"
          />
        </button>
        <button
          v-if="isElectron"
          class="navTabLayoutButton navButton"
          :aria-label="tabLayoutText"
          :title="tabLayoutText"
          @click="toggleVerticalTabBar"
        >
          <FontAwesomeIcon
            class="navIcon"
            :icon="tabLayoutIcon"
          />
        </button>
        <RouterLink
          v-if="!hideHeaderLogo"
          class="logo"
          dir="ltr"
          :title="headerLogoTitle"
          :to="landingPage"
        >
          <div
            class="logoIcon"
          />
          <div
            class="logoText"
          />
        </RouterLink>
      </div>
      <div class="middle">
        <div
          v-if="!hideSearchBar"
          v-show="showSearchContainer"
          ref="searchContainer"
          class="searchContainer"
        >
          <FtInput
            ref="searchInput"
            :placeholder="t('Search / Go to URL')"
            class="searchInput"
            is-search
            :data-list="activeDataList"
            :data-list-properties="activeDataListProperties"
            show-clear-text-button
            show-data-when-empty
            @input="getSearchSuggestionsDebounce"
            @click="goToSearch"
            @clear="clearLastSuggestionQuery"
            @remove="removeSearchHistoryEntryInDbAndCache"
          >
            <template #extraAction>
              <button
                type="button"
                class="navFilterButton navButton"
                :class="{ filterChanged: searchFilterValueChanged }"
                :aria-label="t('Search Filters.Search Filters')"
                :title="t('Search Filters.Search Filters')"
                @click="showSearchFilters"
              >
                <FontAwesomeIcon
                  class="navIcon"
                  :icon="['fas', 'filter']"
                />
              </button>
            </template>
          </FtInput>
        </div>
      </div>
      <div class="side profiles">
        <FtThumbnailSizeControl v-if="showThumbnailSizeControl" />
        <FtProfileSelector v-if="!hideProfileSelectorInHeader" />
      </div>
    </div>
  </nav>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import FtInput from '../FtInput/FtInput.vue'
import FtProfileSelector from '../FtProfileSelector/FtProfileSelector.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtThumbnailSizeControl from '../FtThumbnailSizeControl/FtThumbnailSizeControl.vue'

import store from '../../store/index'

import { getConfiguredKeyboardShortcuts, MOBILE_WIDTH_THRESHOLD, SEARCH_RESULTS_DISPLAY_LIMIT } from '../../../constants'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { debounce, localizeAndAddKeyboardShortcutToActionTitle, openInternalPath } from '../../helpers/utils'
import { translateWindowTitle } from '../../helpers/strings'
import { clearLocalSearchSuggestionsSession, getLocalSearchSuggestions } from '../../helpers/api/local'
import { getInvidiousSearchSuggestions } from '../../helpers/api/invidious'
import { getTabNavigationService } from '../../tabs/TabNavigationService'

const { t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)
const router = useRouter()
const route = useRoute()
const navigation = process.env.IS_ELECTRON ? getTabNavigationService() : null

const showSearchContainer = ref(true)
const logicalHistoryState = computed(() => {
  const tabId = store.getters.getPresentedTabId
  return store.getters.getTabHistoryState(tabId)
})
const navigationHistoryDropdownOptions = computed(() => {
  return process.env.IS_ELECTRON ? logicalHistoryState.value.options : []
})
/** @type {import('vue').ShallowRef<string[]>} */
const searchSuggestionsDataList = shallowRef([])
const lastSuggestionQuery = ref('')

/** @type {import('vue').ComputedRef<boolean>} */
const hideSearchBar = computed(() => store.getters.getHideSearchBar)
/** @type {import('vue').ComputedRef<boolean>} */
const hideHeaderLogo = computed(() => store.getters.getHideHeaderLogo)
/** @type {import('vue').ComputedRef<boolean>} */
const hideProfileSelectorInHeader = computed(() => store.getters.getHideProfileSelectorInHeader)
const useWatchSideNavOverlay = computed(() => {
  return store.getters.getHideSideBarOnWatchPages && route.path.startsWith('/watch/')
})
/** @type {import('vue').ComputedRef<boolean>} */
const enableSearchSuggestions = computed(() => store.getters.getEnableSearchSuggestions)
/** @type {import('vue').ComputedRef<string>} */
const barColor = computed(() => store.getters.getBarColor)
const showThumbnailSizeControl = computed(() => {
  return route.meta.hasResizableThumbnails === true && store.getters.getShowThumbnailSizeButtonInHeader
})

const expandCollapseSideBarLabel = computed(() => {
  return store.getters.getIsSideNavOpen ? t('Compact side navigation') : t('Expand side navigation')
})

const landingPage = computed(() => '/' + store.getters.getLandingPage)

const headerLogoTitle = computed(() => {
  return t('Go to page', {
    page: translateWindowTitle(
      router.getRoutes()
        .find((route) => route.path === landingPage.value)
        .meta.title)
  })
})

const navigationHistoryAddendum = computed(() => {
  return navigationHistoryDropdownOptions.value.length === 0
    ? ''
    : `\n${t('Right-click or hold to see history')}`
})

const backwardText = computed(() => {
  const shortcuts = process.platform === 'darwin'
    ? [
        appKeyboardShortcuts.value.HISTORY_BACKWARD,
        appKeyboardShortcuts.value.HISTORY_BACKWARD_ALT_MAC
      ]
    : appKeyboardShortcuts.value.HISTORY_BACKWARD

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Back'),
    shortcuts
  ) + navigationHistoryAddendum.value
})

const forwardText = computed(() => {
  const shortcuts = process.platform === 'darwin'
    ? [
        appKeyboardShortcuts.value.HISTORY_FORWARD,
        appKeyboardShortcuts.value.HISTORY_FORWARD_ALT_MAC
      ]
    : appKeyboardShortcuts.value.HISTORY_FORWARD

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Forward'),
    shortcuts
  ) + navigationHistoryAddendum.value
})

/**
 * @param {number} offset
 */
function goToOffset(offset) {
  if (offset === 0) {
    return
  }

  if (process.env.IS_ELECTRON) {
    const tabId = store.getters.getPresentedTabId
    if (tabId) {
      navigation.go(tabId, offset)
    }
  } else {
    router.go(offset)
  }
}

/**
 * @param {number} [offset]
 */
function historyBack(offset) {
  goToOffset(offset ?? -1)
}

/**
 * @param {number} [offset]
 */
function historyForward(offset) {
  goToOffset(offset ?? 1)
}

const newWindowText = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('Open New Window'),
    appKeyboardShortcuts.value.NEW_WINDOW
  )
})

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const useVerticalTabBar = computed(() => store.getters.getUseVerticalTabBar)

const tabLayoutText = computed(() => {
  return useVerticalTabBar.value ? t('Use Horizontal Tabs') : t('Use Vertical Tabs')
})

// Show the layout the button switches to
const tabLayoutIcon = computed(() => {
  return useVerticalTabBar.value ? ['fac', 'horizontal-tabs'] : ['fac', 'vertical-tabs']
})

function toggleVerticalTabBar() {
  store.dispatch('updateUseVerticalTabBar', !useVerticalTabBar.value)
}

function createNewWindow() {
  // In the Electron build, use the dedicated IPC-based helper so that a real
  // new BrowserWindow is created instead of a new tab via window.open.
  if (process.env.IS_ELECTRON) {
    openInternalPath({
      path: landingPage.value,
      doCreateNewWindow: true
    })
  } else {
    const url = new URL(window.location.href)
    url.hash = landingPage.value
    window.open(url.toString(), '_blank', 'noreferrer')
  }
}

const usingOnlySearchHistoryResults = computed(() => lastSuggestionQuery.value.length === 0)

/** @type {import('vue').ComputedRef<string[]>} */
const latestMatchingSearchHistoryNames = computed(() => {
  return store.getters.getLatestMatchingSearchHistoryNames(lastSuggestionQuery.value)
})

/** @type {import('vue').ComputedRef<string[]>} */
const latestSearchHistoryNames = computed(() => store.getters.getLatestSearchHistoryNames)

const activeDataList = computed(() => {
  // show latest search history when the search bar is empty
  if (usingOnlySearchHistoryResults.value) {
    return latestSearchHistoryNames.value
  }

  const searchResults = [...latestMatchingSearchHistoryNames.value]

  if (enableSearchSuggestions.value) {
    for (const searchSuggestion of searchSuggestionsDataList.value) {
      // prevent duplicate results between search history entries and YT search suggestions
      if (latestMatchingSearchHistoryNames.value.includes(searchSuggestion)) {
        continue
      }

      searchResults.push(searchSuggestion)

      if (searchResults.length === SEARCH_RESULTS_DISPLAY_LIMIT) {
        break
      }
    }
  }

  return searchResults
})

const activeDataListProperties = computed(() => {
  const searchHistoryEntriesCount = usingOnlySearchHistoryResults.value
    ? latestSearchHistoryNames.value.length
    : latestMatchingSearchHistoryNames.value.length

  const properties = []

  for (let i = 0; i < activeDataList.value.length; i++) {
    properties.push(i < searchHistoryEntriesCount
      ? { isRemoveable: true, isSearchHistory: true, iconName: 'clock-rotate-left' }
      : { isRemoveable: false, isSearchHistory: false, iconName: 'magnifying-glass' }
    )
  }

  return properties
})

const isArrowBackwardDisabled = computed(() => {
  if (process.env.IS_ELECTRON) {
    return !logicalHistoryState.value.canGoBack
  }

  // Reading the route makes this computed refresh after browser navigation.
  const hasCurrentRoute = typeof route.fullPath === 'string'
  return hasCurrentRoute && 'navigation' in window ? !window.navigation.canGoBack : false
})
const isArrowForwardDisabled = computed(() => {
  if (process.env.IS_ELECTRON) {
    return !logicalHistoryState.value.canGoForward
  }

  const hasCurrentRoute = typeof route.fullPath === 'string'
  return hasCurrentRoute && 'navigation' in window ? !window.navigation.canGoForward : false
})

function toggleSideNav() {
  store.commit('toggleSideNav')
}

/** @type {import('vue').ComputedRef<boolean>} */
const searchFilterTabId = computed(() => process.env.IS_ELECTRON
  ? (store.getters.getPresentedTabId ?? 'web')
  : 'web')
const searchFilterValueChanged = computed(() => {
  return store.getters.getSearchFilterValueChanged(searchFilterTabId.value)
})

function showSearchFilters() {
  store.dispatch('showSearchFilters')
}

const searchContainer = useTemplateRef('searchContainer')
const searchInput = useTemplateRef('searchInput')

// The search bar renders once for the whole window and is shared by every
// logical tab, so its text has to be persisted per tab to stay independent.
// Mirror the live input value here since FtInput doesn't expose a getter.
const searchTextByTabId = new Map()
let currentSearchText = ''

/**
 * @param {string} tabId
 * @returns {string}
 */
function getSearchTextForTab(tabId) {
  if (searchTextByTabId.has(tabId)) {
    return searchTextByTabId.get(tabId) ?? ''
  }

  const path = store.getters.getTabById(tabId)?.route.path ?? ''
  const encodedQuery = path.match(/^\/search\/(.+)$/)?.[1]
  if (encodedQuery == null) {
    return ''
  }

  try {
    return decodeURIComponent(encodedQuery)
  } catch {
    return encodedQuery
  }
}

if (process.env.IS_ELECTRON) {
  const presentedTabId = computed(() => store.getters.getPresentedTabId)

  watch(presentedTabId, (tabId, previousTabId) => {
    // Skip the initial null -> id transition during startup so we don't clobber
    // text that was pre-filled for this tab (e.g. a search carried into a new
    // window). A search route is the exception: restored tabs have no cached
    // input text, so hydrate it from the route itself.
    if (previousTabId == null) {
      if (tabId != null) {
        const searchText = getSearchTextForTab(tabId)
        if (searchText.length > 0) {
          updateSearchInputText(searchText)
        }
      }
      return
    }

    searchTextByTabId.set(previousTabId, currentSearchText)
    updateSearchInputText(tabId != null ? getSearchTextForTab(tabId) : '')
    clearLastSuggestionQuery()
  })
}

/** @type {import('vue').ComputedRef<any>} */
const searchSettings = computed(() => store.getters.getSearchSettings(searchFilterTabId.value))

/**
 * @param {string} queryText
 * @param {object} options
 * @param {MouseEvent | KeyboardEvent} options.event
 * @param {number} [options.dataListIndex]
 */
function goToSearch(queryText, { event, dataListIndex }) {
  const doCreateNewWindow = event && event.shiftKey
  const ctrlOrCmdPressed = event && ((process.platform !== 'darwin' && event.ctrlKey) ||
    (process.platform === 'darwin' && event.metaKey))
  const doCreateNewTab = ctrlOrCmdPressed && !doCreateNewWindow

  if (window.innerWidth <= MOBILE_WIDTH_THRESHOLD) {
    searchContainer.value.blur()
    showSearchContainer.value = false
  } else {
    searchInput.value.blur()
  }

  clearLocalSearchSuggestionsSession()

  const selectedSearchHistoryEntry = activeDataListProperties.value[dataListIndex]?.isSearchHistory
    ? store.getters.getSearchHistoryEntryWithId(queryText)
    : null
  const selectedSearchSettings = selectedSearchHistoryEntry?.searchSettings

  if (selectedSearchSettings != null) {
    const tabId = searchFilterTabId.value
    store.commit('setSearchPrioritize', { tabId, value: selectedSearchSettings.prioritize })
    store.commit('setSearchTime', { tabId, value: selectedSearchSettings.time })
    store.commit('setSearchType', { tabId, value: selectedSearchSettings.type })
    store.commit('setSearchDuration', { tabId, value: selectedSearchSettings.duration })
    store.commit('setSearchFeatures', { tabId, value: [...selectedSearchSettings.features] })
    store.commit('setSearchFilterValueChanged', {
      tabId,
      value: selectedSearchSettings.prioritize !== 'relevance' ||
      selectedSearchSettings.time !== '' ||
      selectedSearchSettings.type !== 'all' ||
      selectedSearchSettings.duration !== '' ||
      selectedSearchSettings.features.length > 0
    })
  }

  store.dispatch('getYoutubeUrlInfo', queryText).then((result) => {
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
          searchQueryText: queryText,
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
          searchQueryText: queryText,
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
          searchQueryText: searchQuery,
        })
        break
      }

      case 'hashtag': {
        const { hashtag } = result
        openInternalPath({
          path: `/hashtag/${encodeURIComponent(hashtag)}`,
          doCreateNewWindow,
          doCreateNewTab,
          searchQueryText: `#${hashtag}`,
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
          searchQueryText: queryText,
        })
        break
      }

      case 'channel': {
        const { channelId, subPath, url } = result

        openInternalPath({
          path: `/channel/${channelId}/${subPath}`,
          doCreateNewWindow,
          doCreateNewTab,
          query: {
            url,
          },
          searchQueryText: queryText,
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
          searchQueryText: queryText
        })
        break

      case 'invalid_url':
      default: {
        const settings = selectedSearchSettings ?? searchSettings.value
        openInternalPath({
          path: `/search/${encodeURIComponent(queryText)}`,
          query: {
            prioritize: settings.prioritize,
            time: settings.time,
            type: settings.type,
            duration: settings.duration,
            // Array proxy cannot be cloned during IPC call
            features: [...settings.features],
          },
          doCreateNewWindow,
          doCreateNewTab,
          searchQueryText: queryText,
        })
      }
    }

    if (doCreateNewWindow) {
      // Query text copied to new window = can be removed from current window
      updateSearchInputText('')
    }
  })
}

function clearLastSuggestionQuery() {
  lastSuggestionQuery.value = ''
}

/**
 * @param {string} text
 */
function updateSearchInputText(text) {
  currentSearchText = text
  searchInput.value?.setText(text)
}

/**
 * @param {string} query
 */
function getSearchSuggestionsDebounce(query) {
  currentSearchText = query

  if (query === lastSuggestionQuery.value) {
    return
  }

  lastSuggestionQuery.value = query

  if (enableSearchSuggestions.value) {
    debounceSearchResults(query.trim())
  }
}

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)
/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const debounceSearchResults = debounce(/** @param {string} query */(query) => {
  if (!process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious') {
    getSearchSuggestionsInvidious(query)
  } else {
    getSearchSuggestionsLocal(query)
  }
}, 200)

/**
 * @param {string} query
 */
async function getSearchSuggestionsLocal(query) {
  searchSuggestionsDataList.value = query.length > 0
    ? await getLocalSearchSuggestions(query)
    : []
}

async function getSearchSuggestionsInvidious(query) {
  if (query === '') {
    searchSuggestionsDataList.value = []
    return
  }

  try {
    searchSuggestionsDataList.value = (await getInvidiousSearchSuggestions(query)).suggestions
  } catch (err) {
    console.error(err)

    if (process.env.SUPPORTS_LOCAL_API && backendFallback.value) {
      console.error(
        'Error gettings search suggestions.  Falling back to Local API'
      )
      getSearchSuggestionsLocal(query)
    }
  }
}

/**
 * @param {string} query
 */
function removeSearchHistoryEntryInDbAndCache(query) {
  store.dispatch('removeSearchHistoryEntry', query)
  store.commit('removeFromSessionSearchHistory', query)
}

function toggleSearchContainer() {
  showSearchContainer.value = !showSearchContainer.value
}

/**
 * @param {KeyboardEvent} event
 */
function handleKeyboardShortcuts(event) {
  const target = event.target
  const isTypingInInput = target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  const shortcuts = appKeyboardShortcuts.value
  const focusSearchShortcut = [
    shortcuts.FOCUS_SEARCH,
    shortcuts.FOCUS_SEARCH_ALT,
    ...process.platform === 'darwin' ? [shortcuts.FOCUS_SEARCH_ALT_MAC] : [],
  ].some(shortcut => matchesKeyboardShortcut(event, shortcut))
  const slashShortcut = matchesKeyboardShortcut(event, shortcuts.FOCUS_SEARCH_ALT_SLASH)

  if (
    !hideSearchBar.value &&
    (focusSearchShortcut || (slashShortcut && !isTypingInInput))
  ) {
    event.preventDefault()

    // In order to prevent Klipper's "Synchronize contents of the clipboard
    // and the selection" feature from being triggered when running
    // Chromium on KDE Plasma, it seems both focus() focus and
    // select() have to be called asynchronously (see issue #2019).
    setTimeout(() => {
      searchInput.value?.focus()
      searchInput.value?.select()
    }, 0)
  }
}

let previousWindowWidth

function handleWindowResize() {
  // Don't change the status of showSearchContainer if only the height of the window changes
  // Opening the virtual keyboard can trigger this resize event, but it won't change the width
  if (previousWindowWidth !== window.innerWidth) {
    showSearchContainer.value = window.innerWidth > MOBILE_WIDTH_THRESHOLD
    previousWindowWidth = window.innerWidth
  }
}

onMounted(() => {
  previousWindowWidth = window.innerWidth
  if (window.innerWidth <= MOBILE_WIDTH_THRESHOLD) {
    showSearchContainer.value = false
  }

  // Store is not up-to-date when the component mounts, so we use timeout.
  setTimeout(() => {
    if (store.getters.getExpandSideBar && !useWatchSideNavOverlay.value) {
      toggleSideNav()
    }
  }, 0)

  window.addEventListener('resize', handleWindowResize)

  if (process.env.IS_ELECTRON) {
    window.addEventListener('keydown', handleKeyboardShortcuts)

    const tabId = store.getters.getPresentedTabId
    const searchText = tabId != null ? getSearchTextForTab(tabId) : ''
    if (currentSearchText.length === 0 && searchText.length > 0) {
      updateSearchInputText(searchText)
    }

    window.ftElectron.handleUpdateSearchInputText((searchQueryText) => {
      if (searchQueryText) {
        updateSearchInputText(searchQueryText)
      }
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)

  if (process.env.IS_ELECTRON) {
    window.removeEventListener('keydown', handleKeyboardShortcuts)

    window.ftElectron.handleUpdateSearchInputText(null)
  }
})
</script>

<style scoped lang="scss" src="./TopNav.scss" />
