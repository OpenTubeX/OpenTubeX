<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else-if="!playlist"
      class="card"
    >
      <p class="message">
        {{ notFound ? t('Platforms.Playlist Not Found') : t('Platforms.Load Error', { platform: platform?.name ?? '' }) }}
      </p>
      <FtFlexBox>
        <FtButton
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="loadPlaylist"
        />
      </FtFlexBox>
    </FtCard>
    <FtCard
      v-else
      class="card"
    >
      <div class="playlistHeader">
        <div class="playlistInfo">
          <h2
            class="playlistTitle"
            dir="auto"
          >
            {{ playlist.title }}
          </h2>
          <p class="playlistMeta">
            <span>
              <FtIcon
                :icon="PLATFORM_ICONS[platform.id]"
                aria-hidden="true"
              />
              {{ platform.name }}
            </span>
            <component
              :is="channelRoute ? 'router-link' : 'span'"
              v-if="playlist.author"
              :to="channelRoute ?? undefined"
              dir="auto"
            >
              {{ playlist.author }}
            </component>
            <span v-if="playlist.itemCount != null">
              {{ t('Global.Counts.Video Count', { count: playlist.itemCount }, playlist.itemCount) }}
            </span>
          </p>
        </div>
        <FtIconButton
          :title="t('Platforms.Open Website', { platform: platform.name })"
          :icon="['fas', 'arrow-up-right-from-square']"
          theme="base-no-default"
          :size="20"
          :padding="8"
          @click="openExternalLink(playlist.url)"
        />
      </div>
      <p
        v-if="pageError"
        class="message"
      >
        {{ t('Platforms.Load Error', { platform: platform.name }) }}
      </p>
      <p
        v-else-if="results.length === 0"
        class="message"
      >
        {{ t('Platforms.Empty Tab') }}
      </p>
      <PlatformResultList :results="results" />
      <FtAutoLoadNextPageWrapper
        v-if="continuation !== null && !pageError"
        :loading="loadingMore"
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
    </FtCard>
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import PlatformResultList from '../../components/PlatformResultList/PlatformResultList.vue'

import { getPlatformFetch } from '../../helpers/platformFetch'
import { openExternalLink } from '../../helpers/utils'
import { useTabTitle } from '../../tabs/TabContext'
import { getPlatform, getPlatformChannelRoute, PLATFORM_ICONS } from '../../../platforms/index'

const { t } = useI18n()
const route = useRoute()
const setTabTitle = useTabTitle()

const platform = computed(() => getPlatform(route.query.platform))
const playlistId = computed(() => typeof route.query.id === 'string' ? route.query.id : '')

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformPlaylist | null>} */
const playlist = shallowRef(null)
/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformResult[]>} */
const results = shallowRef([])
const continuation = ref(/** @type {string | null} */ (null))
const isLoading = ref(true)
const loadingMore = ref(false)
const notFound = ref(false)
const pageError = ref(false)
const channelRoute = computed(() => playlist.value?.channelId
  ? getPlatformChannelRoute(playlist.value.platform, playlist.value.channelId)
  : null)

let loadGeneration = 0

async function loadPlaylist() {
  const generation = ++loadGeneration
  isLoading.value = true
  notFound.value = false
  pageError.value = false
  playlist.value = null
  results.value = []
  continuation.value = null
  if (!platform.value || !playlistId.value) {
    notFound.value = true
    isLoading.value = false
    return
  }
  setTabTitle(platform.value.name)
  try {
    const result = await platform.value.getPlaylist(getPlatformFetch(platform.value.id), playlistId.value, null)
    if (generation !== loadGeneration) return
    playlist.value = result.playlist
    notFound.value = result.playlist === null
    results.value = result.page.results
    continuation.value = result.page.continuation
    if (result.playlist) setTabTitle(result.playlist.title)
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load the playlist', error)
  } finally {
    if (generation === loadGeneration) isLoading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || continuation.value === null) return
  const generation = loadGeneration
  loadingMore.value = true
  try {
    const result = await platform.value.getPlaylist(getPlatformFetch(platform.value.id), playlistId.value, continuation.value)
    if (generation !== loadGeneration) return
    results.value = [...results.value, ...result.page.results]
    continuation.value = result.page.continuation
  } catch (error) {
    if (generation !== loadGeneration) return
    console.error('Failed to load more of the playlist', error)
    pageError.value = true
  } finally {
    if (generation === loadGeneration) loadingMore.value = false
  }
}

watch([() => route.query.platform, () => route.query.id], loadPlaylist, { immediate: true })
</script>

<style scoped src="../ExternalChannel/ExternalChannel.css" />
<style scoped>
.playlistHeader {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.playlistInfo {
  flex: 1;
  min-inline-size: 0;
}

.playlistTitle {
  margin-block-end: 0;
  overflow-wrap: anywhere;
}

.playlistMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-block: 4px 16px;
  color: var(--tertiary-text-color);
}
</style>
