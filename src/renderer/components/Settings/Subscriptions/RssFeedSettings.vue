<template>
  <FtSettingsSection :title="t('Settings.Subscription Settings.RSS Feeds')">
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Subscription Settings.Enable RSS Feeds')"
        :default-value="enableRssFeeds"
        setting-key="enableRssFeeds"
        :tooltip="t('Tooltips.Subscription Settings.Enable RSS Feeds')"
        :compact="true"
        @change="value => store.dispatch('updateEnableRssFeeds', value)"
      />
    </FtFlexBox>
    <FtFlexBox v-if="enableRssFeeds">
      <FtButton
        :label="t('Settings.Subscription Settings.Manage RSS Feeds')"
        :icon="['fas', 'rss']"
        data-settings-subpage="rss-feeds"
        @click="showManager = true"
      />
    </FtFlexBox>
    <FtSettingsSubpage
      :open="showManager"
      :title="t('Settings.Subscription Settings.RSS Feeds')"
      :icon="['fas', 'rss']"
      @close="showManager = false"
    >
      <div class="rssFeedsHeader">
        <Translation
          keypath="Subscriptions.RSS Feeds.Description"
          tag="p"
        >
          <template #rssHub>
            <a :href="RSSHUB_URL">{{ RSSHUB_NAME }}</a>
          </template>
        </Translation>
        <a
          class="instancesLink"
          :href="RSSHUB_INSTANCES_URL"
        >
          <FtIcon
            :icon="['fas', 'external-link-alt']"
            aria-hidden="true"
          />
          {{ t('Subscriptions.RSS Feeds.Public RSSHub Instances') }}
        </a>
        <div class="feedInput">
          <FtInput
            ref="feedInput"
            :label="t('Subscriptions.RSS Feeds.Add Feed')"
            :placeholder="t('Subscriptions.RSS Feeds.Feed URL')"
            :icon="['fas', 'rss']"
            :show-label="true"
            :show-action-button="true"
            :action-button-label="t('Subscriptions.RSS Feeds.Add Feed')"
            :force-action-button-icon-name="['fas', 'plus']"
            :disabled="isAdding"
            @click="addFeed"
          />
          <div
            v-if="isAdding"
            class="addFeedProgress"
            role="progressbar"
            :aria-label="t('Subscriptions.RSS Feeds.Add Feed')"
          />
        </div>
      </div>
      <div
        ref="feedScroller"
        v-overlay-scrollbars
        class="rssFeedsScroller"
      >
        <div ref="feedContent">
          <p
            v-if="feeds.length === 0"
            class="emptyState"
          >
            {{ t('Subscriptions.RSS Feeds.No Feeds') }}
          </p>
          <ul
            v-else
            class="feedList"
            :aria-label="t('Subscriptions.RSS Feeds.Followed Feeds')"
          >
            <li
              v-for="feed in feeds"
              :key="feed.url"
              class="feedRow"
              :class="{ hasError: errorFeedUrls.has(feed.url) }"
            >
              <FtIcon
                v-if="errorFeedUrls.has(feed.url)"
                class="feedIcon"
                :icon="['fas', 'circle-exclamation']"
                aria-hidden="true"
              />
              <FtRetryImage
                v-else-if="feed.avatar"
                class="feedIcon feedAvatar"
                :src="feed.avatar"
                :fallback-icon="['fas', 'rss']"
                alt=""
              />
              <FtIcon
                v-else
                class="feedIcon"
                :icon="['fas', 'rss']"
                aria-hidden="true"
              />
              <div class="feedText">
                <bdi class="feedTitle">{{ feed.title || feed.url }}</bdi>
                <span class="feedUrl">{{ feed.url }}</span>
              </div>
              <FtIconButton
                v-if="errorFeedUrls.has(feed.url)"
                :title="t('Subscriptions.RSS Feeds.Retry Feed', { feed: feed.title || feed.url })"
                :icon="['fas', 'sync']"
                theme="base-no-default"
                :size="16"
                :padding="8"
                :disabled="retryingFeedUrls.has(feed.url)"
                @click="retryFeed(feed)"
              />
              <FtIconButton
                :title="t('Subscriptions.RSS Feeds.Remove Feed', { feed: feed.title || feed.url })"
                :icon="['fas', 'trash']"
                theme="base-no-default"
                :size="16"
                :padding="8"
                @click="removeFeed(feed)"
              />
            </li>
          </ul>
        </div>
      </div>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { Translation, useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../FtIconButton/FtIconButton.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtRetryImage from '../../FtRetryImage.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import {
  addLoadedRssFeed,
  fetchRssFeed,
  normalizeHttpUrl,
  retryRssFeed,
  rssFeedErrors,
  updateMissingRssFeedAvatars
} from '../../../helpers/rssFeeds'
import { showToast } from '../../../helpers/utils'

const RSSHUB_NAME = 'RSSHub'
const RSSHUB_URL = 'https://github.com/DIYgod/RSSHub'
const RSSHUB_INSTANCES_URL = 'https://docs.rsshub.app/guide/instances'

const { t } = useI18n()

const enableRssFeeds = computed(() => store.getters.getEnableRssFeeds)
/** @type {import('vue').ComputedRef<import('../../../helpers/rssFeeds').RssFeed[]>} */
const feeds = computed(() => store.getters.getFollowedRssFeeds)
const errorFeedUrls = computed(() => new Set(rssFeedErrors.value))

const showManager = ref(false)
const isAdding = ref(false)
const feedInput = useTemplateRef('feedInput')
const feedScroller = useTemplateRef('feedScroller')
const feedContent = useTemplateRef('feedContent')

watch(enableRssFeeds, enabled => {
  if (!enabled) showManager.value = false
})

// Removing feeds shortens the list, which can leave the viewport past its end
let contentResizeObserver = null
let observationGeneration = 0

watch(showManager, async (open) => {
  const generation = ++observationGeneration
  stopObservingContent()
  if (!open) return

  await nextTick()
  if (generation !== observationGeneration || !showManager.value) return
  const scroller = feedScroller.value
  const content = feedContent.value
  if (!scroller || !content) return

  const clampScroll = () => clampOverlayScrollTop(scroller, content)
  contentResizeObserver = new ResizeObserver(clampScroll)
  contentResizeObserver.observe(scroller)
  contentResizeObserver.observe(content)
  clampScroll()
})

onBeforeUnmount(() => {
  observationGeneration += 1
  stopObservingContent()
})

function stopObservingContent() {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
}

/**
 * @param {string} text
 */
async function addFeed(text) {
  if (isAdding.value) return

  const url = normalizeHttpUrl(text)
  if (url === null) {
    showToast({ message: t('Subscriptions.RSS Feeds.Invalid Feed URL'), icon: ['fas', 'circle-exclamation'] })
    return
  }
  if (feeds.value.some(feed => feed.url === url)) {
    showToast({ message: t('Subscriptions.RSS Feeds.Feed Already Followed'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  isAdding.value = true
  try {
    // Loading the feed first rejects addresses that aren't feeds and finds its title
    const result = await fetchRssFeed(url)
    const feed = { url, title: result.title }
    // Cached before saving, so that the RSS tab doesn't reload every feed for the new one
    addLoadedRssFeed(feed, result)
    if (await store.dispatch('updateFollowedRssFeeds', [...feeds.value, feed]) === false) {
      throw new Error('The feed could not be saved')
    }
    feedInput.value?.clear()
    updateMissingRssFeedAvatars([[feed, result]])
  } catch {
    showToast({ message: t('Subscriptions.RSS Feeds.Feed Could Not Be Loaded'), icon: ['fas', 'circle-exclamation'] })
  } finally {
    isAdding.value = false
  }
}

const retryingFeedUrls = shallowRef(new Set())

/**
 * @param {import('../../../helpers/rssFeeds').RssFeed} feed
 */
async function retryFeed(feed) {
  retryingFeedUrls.value = new Set([...retryingFeedUrls.value, feed.url])
  try {
    await retryRssFeed(feed)
  } catch {
    showToast({ message: t('Subscriptions.RSS Feeds.Feed Could Not Be Loaded'), icon: ['fas', 'circle-exclamation'] })
  } finally {
    retryingFeedUrls.value = new Set([...retryingFeedUrls.value].filter(url => url !== feed.url))
  }
}

/**
 * @param {import('../../../helpers/rssFeeds').RssFeed} feed
 */
function removeFeed(feed) {
  store.dispatch('updateFollowedRssFeeds', feeds.value.filter(({ url }) => url !== feed.url))
}
</script>

<style scoped src="./RssFeedSettings.css" />
