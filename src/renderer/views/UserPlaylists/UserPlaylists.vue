<template>
  <div>
    <FtCard
      class="card"
    >
      <div class="heading">
        <div class="headingRow">
          <h2
            ref="playlistHeading"
            class="headingText"
            tabindex="-1"
          >
            <FtIcon
              :icon="['fas', 'bookmark']"
              class="headingIcon"
            />
            {{ $t("User Playlists.Your Playlists") }}
          </h2>
          <div class="headingActions">
            <FtButton
              v-if="repairPlaylists.length > 0 || playlistRepairState.running"
              ref="repairAction"
              :label="t('User Playlists.Repair Playlists')"
              :icon="['fas', 'sync']"
              :disabled="metadataRepairBusy"
              @click="showRepairPrompt = true"
            />
            <FtIconButton
              :title="$t('User Playlists.Create New Playlist')"
              :icon="['fas', 'plus']"
              theme="secondary"
              class="newPlaylistButton"
              @click="createNewPlaylist"
            />
          </div>
        </div>
        <div
          v-if="fullData.length > 1"
          class="searchInputsRow"
        >
          <FtInput
            ref="searchBar"
            class="playlistSearch"
            input-type="search"
            :label="$t('User Playlists.Search bar placeholder')"
            :icon="['fas', 'search']"
            :placeholder="$t('Form Inputs.Search Text Hint')"
            :value="query"
            :show-action-button="false"
            :maxlength="255"
            @input="handleQueryChange"
          />
        </div>
        <div
          v-if="fullData.length > 1"
          class="optionsRow"
        >
          <FtToggleSwitch
            class="matchingVideosToggle"
            :label="$t('User Playlists.Playlists with Matching Videos')"
            :compact="true"
            :default-value="doSearchPlaylistsWithMatchingVideos"
            @change="doSearchPlaylistsWithMatchingVideos = !doSearchPlaylistsWithMatchingVideos"
          />
          <FtSelect
            class="sortSelect"
            :value="sortBy"
            :select-names="sortByNames"
            :select-values="SORT_BY_VALUES"
            :placeholder="$t('Global.Sort By')"
            :icon="sortByIcon"
            @change="updateUserPlaylistsSortBy"
          />
        </div>
      </div>
      <section
        v-if="playlistRepairState.started"
        class="repairStatus"
        :aria-label="t('User Playlists.Repair Playlists')"
      >
        <div class="repairStatusHeader">
          <h3
            class="repairStatusTitle"
            aria-live="polite"
          >
            <FtIcon
              :icon="['fas', 'sync']"
              aria-hidden="true"
            />
            {{ repairPhaseLabel }}
          </h3>
          <FtButton
            v-if="playlistRepairState.running"
            ref="repairCancel"
            class="playlistActionButton"
            :label="t('Cancel')"
            :icon="['fas', 'xmark']"
            @click="cancelPlaylistRepair"
          />
          <FtButton
            v-else
            ref="repairClose"
            class="playlistActionButton"
            :label="t('Close')"
            :icon="['fas', 'xmark']"
            @click="closePlaylistRepairStatus"
          />
        </div>
        <p
          class="repairCounts"
          role="status"
        >
          {{ t('History.Repair Progress', playlistRepairState) }}
        </p>
        <progress
          class="repairProgress"
          :max="playlistRepairState.total || 1"
          :value="repairProgressValue"
          :aria-label="t('History.Repair Progress', playlistRepairState)"
        />
        <p
          v-if="playlistRepairState.error"
          class="repairError"
          role="alert"
        >
          {{ playlistRepairState.error }}
        </p>
      </section>
      <FtFlexBox
        v-if="fullData.length === 0"
      >
        <p class="message">
          {{ $t("User Playlists['You have no playlists. Click on the create new playlist button to create a new one.']") }}
        </p>
      </FtFlexBox>
      <FtFlexBox
        v-else-if="activeData.length === 0 && fullData.length > 0"
      >
        <p class="message">
          {{ $t("User Playlists['Empty Search Message']") }}
        </p>
      </FtFlexBox>
      <FtElementList
        v-else-if="activeData.length > 0"
        class="playlistList"
        :data="activeData"
        data-type="playlist"
        :search-query-text="doSearchPlaylistsWithMatchingVideos ? lowerCaseQuery : ''"
        :use-channels-hidden-preference="false"
        :hide-forbidden-titles="false"
      />
      <FtAutoLoadNextPageWrapper
        v-if="showLoadMoreButton"
        @load-next-page="increaseLimit"
      >
        <FtFlexBox>
          <FtButton
            :label="$t('User Playlists.Load More Playlists')"
            :icon="['fas', 'arrow-down']"
            background-color="var(--primary-color)"
            text-color="var(--text-with-main-color)"
            @click="increaseLimit"
          />
        </FtFlexBox>
      </FtAutoLoadNextPageWrapper>
      <FtPrompt
        v-if="showRepairPrompt"
        card-class="playlistRepairPrompt"
        autosize
        fixed-layout
        @click="showRepairPrompt = false"
      >
        <template #label="{ labelId }">
          <h2
            :id="labelId"
            class="repairPromptTitle"
          >
            <FtIcon
              :icon="['fas', 'sync']"
              class="headingIcon"
              aria-hidden="true"
            />
            {{ t('User Playlists.Repair Playlists') }}
          </h2>
        </template>
        <div class="repairPromptContent">
          <p class="repairDescription">
            {{ t('User Playlists.Repair Description') }}
          </p>
          <FtCheckboxList
            v-model="selectAllOptions"
            :labels="[t('Select all')]"
            :values="['all']"
            :indeterminate-values="selectedPlaylistIds.length > 0 && !allRepairPlaylistsSelected ? ['all'] : []"
          />
          <FtCheckboxList
            v-model="selectedPlaylistIds"
            :labels="repairPlaylists.map(playlist => playlist.playlistName)"
            :values="repairPlaylists.map(playlist => playlist._id)"
          />
          <p class="repairDetails">
            {{ t('History.Repair Details') }}
          </p>
          <FtCheckboxList
            v-if="repairCookiesConfigured"
            v-model="repairOptions"
            :labels="[t('History.Repair Use Cookies')]"
            :values="['cookies']"
          />
          <p
            v-if="showRepairCookieHint"
            class="repairNotice"
          >
            {{ t('History.Repair Cookies Hint') }}
          </p>
        </div>
        <template #footer>
          <div class="repairPromptActions">
            <FtButton
              :label="t('Cancel')"
              :icon="['fas', 'xmark']"
              text-color="var(--primary-text-color)"
              background-color="var(--secondary-card-bg-color)"
              @click="showRepairPrompt = false"
            />
            <FtButton
              :label="t('History.Start Repair')"
              :icon="['fas', 'sync']"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              :disabled="selectedPlaylistIds.length === 0 || metadataRepairBusy"
              @click="beginPlaylistRepair"
            />
          </div>
        </template>
      </FtPrompt>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'

import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCheckboxList from '../../components/FtCheckboxList/FtCheckboxList.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtToggleSwitch from '../../components/FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import { playlistRepairRecords } from '../../../playlistRepair'
import { metadataRepairBusy, repairCookiesConfigured } from '../../helpers/historyRepair'
import { playlistRepairState, startPlaylistRepair, cancelPlaylistRepair, readPlaylistRepairRecords } from '../../helpers/playlistRepair'
import { DBLibraryHandlers } from '../../../datastores/handlers/index'

import { ctrlFHandler, debounce, getIconForSortPreference } from '../../helpers/utils'
import { isValidPlaylistBookmark, playlistBookmarkToListData } from '../../helpers/playlist-bookmarks'
import { useTabContext } from '../../tabs/TabContext'

const { locale, t } = useI18n()
const { tabId } = useTabContext()
const dataLimitStorageKey = tabId ? `UserPlaylists/${tabId}/dataLimit` : 'UserPlaylists/dataLimit'

const sessionDataLimit = sessionStorage.getItem(dataLimitStorageKey)

const dataLimit = ref(sessionDataLimit !== null ? parseInt(sessionDataLimit) : 100)
const searchDataLimit = ref(100)
const showLoadMoreButton = ref(false)
const query = ref('')
const doSearchPlaylistsWithMatchingVideos = ref(false)
const activeData = ref([])

const SORT_BY_OPTIONS = {
  NameAscending: 'name_ascending',
  NameDescending: 'name_descending',

  LatestCreatedFirst: 'latest_created_first',
  EarliestCreatedFirst: 'earliest_created_first',

  LatestUpdatedFirst: 'latest_updated_first',
  EarliestUpdatedFirst: 'earliest_updated_first',

  LatestPlayedFirst: 'latest_played_first',
  EarliestPlayedFirst: 'earliest_played_first',
}

const SORT_BY_VALUES = Object.values(SORT_BY_OPTIONS)

const sortByNames = computed(() => {
  return SORT_BY_VALUES.map((k) => {
    switch (k) {
      case SORT_BY_OPTIONS.NameAscending:
        return t('User Playlists.Sort By.NameAscending')
      case SORT_BY_OPTIONS.NameDescending:
        return t('User Playlists.Sort By.NameDescending')
      case SORT_BY_OPTIONS.LatestCreatedFirst:
        return t('User Playlists.Sort By.LatestCreatedFirst')
      case SORT_BY_OPTIONS.EarliestCreatedFirst:
        return t('User Playlists.Sort By.EarliestCreatedFirst')
      case SORT_BY_OPTIONS.LatestUpdatedFirst:
        return t('User Playlists.Sort By.LatestUpdatedFirst')
      case SORT_BY_OPTIONS.EarliestUpdatedFirst:
        return t('User Playlists.Sort By.EarliestUpdatedFirst')
      case SORT_BY_OPTIONS.LatestPlayedFirst:
        return t('User Playlists.Sort By.LatestPlayedFirst')
      case SORT_BY_OPTIONS.EarliestPlayedFirst:
        return t('User Playlists.Sort By.EarliestPlayedFirst')
      default:
        console.error(`Unknown sortBy: ${k}`)
        return k
    }
  })
})

/** @type {import('vue').ComputedRef<'name_ascending' | 'name_descending' | 'latest_created_first' | 'earliest_created_first' | 'latest_updated_first' | 'earliest_updated_first' | 'latest_played_first' | 'earliest_played_first'>} */
const sortBy = computed(() => store.getters.getUserPlaylistsSortBy)

const sortByIcon = computed(() => getIconForSortPreference(sortBy.value))

const cachedCollator = computed(() => new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }))

/** @type {import('vue').ComputedRef<any[]>} */
const allPlaylists = computed(() => {
  /** @type {any[]} */
  const playlists = [
    ...store.getters.getAllPlaylists,
    ...store.getters.getPlaylistBookmarks
      .filter(isValidPlaylistBookmark)
      .map(playlistBookmarkToListData),
  ]

  const sortBy_ = sortBy.value

  if (!SORT_BY_VALUES.includes(sortBy_)) {
    console.error(`Unknown sortBy: ${sortBy_}`)
    return playlists
  }

  const collator = cachedCollator.value

  return playlists.toSorted((a, b) => {
    switch (sortBy_) {
      case SORT_BY_OPTIONS.NameAscending:
        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.NameDescending:
        return collator.compare(b.playlistName, a.playlistName)
      case SORT_BY_OPTIONS.LatestCreatedFirst:
        if (a.createdAt > b.createdAt) { return -1 }
        if (a.createdAt < b.createdAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.EarliestCreatedFirst:
        if (a.createdAt < b.createdAt) { return -1 }
        if (a.createdAt > b.createdAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.LatestUpdatedFirst:
        if (a.lastUpdatedAt > b.lastUpdatedAt) { return -1 }
        if (a.lastUpdatedAt < b.lastUpdatedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.EarliestUpdatedFirst:
        if (a.lastUpdatedAt < b.lastUpdatedAt) { return -1 }
        if (a.lastUpdatedAt > b.lastUpdatedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.LatestPlayedFirst:
        if (a.lastPlayedAt == null && b.lastPlayedAt == null) {
          return collator.compare(a.playlistName, b.playlistName)
        }

        // Never played playlist = move to last
        if (a.lastPlayedAt == null) { return 1 }
        if (b.lastPlayedAt == null) { return -1 }
        if (a.lastPlayedAt > b.lastPlayedAt) { return -1 }
        if (a.lastPlayedAt < b.lastPlayedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      case SORT_BY_OPTIONS.EarliestPlayedFirst:
        // Never played playlist = first
        if (a.lastPlayedAt == null && b.lastPlayedAt == null) {
          return collator.compare(a.playlistName, b.playlistName)
        }

        // Never played playlist = move to first
        if (a.lastPlayedAt == null) { return -1 }
        if (b.lastPlayedAt == null) { return 1 }
        if (a.lastPlayedAt < b.lastPlayedAt) { return -1 }
        if (a.lastPlayedAt > b.lastPlayedAt) { return 1 }

        return collator.compare(a.playlistName, b.playlistName)
      default:
        // should never happen as we detect this before calling toSorted
        return 0
    }
  })
})

const showRepairPrompt = ref(false)
const repairOptions = ref([])
const selectedPlaylistIds = ref([])
const repairPlaylists = computed(() => store.getters.getAllPlaylists.toSorted((a, b) => cachedCollator.value.compare(a.playlistName, b.playlistName)))
const allRepairPlaylistsSelected = computed(() => repairPlaylists.value.length > 0 && repairPlaylists.value.every(playlist => selectedPlaylistIds.value.includes(playlist._id)))
const selectAllOptions = computed({
  get: () => allRepairPlaylistsSelected.value ? ['all'] : [],
  set: options => { selectedPlaylistIds.value = options.includes('all') ? repairPlaylists.value.map(playlist => playlist._id) : [] }
})
const selectedRepairPlaylists = computed(() => repairPlaylists.value.filter(playlist => selectedPlaylistIds.value.includes(playlist._id)))

const repairUseCookies = computed(() => repairCookiesConfigured.value && repairOptions.value.includes('cookies'))
const pagedRepairCandidateCount = ref(0)
const showRepairCookieHint = computed(() => (process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && !repairUseCookies.value && (process.env.IS_ELECTRON ? pagedRepairCandidateCount.value : playlistRepairRecords(selectedRepairPlaylists.value).length) > 500)
watch([showRepairPrompt, selectedPlaylistIds, () => store.state.playlists.playlistRevision], async ([open, ids], _previous, onCleanup) => {
  if (!process.env.IS_ELECTRON || !open) return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  pagedRepairCandidateCount.value = 0
  try {
    const records = await readPlaylistRepairRecords(ids, controller.signal, 501)
    if (!controller.signal.aborted) pagedRepairCandidateCount.value = records.length
  } catch (error) { if (!controller.signal.aborted) console.error(error) }
})
watch(showRepairPrompt, open => {
  if (open) {
    selectedPlaylistIds.value = []
    repairOptions.value = []
  }
})
watch(repairPlaylists, playlists => {
  selectedPlaylistIds.value = selectedPlaylistIds.value.filter(id => playlists.some(playlist => playlist._id === id))
})
const repairAction = useTemplateRef('repairAction')
const repairCancel = useTemplateRef('repairCancel')
const repairClose = useTemplateRef('repairClose')
const playlistHeading = useTemplateRef('playlistHeading')
const repairPhaseLabel = computed(() => ({
  checking: t('History.Repair Checking'),
  waiting: t('History.Repair Waiting'),
  retrying: t('History.Repair Retrying'),
  finished: t('History.Repair Finished'),
  stopped: t('History.Repair Stopped')
})[playlistRepairState.phase])
const repairProgressValue = computed(() => playlistRepairState.running && playlistRepairState.phase !== 'checking'
  ? undefined
  : playlistRepairState.checked)

function beginPlaylistRepair() {
  if (selectedPlaylistIds.value.length === 0 || metadataRepairBusy.value) return
  showRepairPrompt.value = false
  startPlaylistRepair({ playlistIds: [...selectedPlaylistIds.value], useCookies: repairUseCookies.value })
  nextTick(() => repairCancel.value?.$el.focus({ preventScroll: true }))
}

function closePlaylistRepairStatus() {
  if (playlistRepairState.running) return
  playlistRepairState.started = false
  nextTick(() => (repairAction.value?.$el ?? playlistHeading.value)?.focus({ preventScroll: true }))
}

watch(() => playlistRepairState.running, running => {
  if (!running && document.activeElement === repairCancel.value?.$el) {
    nextTick(() => repairClose.value?.$el.focus({ preventScroll: true }))
  }
})

const fullData = computed(() => {
  return allPlaylists.value.length < dataLimit.value
    ? allPlaylists.value
    : allPlaylists.value.slice(0, dataLimit.value)
})

const lowerCaseQuery = computed(() => query.value.toLowerCase())
const appliedQuery = ref('')
const libraryMatches = ref(new Set())
let searchGeneration = 0
if (process.env.IS_ELECTRON) {
  watch([appliedQuery, doSearchPlaylistsWithMatchingVideos, allPlaylists], async () => {
    const generation = ++searchGeneration
    libraryMatches.value = new Set()
    if (!appliedQuery.value || !doSearchPlaylistsWithMatchingVideos.value) return
    try {
      const result = await DBLibraryHandlers.query('playlistSelection', { ids: [], query: appliedQuery.value })
      if (generation === searchGeneration) libraryMatches.value = new Set(result.matches)
    } catch (error) { console.error(error) }
  }, { immediate: true })
}
onBeforeUnmount(() => { searchGeneration++ })

// Track only fields used by the applied search. An idle overview must not
// deep-watch thousands of saved videos, including in background tabs.
const filteredPlaylists = computed(() => {
  const needle = appliedQuery.value
  if (needle === '') return allPlaylists.value
  const findMatchingVideos = doSearchPlaylistsWithMatchingVideos.value
  return allPlaylists.value.filter(playlist => {
    return (typeof playlist.playlistName === 'string' && playlist.playlistName.toLowerCase().includes(needle)) ||
      (findMatchingVideos && (process.env.IS_ELECTRON
        ? libraryMatches.value.has(playlist._id)
        : (Array.isArray(playlist.videos) ? playlist.videos : []).some(video => (
            (typeof video?.author === 'string' && video.author.toLowerCase().includes(needle)) ||
            (typeof video?.title === 'string' && video.title.toLowerCase().includes(needle))
          ))))
  })
})

watch(lowerCaseQuery, () => {
  searchDataLimit.value = 100
  filterPlaylistAsync()
})

watch(doSearchPlaylistsWithMatchingVideos, () => {
  searchDataLimit.value = 100
  filterPlaylistAsync()
  saveStateInRouter()
})

watch([fullData, filteredPlaylists], updatePlaylistResults)

/**
 * @param {'name_ascending' | 'name_descending' | 'latest_created_first' | 'earliest_created_first' | 'latest_updated_first' | 'earliest_updated_first' | 'latest_played_first' | 'earliest_played_first'} value
 */
function updateUserPlaylistsSortBy(value) {
  store.dispatch('updateUserPlaylistsSortBy', value)
}

/**
 * @param {string} query_
 * @param {string} [limit]
 * @param {boolean} [doSearchPlaylistsWithMatchingVideos_]
 * @param {boolean} [filterNow=false]
 */
function handleQueryChange(query_, limit = undefined, doSearchPlaylistsWithMatchingVideos_ = undefined, filterNow = false) {
  query.value = query_

  let newLimit = 100

  if (limit !== undefined) {
    const parsedLimit = parseInt(limit)

    if (!isNaN(parsedLimit)) {
      newLimit = parsedLimit
    }
  }

  searchDataLimit.value = newLimit

  if (doSearchPlaylistsWithMatchingVideos_ !== undefined) {
    doSearchPlaylistsWithMatchingVideos.value = doSearchPlaylistsWithMatchingVideos_
  }

  saveStateInRouter()

  if (filterNow) {
    filterPlaylist()
  } else {
    filterPlaylistAsync()
  }
}

function increaseLimit() {
  if (query.value !== '') {
    searchDataLimit.value += 100
    saveStateInRouter()
    filterPlaylist()
  } else {
    dataLimit.value += 100
    sessionStorage.setItem(dataLimitStorageKey, dataLimit.value.toFixed(0))
  }
}

function filterPlaylist() {
  filterPlaylistAsync.cancel()
  appliedQuery.value = lowerCaseQuery.value
  updatePlaylistResults()
}

function updatePlaylistResults() {
  if (appliedQuery.value === '') {
    activeData.value = fullData.value
    showLoadMoreButton.value = allPlaylists.value.length > activeData.value.length
  } else {
    const matches = filteredPlaylists.value
    const searchDataLimit_ = searchDataLimit.value

    showLoadMoreButton.value = matches.length > searchDataLimit_
    activeData.value = matches.length < searchDataLimit_ ? matches : matches.slice(0, searchDataLimit_)
  }
}

const filterPlaylistAsync = debounce(filterPlaylist, 500)

function createNewPlaylist() {
  store.dispatch('showCreatePlaylistPrompt', { title: '' })
}

const router = useRouter()

async function saveStateInRouter() {
  const query_ = query.value

  let location

  if (query_ === '') {
    location = { path: '/userplaylists' }
  } else {
    location = {
      path: '/userplaylists',
      query: {
        query: query_,
        searchDataLimit: searchDataLimit.value.toFixed(0)
      }
    }

    if (doSearchPlaylistsWithMatchingVideos.value) {
      location.query.doSearchPlaylistsWithMatchingVideos = 'true'
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

const route = useRoute()

const oldQuery = route.query.query
if (oldQuery != null && oldQuery !== '') {
  handleQueryChange(
    oldQuery,
    route.query.searchDataLimit,
    route.query.doSearchPlaylistsWithMatchingVideos === 'true',
    true
  )
} else {
  // Only display unfiltered data when no query used last time
  filterPlaylist()
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
  filterPlaylistAsync.cancel()
  document.removeEventListener('keydown', keyboardShortcutHandler)
})
</script>

<style scoped src="./UserPlaylists.css" />

<style scoped src="../../components/metadataRepair.css" />
