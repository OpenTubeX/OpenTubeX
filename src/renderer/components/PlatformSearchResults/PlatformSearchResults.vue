<template>
  <div class="platformSearch">
    <FtLoader v-if="loading && results.length === 0" />
    <template v-else>
      <p
        v-if="error"
        class="searchStatus"
        role="alert"
      >
        {{ t('Platforms.Load Error', { platform: platform.name }) }}
      </p>
      <!-- Later pages try again with their next page button -->
      <FtFlexBox v-if="error && results.length === 0">
        <FtButton
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="search(false)"
        />
      </FtFlexBox>
      <PlatformResultList :results="results" />
      <!-- After a failed page, the button tries again -->
      <FtAutoLoadNextPageWrapper
        v-if="continuation !== null"
        :key="`${platform.id}:${type}:${query}`"
        :loading="loading"
        :paused="error"
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
      <p
        v-else-if="!error"
        class="searchStatus"
        role="status"
      >
        {{ t('Search Filters.There are no more results for this search') }}
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtAutoLoadNextPageWrapper from '../FtAutoLoadNextPageWrapper.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import PlatformResultList from '../PlatformResultList/PlatformResultList.vue'

import { getPlatformFetch } from '../../helpers/platformFetch'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').Platform>} */
  platform: {
    type: Object,
    required: true
  },
  query: {
    type: String,
    required: true
  },
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformSearchType>} */
  type: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

/** @type {import('vue').ShallowRef<import('../../../platforms/types').PlatformResult[]>} */
const results = shallowRef([])
const continuation = ref(/** @type {string | null} */ (null))
const loading = ref(false)
const error = ref(false)
let generation = 0

/**
 * @param {boolean} more whether to load the next page
 */
async function search(more) {
  const current = ++generation
  loading.value = true
  error.value = false
  if (!more) {
    results.value = []
    continuation.value = null
  }
  try {
    const page = await props.platform.search(getPlatformFetch(props.platform.id), props.query, props.type, more ? continuation.value : null)
    if (current !== generation) return
    results.value = more ? [...results.value, ...page.results] : page.results
    continuation.value = page.continuation
  } catch (searchError) {
    if (current !== generation) return
    console.error('Failed to search', searchError)
    error.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

function loadMore() {
  if (!loading.value && continuation.value !== null) search(true)
}

watch([() => props.platform, () => props.query, () => props.type], () => search(false), { immediate: true })
</script>

<style scoped>
.searchStatus {
  margin-block: 32px 16px;
  text-align: center;
  color: var(--tertiary-text-color);
}

/* The radius is half the height rather than full, so the press morph is
   smooth. */
.getNextPage {
  background-color: var(--search-bar-color);
  backdrop-filter: var(--search-bar-blur, none);
  border-radius: calc(22.5px * var(--ui-roundness));
  inline-size: 100%;
  block-size: 45px;
  line-height: 45px;
  text-align: center;
  cursor: pointer;
  margin-block-start: 16px;
  transition: background-color var(--motion-fast-effects), color var(--motion-fast-effects), border-radius var(--motion-fast-spatial);
}

.getNextPage:hover,
.getNextPage:focus {
  background-color: var(--side-nav-hover-color);
  color: var(--side-nav-hover-text-color);
}

.getNextPage:active {
  border-radius: var(--shape-corner-medium);
}
</style>
