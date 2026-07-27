<template>
  <div
    class="popularPage"
    :class="{ hasTabBar: hasHorizontalTabBar }"
  >
    <ft-card
      class="card"
    >
      <div class="pageHeader">
        <div class="titleRow">
          <h2 class="pageTitle">
            <FontAwesomeIcon
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
      </div>
      <ft-loader
        v-if="isLoading"
      />
      <ft-element-list
        v-else
        :data="shownResults"
      />
    </ft-card>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtRefreshWidget from '../../components/FtRefreshWidget/FtRefreshWidget.vue'
import store from '../../store/index'

import { getInvidiousPopularFeed } from '../../helpers/api/invidious'
import { getRelativeTimeFromDate, showApiErrorToast } from '../../helpers/utils'
import { useI18n } from 'vue-i18n'
import { KeyboardShortcuts } from '../../../constants'
import { matchesKeyboardShortcut } from '../../helpers/keyboardShortcuts'

const { t } = useI18n()

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const hasHorizontalTabBar = computed(() => isElectron && !store.getters.getUseVerticalTabBar)

const isLoading = ref(false)

const lastPopularRefreshTimestamp = computed(() => {
  return getRelativeTimeFromDate(store.getters.getLastPopularRefreshTimestamp, true)
})

/** @type {import('vue').ComputedRef<Array | null>} */
const popularCache = computed(() => {
  return store.getters.getPopularCache
})

const shownResults = shallowRef(popularCache.value || [])

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)

  if (shownResults.value.length === 0) {
    fetchPopularInfo()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})

async function fetchPopularInfo() {
  isLoading.value = true

  try {
    const items = await getInvidiousPopularFeed()

    store.commit('setLastPopularRefreshTimestamp', new Date())
    shownResults.value = items
    isLoading.value = false
    store.commit('setPopularCache', items)
  } catch (err) {
    isLoading.value = false
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
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
    !isLoading.value
  ) {
    fetchPopularInfo()
  }
}

</script>
<style scoped src="./Popular.css" />
