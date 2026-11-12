<template>
  <div
    class="ft-list-video ft-list-item"
    :class="{ list: layout === 'list', grid: layout !== 'list' }"
  >
    <div class="videoThumbnail">
      <RouterLink
        class="thumbnailLink"
        :to="route"
        tabindex="-1"
        aria-hidden="true"
      >
        <FtRetryImage
          :src="playlist.thumbnail"
          :fallback-icon="['fas', 'list']"
          class="thumbnailImage"
          :class="{ blur: blurThumbnails }"
          alt=""
        />
      </RouterLink>
      <div
        v-if="playlist.itemCount != null"
        class="videoCountContainer"
      >
        <div class="background" />
        <div class="inner">
          <div>{{ playlist.itemCount }}</div>
          <div>
            <FtIcon
              :icon="['fas', 'list']"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </div>
    <div class="info">
      <RouterLink
        class="title"
        :to="route"
      >
        <h3
          class="h3Title"
          dir="auto"
        >
          {{ playlist.title }}
        </h3>
      </RouterLink>
      <div class="infoLine">
        <component
          :is="channelRoute ? 'router-link' : 'bdi'"
          class="channelName"
          dir="auto"
          :to="channelRoute ?? undefined"
        >
          {{ playlist.author }}
        </component>
        <FtIcon
          v-if="platform"
          class="platformIcon"
          :icon="PLATFORM_ICONS[platform.id]"
          :title="platform.name"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { FtIcon } from '@opentubex/icons'

import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { getPlatform, getPlatformChannelRoute, getPlatformPlaylistRoute, PLATFORM_ICONS } from '../../../platforms/index'

const props = defineProps({
  /** @type {import('vue').PropType<import('../../../platforms/types').PlatformPlaylist>} */
  playlist: {
    type: Object,
    required: true
  },
  layout: {
    type: String,
    default: 'grid'
  }
})

const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
const platform = computed(() => getPlatform(props.playlist.platform))
const route = computed(() => getPlatformPlaylistRoute(props.playlist.platform, props.playlist.id))
const channelRoute = computed(() => props.playlist.channelId
  ? getPlatformChannelRoute(props.playlist.platform, props.playlist.channelId)
  : null)
</script>

<style scoped lang="scss" src="../FtListPlaylist/FtListPlaylist.scss" />

<style scoped>
.platformIcon {
  color: var(--tertiary-text-color);
  flex: none;
  font-size: 0.85em;
  margin-inline-start: 6px;
}
</style>
