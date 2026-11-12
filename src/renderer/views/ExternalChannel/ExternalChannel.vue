<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else-if="!channel"
      class="card"
    >
      <p class="message">
        {{ errorMessage }}
      </p>
      <FtFlexBox>
        <FtButton
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="loadChannel"
        />
      </FtFlexBox>
    </FtCard>
    <template v-else>
      <FtCard class="card channelCard">
        <img
          v-if="channel.banner"
          class="channelBanner"
          :src="channel.banner"
          alt=""
        >
        <div class="channelHeader">
          <FtRetryImage
            class="channelAvatar"
            :src="channel.avatar ?? ''"
            :fallback-icon="['fas', 'circle-user']"
            alt=""
          />
          <div class="channelInfo">
            <h2
              :id="headingId"
              class="channelName"
              dir="auto"
            >
              {{ channel.name }}
            </h2>
            <p class="channelMeta">
              <span>
                <FtIcon
                  :icon="PLATFORM_ICONS[platform.id]"
                  aria-hidden="true"
                />
                {{ platform.name }}
              </span>
              <span v-if="channel.followerCount != null && !hideChannelSubscriptions">
                {{ t('Platforms.Follower Count', { count: formatSubscriberCount(channel.followerCount) }, channel.followerCount) }}
              </span>
            </p>
          </div>
          <div class="channelActions">
            <PlatformFollowButton
              :platform="platform.id"
              :channel-id="channel.id"
            />
            <FtIconButton
              :title="t('Platforms.Open Website', { platform: platform.name })"
              :icon="['fas', 'arrow-up-right-from-square']"
              theme="base-no-default"
              :size="20"
              :padding="8"
              @click="openExternalLink(channel.url)"
            />
          </div>
        </div>
        <p
          v-if="channel.description"
          class="channelDescription"
          dir="auto"
        >
          {{ channel.description }}
        </p>
        <FtTabs
          v-if="platform.channelTabs.length > 1"
          class="channelTabs"
          role="tablist"
          :aria-labelledby="headingId"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
          <div
            v-for="tab in platform.channelTabs"
            :id="`${panelId}-${tab}`"
            :key="tab"
            :ref="element => setTabRef(tab, element)"
            class="tab"
            role="tab"
            :aria-selected="currentTab === tab"
            :aria-controls="panelId"
            :tabindex="currentTab === tab ? 0 : -1"
            :data-channel-tab="tab"
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
        :role="platform.channelTabs.length > 1 ? 'tabpanel' : undefined"
        :aria-labelledby="platform.channelTabs.length > 1 ? `${panelId}-${currentTab}` : undefined"
      >
        <FtLoader v-if="page.loading && page.results.length === 0" />
        <template v-else>
          <p
            v-if="page.error"
            class="message"
          >
            {{ t('Platforms.Load Error', { platform: platform.name }) }}
          </p>
          <p
            v-else-if="page.results.length === 0"
            class="message"
          >
            {{ t('Platforms.Empty Tab') }}
          </p>
          <!-- Later pages try again with their next page button -->
          <FtFlexBox v-if="page.error && !page.loaded">
            <FtButton
              :label="t('User Playlists.SinglePlaylistView.Retry')"
              :icon="['fas', 'sync']"
              @click="loadPage(currentTab)"
            />
          </FtFlexBox>
          <PlatformResultList
            :results="page.results"
            :avatar="channel.avatar ?? null"
          />
          <!-- After a failed page, the button tries again -->
          <FtAutoLoadNextPageWrapper
            v-if="page.continuation !== null"
            :key="currentTab"
            :loading="page.loading"
            :paused="page.error"
            @load-next-page="loadMore"
          >
            <div
              class="getNextPage"
              role="button"
              tabindex="0"
              @click="loadMore"
              @keydown.enter.space.prevent="loadMore"
            >
              <FtIcon :icon="['fas', 'search']" /> {{ t('Search Filters.Fetch more results') }}
            </div>
          </FtAutoLoadNextPageWrapper>
        </template>
      </FtCard>
    </template>
  </div>
</template>

<script setup>
import { computed, reactive, ref, shallowRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtTabs from '../../components/FtTabs/FtTabs.vue'
import PlatformFollowButton from '../../components/PlatformFollowButton/PlatformFollowButton.vue'
import PlatformResultList from '../../components/PlatformResultList/PlatformResultList.vue'

import store from '../../store/index'
import { getPlatformFetch } from '../../helpers/platformFetch'
import { formatSubscriberCount, openExternalLink } from '../../helpers/utils'
import { useTabAvatar, useTabTitle } from '../../tabs/TabContext'
import { getPlatform, PLATFORM_ICONS } from '../../../platforms/index'

const TAB_ICONS = {
  videos: ['fas', 'video'],
  tracks: ['fas', 'music'],
  clips: ['fas', 'film'],
  playlists: ['fas', 'list']
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const setTabTitle = useTabTitle()
const setTabAvatar = useTabAvatar()
const headingId = useId()
const panelId = useId()

const tabLabels = computed(() => ({
  videos: t('Global.Videos'),
  tracks: t('Platforms.Tracks'),
  clips: t('Subscriptions.Platforms.Clips'),
  playlists: t('Platforms.Playlists')
}))

const hideChannelSubscriptions = computed(() => store.getters.getHideChannelSubscriptions)

const platform = computed(() => getPlatform(route.query.platform))
const channelId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformChannel | null>} */
const channel = shallowRef(null)
const isLoading = ref(true)
const notFound = ref(false)
const errorMessage = computed(() => notFound.value || !platform.value
  ? t('Platforms.Channel Not Found')
  : t('Platforms.Load Error', { platform: platform.value.name }))

const currentTab = ref('videos')
/** @type {Record<string, { results: import('../../../platforms/types').PlatformResult[], continuation: string | null, loading: boolean, error: boolean, loaded: boolean }>} */
const pages = reactive({})
const page = computed(() => pages[currentTab.value] ?? { results: [], continuation: null, loading: true, error: false, loaded: false })

let loadGeneration = 0

async function loadChannel() {
  const generation = ++loadGeneration
  isLoading.value = true
  notFound.value = false
  channel.value = null
  for (const key of Object.keys(pages)) delete pages[key]
  if (!platform.value || !channelId.value) {
    notFound.value = true
    isLoading.value = false
    return
  }
  setTabTitle(platform.value.name)
  try {
    const result = await platform.value.getChannel(getPlatformFetch(platform.value.id), channelId.value)
    if (generation !== loadGeneration) return
    channel.value = result
    notFound.value = result === null
    if (result) {
      setTabTitle(result.name)
      if (result.avatar) setTabAvatar(result.avatar)
      const requested = route.query.tab
      currentTab.value = platform.value.channelTabs.includes(requested) ? requested : platform.value.channelTabs[0]
      loadPage(currentTab.value)
    }
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load the channel', error)
  } finally {
    if (generation === loadGeneration) isLoading.value = false
  }
}

/**
 * @param {string} tab
 * @param {boolean} [more] whether to load the next page
 */
async function loadPage(tab, more = false) {
  const generation = loadGeneration
  pages[tab] ??= { results: [], continuation: null, loading: false, error: false, loaded: false }
  // The reactive copy, which renders the changes
  const current = pages[tab]
  if (current.loading || (current.loaded && !more)) return
  current.loading = true
  current.error = false
  try {
    const result = await platform.value.getChannelPage(getPlatformFetch(platform.value.id), channel.value, tab, more ? current.continuation : null)
    if (generation !== loadGeneration) return
    current.results = more ? [...current.results, ...result.results] : result.results
    current.continuation = result.continuation
    current.loaded = true
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load the channel page', error)
    current.error = true
  } finally {
    if (generation === loadGeneration) current.loading = false
  }
}

function loadMore() {
  loadPage(currentTab.value, true)
}

/**
 * @param {string} tab
 */
function changeTab(tab) {
  currentTab.value = tab
  loadPage(tab)
  // Back and reload return to the tab
  if (route.query.tab !== tab) router.replace({ query: { ...route.query, tab } })
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
 * @param {KeyboardEvent} event
 */
function focusNextTab(tab, event) {
  const tabs = platform.value.channelTabs
  const index = tabs.indexOf(tab)
  const next = tabs[(index + (event.key === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length]
  changeTab(next)
  tabRefs.get(next)?.focus()
}

// Only another channel needs loading, not another tab of it
watch([() => route.query.platform, () => route.query.id], loadChannel, { immediate: true })
</script>

<style scoped src="./ExternalChannel.css" />
