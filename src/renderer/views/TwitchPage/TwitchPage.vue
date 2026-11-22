<template>
  <div>
    <FtCard class="card">
      <h2
        :id="headingId"
        class="pageTitle"
      >
        <FtIcon
          :icon="PLATFORM_ICONS.twitch"
          class="headingIcon"
        />
        {{ twitch.name }}
      </h2>
      <FtInput
        class="twitchSearch"
        input-type="search"
        :label="t('Twitch Page.Search')"
        :placeholder="t('Twitch Page.Search Placeholder')"
        :action-button-label="t('Twitch Page.Search')"
        :icon="['fas', 'search']"
        :value="query"
        :maxlength="200"
        @click="search"
        @input="text => { if (!text.trim()) search('') }"
        @clear="search('')"
      />
      <FtTabs
        class="channelTabs"
        role="tablist"
        :aria-labelledby="headingId"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -- the tabs use a roving tabindex, which the rule can't see -->
        <div
          v-for="tab in TABS"
          :id="`${panelId}-${tab}`"
          :key="tab"
          :ref="element => setTabRef(tab, element)"
          class="tab"
          role="tab"
          :aria-selected="currentTab === tab"
          :aria-controls="panelId"
          :tabindex="currentTab === tab ? 0 : -1"
          :data-twitch-tab="tab"
          @click="changeTab(tab)"
          @keydown.space.enter.prevent="changeTab(tab)"
          @keydown.left.right.prevent="focusOtherTab(tab)"
        >
          <FtIcon
            :icon="TAB_ICONS[tab]"
            class="tabIcon"
          />
          {{ tabLabels[tab] }}
        </div>
      </FtTabs>
    </FtCard>
    <FtCard
      :id="panelId"
      class="card"
      role="tabpanel"
      :aria-labelledby="`${panelId}-${currentTab}`"
    >
      <PlatformSearchResults
        v-if="query"
        :platform="twitch"
        :query="query"
        :type="currentTab"
      />
      <template v-else>
        <PlatformFilters
          v-if="currentTab === 'channels'"
          class="liveFilters"
          :platform="twitch"
          :options="twitch.liveStreamFilters"
          :filters="filters"
          @change="updateRoute"
        />
        <FtLoader v-if="browseLoading" />
        <template v-else-if="browseError">
          <p
            class="message"
            role="alert"
          >
            {{ t('Platforms.Load Error', { platform: twitch.name }) }}
          </p>
          <FtFlexBox>
            <FtButton
              :label="t('User Playlists.SinglePlaylistView.Retry')"
              :icon="['fas', 'sync']"
              @click="loadBrowse"
            />
          </FtFlexBox>
        </template>
        <template v-else>
          <p
            v-if="browseResults.length === 0"
            class="message"
          >
            {{ t('Platforms.Empty Tab') }}
          </p>
          <!-- Each tab and set of filters mounts its own list, so it enters
               like channel tabs do instead of reflowing the previous grid -->
          <PlatformResultList
            :key="`${currentTab}:${filtersKey}`"
            appear
            :results="browseResults"
          />
        </template>
      </template>
    </FtCard>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtTabs from '../../components/FtTabs/FtTabs.vue'
import PlatformFilters from '../../components/PlatformFilters/PlatformFilters.vue'
import PlatformResultList from '../../components/PlatformResultList/PlatformResultList.vue'
import PlatformSearchResults from '../../components/PlatformSearchResults/PlatformSearchResults.vue'

import { usePlatformFilters } from '../../composables/usePlatformFilters'
import { getPlatformFetch } from '../../helpers/platformFetch'
import twitch from '../../../platforms/twitch'
import { PLATFORM_ICONS } from '../../../platforms/index'

/** Without a search, these tabs list the most watched categories and live streams of every category */
const TABS = /** @type {const} */ (['categories', 'channels'])
const TAB_ICONS = {
  categories: ['fas', 'gamepad'],
  channels: ['fas', 'circle-user']
}

const { t } = useI18n()
const route = useRoute()
const headingId = useId()
const panelId = useId()

const tabLabels = computed(() => ({
  categories: t('Platforms.Categories'),
  channels: t('Search Filters.Type.Channels')
}))

// The search and tab stay in the address, so back and reload return to them
const query = computed(() => typeof route.query.query === 'string' ? route.query.query.trim() : '')
const currentTab = computed(() => TABS.includes(/** @type {any} */ (route.query.tab)) ? route.query.tab : TABS[0])

const { filters, filtersKey, updateQuery: updateRoute } = usePlatformFilters(computed(() => twitch), computed(() => twitch.liveStreamFilters))

/**
 * @param {string} text
 */
function search(text) {
  updateRoute({ query: text.trim() || undefined })
}

/**
 * @param {string} tab
 */
function changeTab(tab) {
  if (tab !== currentTab.value) updateRoute({ tab })
}

/** @type {Map<string, HTMLElement>} */
const tabRefs = new Map()

/**
 * @param {string} tab
 * @param {unknown} element
 */
function setTabRef(tab, element) {
  if (element instanceof HTMLElement) tabRefs.set(tab, element)
  else tabRefs.delete(tab)
}

/**
 * @param {string} tab
 */
function focusOtherTab(tab) {
  const other = TABS.find(value => value !== tab)
  changeTab(other)
  tabRefs.get(other)?.focus()
}

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformResult[]>} */
const browseResults = shallowRef([])
const browseLoading = ref(false)
const browseError = ref(false)
let browseGeneration = 0
/** @type {AbortController | null} */
let browseController = null

/** Loads the list of the tab, unless a search shows another */
async function loadBrowse() {
  const generation = ++browseGeneration
  browseController?.abort()
  browseResults.value = []
  browseError.value = false
  if (query.value) {
    browseLoading.value = false
    return
  }
  const controller = new AbortController()
  browseController = controller
  browseLoading.value = true
  try {
    const fetch = getPlatformFetch(twitch.id)
    const results = currentTab.value === 'categories'
      ? (await twitch.getTopCategories(fetch, controller.signal)).map(category => ({ kind: /** @type {const} */ ('category'), category }))
      : (await twitch.getLiveStreams(fetch, filters.value, controller.signal)).map(item => ({ kind: /** @type {const} */ ('item'), item }))
    if (generation === browseGeneration) browseResults.value = results
  } catch (error) {
    if (generation !== browseGeneration) return
    console.error('Failed to load Twitch', error)
    browseError.value = true
  } finally {
    if (generation === browseGeneration) browseLoading.value = false
  }
}

onBeforeUnmount(() => browseController?.abort())

watch([query, currentTab, () => currentTab.value === 'channels' ? filtersKey.value : ''], loadBrowse, { immediate: true })
</script>

<style scoped src="../ExternalChannel/ExternalChannel.css" />
<style scoped>
.pageTitle {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-block: 0 16px;
}

.headingIcon {
  color: var(--primary-color);
}

.twitchSearch {
  inline-size: 100%;
}

/* With the list items' own padding, their thumbnails sit as far below the
   filters as the filters' labels below the card's edge */
.liveFilters {
  margin-block-end: calc(10px * var(--ui-density));
}
</style>
