<template>
  <FtPrompt
    autosize
    fixed-layout
    :label="t('Subscriptions.RSS Feeds.Podcasts.Title')"
    @click="emit('close')"
  >
    <div class="podcastSearchForm">
      <p class="formHint">
        {{ t('Subscriptions.RSS Feeds.Podcasts.Description') }}
      </p>
      <FtInput
        ref="searchInput"
        :label="t('Subscriptions.RSS Feeds.Podcasts.Search')"
        :placeholder="t('Subscriptions.RSS Feeds.Podcasts.Search Placeholder')"
        :icon="['fas', 'podcast']"
        :show-label="true"
        :show-action-button="true"
        :action-button-label="t('Subscriptions.RSS Feeds.Podcasts.Search')"
        :force-action-button-icon-name="['fas', 'magnifying-glass']"
        @click="search"
      />
      <FtLoader
        v-if="loading"
        inline
        :label="t('Subscriptions.RSS Feeds.Podcasts.Searching')"
        :tab-loading-indicator="false"
      />
      <p
        v-else-if="failed"
        class="formMessage error"
        role="alert"
      >
        <FtIcon
          :icon="['fas', 'circle-exclamation']"
          aria-hidden="true"
        />
        {{ t('Subscriptions.RSS Feeds.Podcasts.Search Failed') }}
      </p>
      <p
        v-else-if="results?.length === 0"
        class="formMessage"
        role="status"
      >
        {{ t('Subscriptions.RSS Feeds.Podcasts.No Results') }}
      </p>
      <ul
        v-else-if="results"
        class="results"
        :aria-label="t('Subscriptions.RSS Feeds.Podcasts.Results')"
      >
        <li
          v-for="result in results"
          :key="result.feedUrl"
          class="result"
        >
          <FtRetryImage
            v-if="result.artwork"
            class="artwork"
            :src="result.artwork"
            :fallback-icon="['fas', 'podcast']"
            alt=""
          />
          <span
            v-else
            class="artwork artworkPlaceholder"
          >
            <FtIcon
              :icon="['fas', 'podcast']"
              aria-hidden="true"
            />
          </span>
          <div class="resultText">
            <bdi class="resultTitle">{{ result.title }}</bdi>
            <bdi
              v-if="result.author"
              class="resultAuthor"
            >{{ result.author }}</bdi>
          </div>
          <FtButton
            v-if="followedUrls.has(result.feedUrl)"
            class="followButton"
            :label="t('Subscriptions.Platforms.Following')"
            :icon="['fas', 'check']"
            :disabled="true"
          />
          <FtButton
            v-else
            class="followButton"
            :label="t('Subscriptions.Platforms.Follow')"
            :icon="['fas', 'plus']"
            :aria-label="t('Subscriptions.RSS Feeds.Podcasts.Follow Podcast', { podcast: result.title })"
            @click="emit('add', result.feedUrl)"
          />
        </li>
      </ul>
    </div>
    <template #footer>
      <FtFlexBox>
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="emit('close')"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtLoader from '../../FtLoader/FtLoader.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import FtRetryImage from '../../FtRetryImage.vue'

import store from '../../../store/index'
import { searchPodcasts } from '../../../helpers/podcasts'

const emit = defineEmits(['add', 'close'])

const { t } = useI18n()

/** @type {import('vue').ComputedRef<Set<string>>} */
const followedUrls = computed(() => new Set(store.getters.getFollowedRssFeeds.map(feed => feed.url)))

/** @type {import('vue').ShallowRef<import('../../../helpers/podcasts').PodcastSearchResult[] | null>} */
const results = shallowRef(null)
const loading = ref(false)
const failed = ref(false)
const searchInput = useTemplateRef('searchInput')

/** @type {AbortController | null} */
let activeSearch = null

onMounted(async () => {
  // After the prompt focused its first button
  await nextTick()
  searchInput.value?.focus()
})

onBeforeUnmount(() => activeSearch?.abort())

/**
 * @param {string} text
 */
async function search(text) {
  const query = text.trim()
  if (query === '') return

  activeSearch?.abort()
  const controller = new AbortController()
  activeSearch = controller
  loading.value = true
  failed.value = false
  try {
    const found = await searchPodcasts(query, controller.signal)
    if (controller.signal.aborted) return
    results.value = found
  } catch (error) {
    if (controller.signal.aborted) return
    console.error('Failed to search podcasts', error)
    results.value = null
    failed.value = true
  } finally {
    if (activeSearch === controller) {
      activeSearch = null
      loading.value = false
    }
  }
}
</script>

<style scoped src="./PodcastSearchPrompt.css" />
