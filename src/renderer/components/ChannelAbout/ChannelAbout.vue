<template>
  <div
    class="about"
  >
    <template
      v-if="description"
    >
      <h2>{{ $t("Channel.About.Channel Description") }}</h2>
      <div
        v-safer-html="shownDescription"
        class="aboutInfo"
        dir="auto"
      />
      <FtTranslationButton
        v-if="translationAvailable"
        class="aboutTranslationButton"
        :loading="translationLoading"
        :translated="translatedText !== null"
        :language-name="translationLanguageName"
        :loading-label="$t('Text Translation.Translating, please wait')"
        @click="toggleTranslation"
      />
    </template>
    <section
      v-if="links.length > 0"
      class="aboutLinksSection"
    >
      <h2>{{ $t('Channel.About.Links') }}</h2>
      <ul class="aboutLinks">
        <li
          v-for="(link, index) in links"
          :key="`${link.url}-${index}`"
        >
          <a
            class="aboutLink"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            dir="auto"
            @click="openLinkExternally($event, link.url)"
            @auxclick.middle="openLinkExternally($event, link.url)"
          >
            <span
              class="aboutLinkIcon"
              aria-hidden="true"
            >
              <FtRetryImage
                v-if="link.iconUrl && !failedIcons.has(link.iconUrl)"
                :fallback-icon="['fas', 'link']"
                class="aboutLinkImage"
                :src="link.iconUrl"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="failedIcons.add(link.iconUrl)"
              />
              <FtIcon
                v-else
                class="aboutLinkImage"
                :icon="['fas', 'link']"
              />
            </span>
            <span class="aboutLinkText">
              <span>{{ link.title }}</span>
              <span class="aboutLinkUrl">{{ link.url }}</span>
            </span>
          </a>
        </li>
      </ul>
    </section>
    <template
      v-if="joined || views !== null || videos !== null || location"
    >
      <h2>{{ $t('Channel.About.Details') }}</h2>
      <table
        class="aboutDetails"
      >
        <tr
          v-if="joined"
        >
          <th
            scope="row"
          >
            {{ $t('Channel.About.Joined') }}
          </th>
          <td>{{ formattedJoined }}</td>
        </tr>
        <tr
          v-if="views !== null"
        >
          <th
            scope="row"
          >
            {{ $t('Video.Views') }}
          </th>
          <td>{{ formattedViews }}</td>
        </tr>
        <tr
          v-if="videos !== null"
        >
          <th
            scope="row"
          >
            {{ $t('Global.Videos') }}
          </th>
          <td>{{ formattedVideos }}</td>
        </tr>
        <tr
          v-if="location"
        >
          <th
            scope="row"
          >
            {{ $t('Channel.About.Location') }}
          </th>
          <td
            dir="auto"
          >
            {{ location }}
          </td>
        </tr>
      </table>
    </template>
    <template
      v-if="!hideFeaturedChannels && relatedChannels.length > 0"
    >
      <h2>{{ $t("Channel.About.Featured Channels") }}</h2>
      <FtFlexBox>
        <FtChannelBubble
          v-for="channel in relatedChannels"
          :key="channel.id"
          :channel-id="channel.id"
          :channel-name="channel.name"
          :channel-thumbnail="channel.thumbnailUrl"
        />
      </FtFlexBox>
    </template>
    <template
      v-if="tags.length > 0"
    >
      <h2>{{ $t('Channel.About.Tags.Tags') }}</h2>
      <ul
        class="aboutTags"
      >
        <li
          v-for="tag in tags"
          :key="tag"
          class="aboutTag"
          dir="auto"
        >
          <router-link
            v-if="!hideSearchBar"
            class="aboutTagLink"
            :title="$t('Channel.About.Tags.Search for', { tag })"
            :data-tab-title="tag"
            :to="{
              path: `/search/${encodeURIComponent(tag)}`,
              query: searchSettings
            }"
          >
            {{ tag }}
          </router-link>
          <span
            v-else
            class="aboutTagLink"
          >
            {{ tag }}
          </span>
        </li>
      </ul>
    </template>
    <FtFixedBackground />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import autolinker from 'autolinker'
import { computed, inject, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import FtChannelBubble from '../../components/FtChannelBubble/FtChannelBubble.vue'
import FtFixedBackground from '../FtFixedBackground/FtFixedBackground.vue'
import FtRetryImage from '../FtRetryImage.vue'
import FtTranslationButton from '../FtTranslationButton/FtTranslationButton.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'
import { useTextTranslation } from '../../composables/useTextTranslation'

import { formatNumber } from '../../helpers/utils'
import { formatDate } from '../../helpers/dateFormat'
import { escapeHTML } from '../../helpers/feed-metadata'

const { locale } = useI18n()
const handleExternalLink = inject('handleExternalLink')
const dateFormat = computed(() => store.getters.getDateFormat)
const { tabId: injectedTabId } = useTabContext()
const tabId = injectedTabId ?? 'web'
const failedIcons = reactive(new Set())

const props = defineProps({
  /** Plain text */
  description: {
    type: String,
    default: ''
  },
  joined: {
    type: Number,
    default: 0
  },
  views: {
    type: Number,
    default: null
  },
  videos: {
    type: Number,
    default: null
  },
  location: {
    type: String,
    default: null
  },
  links: {
    type: Array,
    default: () => []
  },
  tags: {
    type: Array,
    default: () => []
  },
  relatedChannels: {
    type: Array,
    default: () => []
  }
})

const {
  available: translationAvailable,
  loading: translationLoading,
  translatedText,
  targetLanguageName: translationLanguageName,
  toggleTranslation
} = useTextTranslation(() => props.description)
const shownDescription = computed(() => autolinker.link(escapeHTML(translatedText.value ?? props.description)))

/** @type {import('vue').ComputedRef<boolean>} */
const hideFeaturedChannels = computed(() => {
  return store.getters.getHideFeaturedChannels
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSearchBar = computed(() => {
  return store.getters.getHideSearchBar
})

/** @type {import('vue').ComputedRef<{ sortBy: string, time: string, type: string, duration: string, features: string[] }>} */
const searchSettings = computed(() => {
  return store.getters.getSearchSettings(tabId)
})

const formattedJoined = computed(() => {
  return formatDate(props.joined, locale.value, dateFormat.value, { dateStyle: 'long' })
})

/**
 * The document link handler opens YouTube links in the app and applies the
 * external link setting to other sites. It skips same-origin links (web build)
 * and channel membership pages only work in the browser, so handle those here.
 * @param {MouseEvent} event
 * @param {string} url
 */
function openLinkExternally(event, url) {
  const { origin, pathname } = new URL(url)
  if (origin !== window.location.origin && !/\/join\/?$/.test(pathname)) return

  event.preventDefault()
  event.stopPropagation()
  handleExternalLink(url, { background: event.type === 'auxclick' })
}

const formattedViews = computed(() => formatNumber(props.views))
const formattedVideos = computed(() => formatNumber(props.videos))
</script>

<style scoped src="./ChannelAbout.css" />
