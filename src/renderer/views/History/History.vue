<template>
  <div>
    <FtCard
      class="card"
    >
      <div class="headingRow">
        <h2>
          <FtIcon
            :icon="['fas', 'history']"
            class="headingIcon"
          />
          {{ t('History.History') }}
        </h2>
        <div
          v-if="historyCacheSorted.length > 0"
          class="headingActions"
        >
          <FtButton
            class="historyActionButton"
            :label="t('History.Mark All As Watched')"
            :icon="['fas', 'eye']"
            :disabled="!hasUnwatchedHistory"
            background-color="var(--primary-color)"
            text-color="var(--text-with-main-color)"
            @click="showMarkAllPrompt = true"
          />
          <FtButton
            class="historyActionButton"
            :label="t('History.Delete Old History')"
            :icon="['fas', 'trash']"
            theme="destructive"
            @click="showHistoryCleanupPrompt = true"
          />
        </div>
      </div>
      <FtInput
        v-show="fullData.length > 1"
        ref="searchBar"
        :placeholder="t('History.Search bar placeholder')"
        :show-clear-text-button="true"
        :show-action-button="false"
        :value="query"
        @input="handleQueryChange"
        @clear="() => handleQueryChange('')"
      />
      <div
        v-if="fullData.length > 1"
        class="optionsRow"
      >
        <div
          class="toggleOptions"
        >
          <FtToggleSwitch
            :label="t('History.Case Sensitive Search')"
            :compact="true"
            :default-value="doCaseSensitiveSearch"
            @change="doCaseSensitiveSearch = !doCaseSensitiveSearch"
          />
        </div>
        <FtSelect
          class="sortSelect"
          :placeholder="t('Global.Sort By')"
          :value="sortBy"
          :select-names="sortByNames"
          :select-values="SORT_BY_VALUES"
          :icon="sortByIcon"
          @change="updateUserHistorySortBy"
        />
      </div>
      <FtFlexBox
        v-if="fullData.length === 0"
      >
        <p class="message">
          {{ t("History['Your history list is currently empty.']") }}
        </p>
      </FtFlexBox>
      <FtFlexBox
        v-else-if="activeData.length === 0"
      >
        <p class="message">
          {{ t("History['Empty Search Message']") }}
        </p>
      </FtFlexBox>
      <FtElementList
        v-if="activeData.length > 0"
        :data="activeData"
        :stable-item-keys="true"
        :show-video-with-last-viewed-playlist="true"
        :show-watched-style-in-history="true"
        :use-channels-hidden-preference="false"
        :hide-forbidden-titles="false"
      />
      <FtAutoLoadNextPageWrapper
        v-if="showLoadMoreButton"
        @load-next-page="increaseLimit"
      >
        <FtFlexBox>
          <FtButton
            :label="t('Subscriptions.Load More Videos')"
            background-color="var(--primary-color)"
            text-color="var(--text-with-main-color)"
            @click="increaseLimit"
          />
        </FtFlexBox>
      </FtAutoLoadNextPageWrapper>
      <FtPrompt
        v-if="showMarkAllPrompt"
        autosize
        :label="t('History.Mark All As Watched Confirmation')"
        :option-names="markAllPromptNames"
        :option-values="MARK_ALL_PROMPT_VALUES"
        @click="handleMarkAllPrompt"
      />
      <FtPrompt
        v-if="showHistoryCleanupPrompt"
        autosize
        theme="slim"
        @click="closeHistoryCleanupPrompt"
      >
        <template #label="{ labelId }">
          <h2
            :id="labelId"
            class="cleanupPromptTitle"
          >
            {{ t('History.Delete Old History') }}
          </h2>
        </template>
        <div class="cleanupPromptContent">
          <p>
            {{ t('History.Select History Age') }}
          </p>
          <FtSelect
            :placeholder="t('History.Delete Entries Older Than')"
            :value="historyCleanupPeriod"
            :select-names="historyCleanupPeriodNames"
            :select-values="HISTORY_CLEANUP_PERIOD_VALUES"
            :icon="['fas', 'calendar-days']"
            @change="historyCleanupPeriod = $event"
          />
          <FtInput
            v-if="historyCleanupPeriod === 'custom'"
            :placeholder="t('History.Number of Days')"
            input-type="number"
            :value="customHistoryCleanupDays"
            :show-action-button="false"
            @input="customHistoryCleanupDays = $event"
          />
          <p class="cleanupWarning">
            {{ t('History.History Cleanup Warning') }}
          </p>
          <FtFlexBox>
            <FtButton
              :label="t('Delete')"
              :icon="['fas', 'trash']"
              theme="destructive"
              :disabled="historyCleanupDays === null"
              @click="deleteOldHistory"
            />
            <FtButton
              :label="t('Cancel')"
              :text-color="null"
              :background-color="null"
              @click="closeHistoryCleanupPrompt"
            />
          </FtFlexBox>
        </div>
      </FtPrompt>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'

import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtToggleSwitch from '../../components/FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store'

import { canMarkHistoryEntryAsWatched } from '../../helpers/history'
import { ctrlFHandler, debounce, getIconForSortPreference, showToast } from '../../helpers/utils'
import { useTabContext } from '../../tabs/TabContext'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { tabId } = useTabContext()
const dataLimitStorageKey = tabId ? `History/${tabId}/dataLimit` : 'History/dataLimit'

const oldDataLimit = sessionStorage.getItem(dataLimitStorageKey)
const dataLimit = ref(oldDataLimit !== null ? parseInt(oldDataLimit) : 100)

const searchDataLimit = ref(100)
const doCaseSensitiveSearch = ref(false)
const showLoadMoreButton = ref(false)
const query = ref('')
const activeData = ref([])
const historyCleanupPeriod = ref('30')
const customHistoryCleanupDays = ref('')
const showMarkAllPrompt = ref(false)
const showHistoryCleanupPrompt = ref(false)

const MARK_ALL_PROMPT_VALUES = ['confirm', 'cancel']
const markAllPromptNames = computed(() => [
  t('History.Mark All As Watched'),
  t('Cancel')
])

const HISTORY_CLEANUP_PERIOD_VALUES = ['1', '7', '30', '90', '365', 'custom']
const historyCleanupPeriodNames = computed(() => [
  t('History.1 Day'),
  t('History.1 Week'),
  t('History.1 Month'),
  t('History.3 Months'),
  t('History.1 Year'),
  t('History.Custom')
])

const historyCleanupDays = computed(() => {
  const value = historyCleanupPeriod.value === 'custom'
    ? customHistoryCleanupDays.value
    : historyCleanupPeriod.value
  const days = Number(value)

  return Number.isInteger(days) && days > 0 ? days : null
})

function closeHistoryCleanupPrompt() {
  showHistoryCleanupPrompt.value = false
}

async function deleteOldHistory() {
  const days = historyCleanupDays.value
  if (days === null) { return }

  await store.dispatch('removeHistoryOlderThan', days)
  closeHistoryCleanupPrompt()
  showToast({ message: t('History.History Older Than Days Removed', { days }, days), icon: ['fas', 'trash'] })
}

const HISTORY_SORT_BY_VALUES = {
  DateAddedNewest: 'latest_played_first',
  DateAddedOldest: 'earliest_played_first',
}

const SORT_BY_VALUES = Object.values(HISTORY_SORT_BY_VALUES)

const sortByNames = computed(() => [
  t('History.DateNewestHistory'),
  t('History.DateOldestHistory')
])

/** @type {import('vue').ComputedRef<'latest_played_first' | 'earliest_played_first'>} */
const sortBy = computed(() => store.getters.getUserHistorySortBy)

const sortByIcon = computed(() => getIconForSortPreference(sortBy.value))

/**
 * @param {'latest_played_first' | 'earliest_played_first'} value
 */
function updateUserHistorySortBy(value) {
  store.dispatch('updateUserHistorySortBy', value)
}

const historyCacheSorted = computed(() => {
  const historySorted = store.getters.getHistoryCacheSorted

  if (sortBy.value === HISTORY_SORT_BY_VALUES.DateAddedOldest) {
    return historySorted.toReversed()
  } else {
    return historySorted
  }
})

const hasUnwatchedHistory = computed(() => {
  return historyCacheSorted.value.some(record => record.isWatched !== true && canMarkHistoryEntryAsWatched(record))
})

async function markAllAsWatched() {
  const markedCount = await store.dispatch('markAllHistoryAsWatched')

  if (markedCount > 0) {
    showToast({ message: t('History.All History Marked as Watched'), icon: ['fas', 'eye'] })
  }
}

function handleMarkAllPrompt(value) {
  showMarkAllPrompt.value = false

  if (value === 'confirm') {
    markAllAsWatched()
  }
}

const fullData = computed(() => {
  // Always copy, so that structural changes (added/removed/reordered entries)
  // produce a new array and trigger the watcher below without it having to
  // deep watch every record. In-place record field updates (e.g. watch
  // progress) don't affect the filtering, the list items react to those
  // themselves.
  return historyCacheSorted.value.slice(0, dataLimit.value)
})

watch(fullData, filterHistory)
watch(doCaseSensitiveSearch, () => {
  filterHistory()
  saveStateInRouter()
})

/**
 * @param {string} query_
 * @param {string} [limit]
 * @param {boolean} [doCaseSensitiveSearch_]
 * @param {boolean} [filterNow=false]
 */
function handleQueryChange(query_, limit = undefined, doCaseSensitiveSearch_ = undefined, filterNow = false) {
  query.value = query_

  let newLimit = 100

  if (limit !== undefined) {
    const parsedLimit = parseInt(limit)

    if (!isNaN(parsedLimit)) {
      newLimit = parsedLimit
    }
  }

  searchDataLimit.value = newLimit

  if (doCaseSensitiveSearch_ !== undefined) {
    doCaseSensitiveSearch.value = doCaseSensitiveSearch_
  }

  saveStateInRouter()

  if (filterNow) {
    filterHistory()
  } else {
    filterHistoryAsync()
  }
}

function increaseLimit() {
  if (query.value.length > 0) {
    searchDataLimit.value += 100
    filterHistory()
  } else {
    dataLimit.value += 100
    sessionStorage.setItem(dataLimitStorageKey, dataLimit.value.toFixed(0))
  }
}

function filterHistory() {
  if (query.value.length === 0) {
    activeData.value = fullData.value
    showLoadMoreButton.value = activeData.value.length < historyCacheSorted.value.length
    return
  }

  let filteredQuery
  if (doCaseSensitiveSearch.value) {
    filteredQuery = filterVideosWithQuery(historyCacheSorted.value, query.value)
  } else {
    filteredQuery = filterVideosWithQuery(historyCacheSorted.value, query.value.toLowerCase(), (s) => s.toLowerCase())
  }

  activeData.value = filteredQuery.length < searchDataLimit.value ? filteredQuery : filteredQuery.slice(0, searchDataLimit.value)
  showLoadMoreButton.value = activeData.value.length > searchDataLimit.value
}

const filterHistoryAsync = debounce(filterHistory, 500)

async function saveStateInRouter() {
  const query_ = query.value

  let location

  if (query_.length === 0) {
    location = { path: '/history' }
  } else {
    location = {
      path: '/history',
      query: {
        searchQueryText: query_,
        searchDataLimit: searchDataLimit.value.toFixed(0)
      }
    }

    if (doCaseSensitiveSearch.value) {
      location.query.doCaseSensitiveSearch = 'true'
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
}

const oldQuery = route.query.searchQueryText
if (oldQuery != null && oldQuery !== '') {
  // `handleQueryChange` must be called after `filterHistoryDebounce` assigned
  handleQueryChange(
    oldQuery,
    route.query.searchDataLimit,
    route.query.doCaseSensitiveSearch === 'true',
    true
  )
} else {
  // Only display unfiltered data when no query used last time
  filterHistory()
}

const searchBar = useTemplateRef('searchBar')

/**
 * @param {KeyboardEvent} event
 */
function keyboardShortcutHandler(event) {
  ctrlFHandler(event, searchBar.value)
}

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})

const identity = (v) => v

/**
 * @param {any[]} videos
 * @param {string} query
 * @param {(attr: string) => string} attrProcessor
 */
function filterVideosWithQuery(videos, query, attrProcessor = identity) {
  return videos.filter((video) => {
    if (typeof (video.title) === 'string' && attrProcessor(video.title).includes(query)) {
      return true
    } else if (typeof (video.author) === 'string' && attrProcessor(video.author).includes(query)) {
      return true
    }

    return false
  })
}
</script>

<style scoped src="./History.css" />
