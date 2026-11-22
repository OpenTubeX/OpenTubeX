<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else-if="!category"
      class="card"
    >
      <p class="message">
        {{ notFound ? t('Platforms.Category Not Found') : t('Platforms.Load Error', { platform: platform?.name ?? '' }) }}
      </p>
      <FtFlexBox>
        <FtButton
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="loadCategory"
        />
      </FtFlexBox>
    </FtCard>
    <template v-else>
      <FtCard class="card">
        <div class="channelHeader">
          <FtRetryImage
            class="boxArt"
            :src="category.thumbnail"
            :fallback-icon="['fas', 'gamepad']"
            alt=""
          />
          <div class="channelInfo">
            <h2
              :id="headingId"
              class="channelName"
              dir="auto"
            >
              {{ category.name }}
            </h2>
            <p class="channelMeta">
              <span>
                <FtIcon
                  :icon="PLATFORM_ICONS[platform.id]"
                  aria-hidden="true"
                />
                {{ platform.name }}
              </span>
              <span v-if="category.viewerCount != null && !hideViews">
                {{ t('Global.Counts.Watching Count', { count: formatViewCount(category.viewerCount, shortenViewCounts) }, category.viewerCount) }}
              </span>
              <span v-if="category.followerCount != null && !hideChannelSubscriptions">
                {{ t('Platforms.Follower Count', { count: formatSubscriberCount(category.followerCount) }, category.followerCount) }}
              </span>
            </p>
            <ul
              v-if="category.tags"
              class="categoryTags"
              :aria-label="t('Platforms.Category Tags')"
            >
              <li
                v-for="tag in category.tags"
                :key="tag"
                class="tagChip"
                dir="auto"
              >
                {{ tag }}
              </li>
            </ul>
          </div>
          <div class="channelActions">
            <FtIconButton
              :title="t('Platforms.Open Website', { platform: platform.name })"
              :icon="['fas', 'arrow-up-right-from-square']"
              theme="base-no-default"
              :size="20"
              :padding="8"
              @click="openExternalLink(category.url)"
            />
          </div>
        </div>
        <template v-if="category.description">
          <p
            :id="descriptionId"
            ref="description"
            class="channelDescription"
            :class="{ expanded: descriptionExpanded }"
            dir="auto"
          >
            {{ category.description }}
          </p>
          <button
            v-if="descriptionExpanded || descriptionClamped"
            type="button"
            class="descriptionToggle"
            :aria-expanded="descriptionExpanded"
            :aria-controls="descriptionId"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? t('Description.Collapse Description') : t('Description.Expand Description') }}
            <FtIcon
              :icon="['fas', descriptionExpanded ? 'angle-up' : 'angle-down']"
              aria-hidden="true"
            />
          </button>
        </template>
        <FtTabs
          v-if="tabs.length > 1"
          class="channelTabs"
          role="tablist"
          :aria-labelledby="headingId"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -- the tabs use a roving tabindex, which the rule can't see -->
          <div
            v-for="tab in tabs"
            :id="`${panelId}-${tab}`"
            :key="tab"
            :ref="element => setTabRef(tab, element)"
            class="tab"
            role="tab"
            :aria-selected="currentTab === tab"
            :aria-controls="panelId"
            :tabindex="currentTab === tab ? 0 : -1"
            :data-category-tab="tab"
            @click="changeTab(tab)"
            @keydown.space.enter.prevent="changeTab(tab)"
            @keydown.left.right.prevent="focusNextTab(tab, $event)"
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
        :role="tabs.length > 1 ? 'tabpanel' : undefined"
        :aria-labelledby="tabs.length > 1 ? `${panelId}-${currentTab}` : undefined"
      >
        <PlatformFilters
          v-if="tabOptions"
          :platform="platform"
          :options="tabOptions"
          :filters="filters"
          @change="updateQuery"
        />
        <FtLoader
          v-if="itemsLoading"
          class="items"
        />
        <template v-else-if="itemsError">
          <p
            class="message"
            role="alert"
          >
            {{ t('Platforms.Load Error', { platform: platform.name }) }}
          </p>
          <FtFlexBox>
            <FtButton
              :label="t('User Playlists.SinglePlaylistView.Retry')"
              :icon="['fas', 'sync']"
              @click="loadCategory"
            />
          </FtFlexBox>
        </template>
        <template v-else>
          <p
            v-if="results.length === 0"
            class="message"
          >
            {{ t('Platforms.Empty Tab') }}
          </p>
          <!-- Each tab and set of filters mounts its own list, so its items
               enter together instead of reflowing the previous ones -->
          <PlatformResultList
            :key="`${currentTab}:${filtersKey}`"
            class="items"
            appear
            :results="results"
          />
        </template>
      </FtCard>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, shallowRef, ref, useId, useTemplateRef, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtTabs from '../../components/FtTabs/FtTabs.vue'
import PlatformFilters from '../../components/PlatformFilters/PlatformFilters.vue'
import PlatformResultList from '../../components/PlatformResultList/PlatformResultList.vue'

import store from '../../store/index'
import { usePlatformFilters } from '../../composables/usePlatformFilters'
import { getPlatformFetch } from '../../helpers/platformFetch'
import { formatSubscriberCount, formatViewCount, openExternalLink } from '../../helpers/utils'
import { useTabTitle } from '../../tabs/TabContext'
import { getPlatform, PLATFORM_ICONS } from '../../../platforms/index'

/** @typedef {import('../../../platforms/types').PlatformCategoryTab} PlatformCategoryTab */

/** @type {Record<PlatformCategoryTab, string[]>} */
const TAB_ICONS = {
  live: ['fas', 'tower-broadcast'],
  videos: ['fas', 'video'],
  clips: ['fas', 'film']
}

const { t } = useI18n()
const route = useRoute()
const setTabTitle = useTabTitle()
const headingId = useId()
const panelId = useId()
const descriptionId = useId()

const platform = computed(() => getPlatform(route.query.platform))
const categoryId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')
const hideViews = computed(() => store.getters.getHideVideoViews)
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)
const hideChannelSubscriptions = computed(() => store.getters.getHideChannelSubscriptions)

const tabs = computed(() => /** @type {PlatformCategoryTab[]} */ (Object.keys(platform.value?.categoryTabs ?? { live: null })))
// The tab stays in the address, so back and reload return to it
const currentTab = computed(() => tabs.value.includes(/** @type {any} */ (route.query.tab)) ? /** @type {PlatformCategoryTab} */ (route.query.tab) : tabs.value[0])
const tabOptions = computed(() => platform.value?.categoryTabs?.[currentTab.value])
const tabLabels = computed(() => ({
  live: t('Global.Live'),
  videos: t('Global.Videos'),
  clips: t('Subscriptions.Platforms.Clips')
}))

const { filters, filtersKey, updateQuery } = usePlatformFilters(platform, tabOptions)

/**
 * @param {PlatformCategoryTab} tab
 */
function changeTab(tab) {
  if (tab === currentTab.value) return
  // The languages apply to every tab, the other filters only to their own
  updateQuery({ tab: tab === tabs.value[0] ? undefined : tab, sort: undefined, type: undefined, tag: undefined })
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
 * @param {PlatformCategoryTab} tab
 * @param {KeyboardEvent} event
 */
function focusNextTab(tab, event) {
  const index = tabs.value.indexOf(tab)
  const next = tabs.value[(index + (event.key === 'ArrowLeft' ? tabs.value.length - 1 : 1)) % tabs.value.length]
  changeTab(next)
  tabRefs.get(next)?.focus()
}

const description = useTemplateRef('description')
const descriptionExpanded = ref(false)
// Only descriptions longer than their collapsed lines can expand
const descriptionClamped = ref(false)
watchEffect(onCleanup => {
  const element = description.value
  if (!element || descriptionExpanded.value) return
  const observer = new ResizeObserver(() => {
    descriptionClamped.value = element.scrollHeight > element.clientHeight
  })
  observer.observe(element)
  onCleanup(() => observer.disconnect())
})

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformCategory | null>} */
const category = shallowRef(null)
/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformResult[]>} */
const results = shallowRef([])
const isLoading = ref(true)
const itemsLoading = ref(false)
const itemsError = ref(false)
const notFound = ref(false)

let loadGeneration = 0
/** @type {AbortController | null} */
let loadController = null
/** The platform and ID of the category last loaded */
let loadedKey = ''

async function loadCategory() {
  const generation = ++loadGeneration
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller
  // Other tabs and filters reload the items below the category, which stays
  const key = `${platform.value?.id}:${categoryId.value}`
  const sameCategory = category.value !== null && key === loadedKey
  loadedKey = key
  if (!sameCategory) {
    isLoading.value = true
    category.value = null
    descriptionExpanded.value = false
  }
  notFound.value = false
  itemsLoading.value = true
  itemsError.value = false
  results.value = []
  if (!platform.value?.getCategory || !categoryId.value) {
    notFound.value = true
    category.value = null
    isLoading.value = false
    itemsLoading.value = false
    return
  }
  if (!sameCategory) setTabTitle(platform.value.name)
  try {
    const fetch = getPlatformFetch(platform.value.id)
    const result = await platform.value.getCategory(fetch, categoryId.value, currentTab.value, filters.value, controller.signal)
    if (generation !== loadGeneration) return
    notFound.value = result === null
    category.value = result?.category ?? null
    if (result) {
      results.value = result.items.map(item => ({ kind: /** @type {const} */ ('item'), item }))
      setTabTitle(result.category.name)
    }
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load the category', error)
    itemsError.value = true
  } finally {
    if (generation === loadGeneration) {
      isLoading.value = false
      itemsLoading.value = false
    }
  }
}

onBeforeUnmount(() => loadController?.abort())

watch([() => route.query.platform, () => route.query.id, currentTab, filtersKey], loadCategory, { immediate: true })
</script>

<style scoped src="../ExternalChannel/ExternalChannel.css" />
<style scoped>
/* With a single action, it stays beside the name, which wraps instead */
.channelHeader {
  flex-wrap: nowrap;
  align-items: flex-start;
}

.channelInfo {
  flex-basis: 0;
  align-self: center;
}

.boxArt {
  flex: none;
  inline-size: 72px;
  aspect-ratio: 3 / 4;
  border-radius: var(--shape-corner-small);
  object-fit: cover;
  font-size: 72px;
}

.categoryTags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-block: 8px 0;
  margin-inline: 0;
  padding: 0;
  list-style: none;
}

.tagChip {
  padding-block: 2px;
  padding-inline: 10px;
  border-radius: var(--shape-corner-full);
  background-color: var(--search-bar-color);
  font-size: 13px;
  line-height: 20px;
}

.channelDescription.expanded {
  display: block;
}

.descriptionToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-block-start: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.descriptionToggle:hover,
.descriptionToggle:focus-visible {
  text-decoration: underline;
}

/* With the list items' own padding, their thumbnails sit as far below the
   filters as the filters' labels below the card's edge */
.items {
  margin-block-start: calc(10px * var(--ui-density));
}
</style>
