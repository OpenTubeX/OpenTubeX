<template>
  <div
    class="popularPage"
  >
    <ft-card
      class="card"
    >
      <div class="pageHeader">
        <div class="titleRow">
          <h2 class="pageTitle">
            <FtIcon
              :icon="['fas', 'users']"
              class="headingIcon"
            />
            {{ $t("Most Popular") }}
          </h2>
          <ft-refresh-widget
            embedded
            class="headerRefreshWidget"
            :disable-refresh="isLoading"
            :last-refresh-timestamp="lastPopularRefreshTimestamp"
            :title="$t('Most Popular')"
            @click="fetchPopularInfo"
          />
        </div>
        <FtFixedBackground />
      </div>
      <ft-loader
        v-if="isLoading"
      />
      <ft-element-list
        v-else-if="shownResults.length > 0"
        :data="shownResults"
      />
      <p
        v-else-if="hasLoaded"
        class="emptyMessage"
        role="status"
      >
        {{ $t("Most Popular Feed Empty") }}
      </p>
      <p
        v-else-if="loadFailed"
        class="emptyMessage"
        role="status"
      >
        {{ $t("Most Popular Load Error") }}
      </p>
    </ft-card>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref, shallowRef } from 'vue'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFixedBackground from '../../components/FtFixedBackground/FtFixedBackground.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'
import store from '../../store/index'

import { getInvidiousPopularFeed } from '../../helpers/api/invidious'
import { getInvidiousApiErrorMessage, getRelativeTimeFromDate, showApiErrorToast } from '../../helpers/utils'
import { useFeedRefreshShortcut } from '../../composables/useFeedRefreshShortcut'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'

const isLoading = ref(false)
const relativeTimeNow = useRelativeTimeClock()

const lastPopularRefreshTimestamp = computed(() => {
  return getRelativeTimeFromDate(store.getters.getLastPopularRefreshTimestamp, true, true, relativeTimeNow.value)
})

/** @type {import('vue').ComputedRef<Array | null>} */
const popularCache = computed(() => {
  return store.getters.getPopularCache
})

const shownResults = shallowRef(popularCache.value || [])
const hasLoaded = ref(popularCache.value !== null)
const loadFailed = ref(false)

onMounted(() => {
  if (shownResults.value.length === 0) {
    fetchPopularInfo()
  }
})

async function fetchPopularInfo() {
  isLoading.value = true
  hasLoaded.value = false
  loadFailed.value = false

  try {
    const items = await getInvidiousPopularFeed()

    store.commit('setLastPopularRefreshTimestamp', new Date())
    shownResults.value = items
    hasLoaded.value = true
    isLoading.value = false
    store.commit('setPopularCache', items)
  } catch (err) {
    isLoading.value = false
    loadFailed.value = true
    const errorMessage = getInvidiousApiErrorMessage(store.getters.getBackendPreference)
    showApiErrorToast(errorMessage, err)
  }
}

useFeedRefreshShortcut(() => !isLoading.value, fetchPopularInfo)

</script>
<style scoped src="./Popular.css" />
