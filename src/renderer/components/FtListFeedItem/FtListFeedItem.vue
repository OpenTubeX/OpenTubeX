<template>
  <div
    class="ft-list-video ft-list-item result"
    :class="{ grid: layout === 'grid', list: layout === 'list', watched: watchProgress?.watched }"
  >
    <div class="videoThumbnail">
      <RouterLink
        class="thumbnailLink"
        tabindex="-1"
        :to="to"
        :aria-label="data.title"
      >
        <FtRetryImage
          v-if="data.thumbnail"
          :src="data.thumbnail"
          class="thumbnailImage"
          :class="{ blur: blurThumbnails }"
          alt=""
        />
        <span
          v-else
          class="thumbnailImage thumbnailPlaceholder"
        >
          <FtIcon
            :icon="['fas', 'rss']"
            aria-hidden="true"
          />
        </span>
        <FtEmbeddedProgress
          v-if="watchProgress"
          class="watchedProgressBar"
          :progress="watchProgress.progress * 100"
          :corner-radius="thumbnailProgressRadius"
          :end-arc-fraction="0.5"
          :line-width="3"
          :start-arc-fraction="0.5"
        />
      </RouterLink>
      <div
        v-if="watchProgress?.watched"
        class="videoWatched"
      >
        {{ t('Video.Watched') }}
      </div>
    </div>
    <div class="info">
      <RouterLink
        class="title"
        :to="to"
      >
        <h3
          class="h3Title"
          dir="auto"
        >
          {{ data.title }}
        </h3>
      </RouterLink>
      <div class="infoLine">
        <bdi class="channelName">
          <FtChannelAvatar
            v-if="avatar && !hideChannelAvatars"
            :thumbnail="avatar"
          />
          <span class="channelNameText">{{ data.author }}</span>
        </bdi>
        <FtInlineMetadata
          v-if="publishedText"
          class="videoInfo"
          icon-labels
        >
          <span class="uploadedTime"><FtIcon
            :icon="['fas', 'clock']"
            class="statIcon"
            aria-hidden="true"
          />{{ publishedText }}</span>
        </FtInlineMetadata>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtChannelAvatar from '../FtChannelAvatar/FtChannelAvatar.vue'
import FtEmbeddedProgress from '../FtEmbeddedProgress/FtEmbeddedProgress.vue'
import FtInlineMetadata from '../FtInlineMetadata/FtInlineMetadata.vue'
import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { getExternalMediaProgress } from '../../helpers/externalMediaPosition'
import { getRelativeTimeFromDate } from '../../helpers/utils'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../helpers/rssFeeds').RssFeedItem>} */
  data: {
    type: Object,
    required: true
  },
  layout: {
    type: String,
    default: 'grid'
  },
  /** The avatar of the feed's creator */
  avatar: {
    type: String,
    default: null
  }
})

const { t } = useI18n()

const now = useRelativeTimeClock()
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
const hideChannelAvatars = computed(() => store.getters.getHideChannelAvatars)
const thumbnailProgressRadius = computed(() => 8 * store.getters.getUiRoundness / 100)
// The external media page saves the position of everything it plays
const watchProgress = computed(() => {
  const progress = getExternalMediaProgress(props.data.url)
  return progress && progress.progress > 0 ? progress : null
})
const to = computed(() => ({ path: '/external-media', query: { url: props.data.url } }))
const publishedText = computed(() => props.data.published === null
  ? ''
  : getRelativeTimeFromDate(props.data.published, false, true, now.value))
</script>

<style scoped lang="scss" src="./FtListFeedItem.scss" />
