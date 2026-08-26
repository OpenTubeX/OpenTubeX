<template>
  <div
    class="trendingPage"
    :class="{ hasTabBar: hasHorizontalTabBar }"
  >
    <FtCard
      class="card"
    >
      <div class="pageHeader">
        <div class="titleRow">
          <h2 class="pageTitle">
            <FtIcon
              :icon="['fas', 'fire']"
              class="trendingIcon"
            />
            {{ $t("Trending.Trending") }}
          </h2>
          <FtRefreshWidget
            embedded
            class="headerRefreshWidget"
            :disable-refresh="isLoading[currentTab]"
            :last-refresh-timestamp="lastTrendingRefreshTimestamp"
            :title="$t('Trending.Trending')"
            @click="getTrendingInfo(true)"
          />
        </div>
        <FtFlexBox
          class="trendingInfoTabs"
          role="tablist"
          :aria-label="$t('Trending.Trending Tabs')"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
          <div
            ref="gamingTab"
            class="tab"
            role="tab"
            :aria-selected="currentTab === 'gaming'"
            aria-controls="trendingPanel"
            :tabindex="currentTab === 'gaming' ? 0 : -1"
            :class="{ selectedTab: currentTab === 'gaming' }"
            @click="changeTab('gaming')"
            @keydown.space.enter.prevent="changeTab('gaming')"
            @keydown.left="focusTab('podcasts', $event)"
            @keydown.right="focusTab('sports', $event)"
          >
            <FtIcon
              :icon="['fas', 'gamepad']"
              class="trendingIcon"
            />
            {{ $t("Trending.Gaming") }}
          </div>
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
          <div
            ref="sportsTab"
            class="tab"
            role="tab"
            :aria-selected="currentTab === 'sports'"
            aria-controls="trendingPanel"
            :tabindex="currentTab === 'sports' ? 0 : -1"
            :class="{ selectedTab: currentTab === 'sports' }"
            @click="changeTab('sports')"
            @keydown.space.enter.prevent="changeTab('sports')"
            @keydown.left="focusTab('gaming', $event)"
            @keydown.right="focusTab('podcasts', $event)"
          >
            <FtIcon
              :icon="['fas', 'trophy']"
              class="trendingIcon"
            />
            {{ t("Trending.Sports") }}
          </div>
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
          <div
            ref="podcastsTab"
            class="tab"
            role="tab"
            :aria-selected="currentTab === 'podcasts'"
            aria-controls="trendingPanel"
            :tabindex="currentTab === 'podcasts' ? 0 : -1"
            :class="{ selectedTab: currentTab === 'podcasts' }"
            @click="changeTab('podcasts')"
            @keydown.space.enter.prevent="changeTab('podcasts')"
            @keydown.left="focusTab('sports', $event)"
            @keydown.right="focusTab('gaming', $event)"
          >
            <FtIcon
              :icon="['fas', 'podcast']"
              class="trendingIcon"
            />
            {{ t("Channel.Podcasts.Podcasts") }}
          </div>
        </FtFlexBox>
      </div>
      <div
        id="trendingPanel"
        role="tabpanel"
      >
        <FtLoader
          v-if="isLoading[currentTab]"
        />
        <p
          v-else-if="currentErrorMessage"
          class="statusMessage"
          role="status"
        >
          {{ currentErrorMessage }}
        </p>
        <FtElementList
          v-else
          :key="currentTab"
          appear
          :data="shownResults"
        />
      </div>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'

import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'

import { getRelativeTimeFromDate, showApiErrorToast } from '../../helpers/utils'
import { useTabToast } from '../../composables/useTabToast'
import { getLocalTrending } from '../../helpers/api/local'
import { KeyboardShortcuts } from '../../../constants'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'

const { t } = useI18n()
const showTabToast = useTabToast()

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const hasHorizontalTabBar = computed(() => isElectron && store.getters.getTabBarPosition === 'top')

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

const relativeTimeNow = useRelativeTimeClock()

const lastTrendingRefreshTimestamp = computed(() => {
  return getRelativeTimeFromDate(store.getters.getLastTrendingRefreshTimestamp[currentTab.value], true, true, relativeTimeNow.value)
})

/** @type {import('vue').ComputedRef<string>} */
const region = computed(() => {
  return store.getters.getRegion.toUpperCase()
})

/** @type {import('vue').ComputedRef<{ gaming: any[] | null, sports: any[] | null, podcasts: any[] | null }>} */
const trendingCache = computed(() => {
  return store.getters.getTrendingCache
})

const isLoading = ref({ gaming: false, sports: false, podcasts: false })
const errorMessages = ref({ gaming: null, sports: null, podcasts: null })

const { tabId } = useTabContext()
const currentTabStorageKey = tabId ? `Trending/${tabId}/currentTab` : 'Trending/currentTab'

/** @type {import('vue').Ref<'gaming' | 'sports' | 'podcasts'>} */
const currentTab = ref('gaming')

const isBackendSupported = computed(() => {
  return process.env.SUPPORTS_LOCAL_API && (backendFallback.value || backendPreference.value === 'local')
})

const currentErrorMessage = computed(() => {
  if (!isBackendSupported.value) {
    return t('Trending.Unsupported Backend')
  }

  return errorMessages.value[currentTab.value]
})

const shownResults = computed(() => {
  return trendingCache.value[currentTab.value] ?? []
})

// Restore last used tab so navigating into a video and back returns here
const lastCurrentTabId = sessionStorage.getItem(currentTabStorageKey)
if (lastCurrentTabId !== null && Object.hasOwn(isLoading.value, lastCurrentTabId)) {
  currentTab.value = lastCurrentTabId
}

const cacheEntry = trendingCache.value[currentTab.value]

if (cacheEntry === null) {
  onMounted(() => {
    getTrendingInfo()
  })
}

function getTrendingInfo(refresh = false) {
  const category = currentTab.value

  if (isLoading.value[category]) {
    return
  }

  if (!isBackendSupported.value) {
    return
  }

  if (refresh) {
    store.commit('clearTrendingCache', category)
  }

  getTrendingInfoLocal(category)
}

/**
 * @param {'gaming' | 'sports' | 'podcasts'} category
 */
async function getTrendingInfoLocal(category) {
  isLoading.value[category] = true
  errorMessages.value[category] = null

  try {
    const results = await getLocalTrending(region.value, category)

    store.commit('setTrendingCache', { value: results, page: category })
    store.commit('setLastTrendingRefreshTimestamp', { page: category, timestamp: new Date() })

    if (currentTab.value === category) {
      nextTick(() => {
        if (currentTab.value === category) {
          focusTab(category)
        }
      })
    }
  } catch (error) {
    console.error(error)
    errorMessages.value[category] = t('Trending.Load Error')

    if (currentTab.value === category) {
      const errorMessage = t('Local API Error (Click to copy)')
      showApiErrorToast(errorMessage, error, showTabToast)
    }
  } finally {
    isLoading.value[category] = false
  }
}

const gamingTab = useTemplateRef('gamingTab')
const sportsTab = useTemplateRef('sportsTab')
const podcastsTab = useTemplateRef('podcastsTab')

/**
 * @param {'gaming' | 'sports' | 'podcasts'} tab
 * @param {KeyboardEvent | undefined} event
 */
function focusTab(tab, event = undefined) {
  if (event) {
    if (event.altKey) { return }

    event.preventDefault()
    store.dispatch('showOutlines')
  }

  switch (tab) {
    case 'gaming':
      gamingTab.value?.focus()
      break
    case 'sports':
      sportsTab.value?.focus()
      break
    case 'podcasts':
      podcastsTab.value?.focus()
      break
  }
}

/**
 * @param {'gaming' | 'sports' | 'podcasts'} tab
 */
function changeTab(tab) {
  if (tab === currentTab.value) {
    return
  }

  currentTab.value = tab

  // Save last used tab, restored when the view is mounted again
  sessionStorage.setItem(currentTabStorageKey, tab)

  const cacheEntry = trendingCache.value[tab]

  if (cacheEntry === null && !isLoading.value[tab] && errorMessages.value[tab] === null) {
    getTrendingInfo()
  }
}

/**
 * @param {KeyboardEvent} event the keyboard event
 */
function keyboardShortcutHandler(event) {
  if (document.activeElement.classList.contains('ft-input')) {
    return
  }

  // Avoid handling events due to user holding a key (not released)
  // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat
  if (event.repeat) { return }

  if (
    matchesKeyboardShortcut(event, KeyboardShortcuts.APP.SITUATIONAL.REFRESH) &&
    !isLoading.value[currentTab.value]
  ) {
    getTrendingInfo(true)
  }
}

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})
</script>

<style scoped src="./Trending.css" />
