<template>
  <div
    class="ft-list-video ft-list-item"
    :class="{ list: layout === 'list', grid: layout !== 'list' }"
    @contextmenu="openContextMenu"
    @keydown="handleMenuKeydown"
    @pointerdown="startMenuHold"
    @pointermove="moveMenuHold"
    @pointerup="cancelMenuHold"
    @pointercancel="cancelMenuHold"
    @dragstart="handleMenuHoldDragStart"
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
        :title="titleLineLimit > 0 ? playlist.title : null"
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
      <div class="buttonStack playlistButtonStack">
        <FtIconButton
          v-if="store.getters.getShowVideoMenuButton"
          ref="menuButton"
          class="optionsButton"
          :title="t('Video.More Options')"
          :icon="['fas', 'ellipsis-v']"
          theme="base-no-default"
          :size="16"
          @click="openOptionsMenu(menuButton.$el.querySelector('button'))"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { useCardContextMenu } from '../../composables/useCardContextMenu'
import { copyToClipboard, openExternalLink, openInternalPath, shareLink } from '../../helpers/utils'
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
// Titles cut to a few lines show in full on hover
const titleLineLimit = computed(() => store.getters.getTitleLineLimit)
const platform = computed(() => getPlatform(props.playlist.platform))
const route = computed(() => getPlatformPlaylistRoute(props.playlist.platform, props.playlist.id))
const channelRoute = computed(() => props.playlist.channelId
  ? getPlatformChannelRoute(props.playlist.platform, props.playlist.channelId)
  : null)

const { t } = useI18n()

const menuItems = computed(() => {
  const items = []
  if (store.getters.getTabsEnabled) {
    items.push({
      label: t('Context Menu.Open in a New Tab'),
      shortLabel: t('New Tab'),
      icon: ['fas', 'arrow-up-right-from-square'],
      quickAction: true,
      run: () => openInternalPath({ ...route.value, title: props.playlist.title, doCreateNewTab: true })
    })
  }
  if (process.env.IS_ELECTRON) {
    items.push({
      label: t('Context Menu.Open in a New Window'),
      shortLabel: t('New Window'),
      icon: ['fas', 'external-link-alt'],
      quickAction: true,
      run: () => openInternalPath({ ...route.value, title: props.playlist.title, doCreateNewWindow: true })
    })
  }
  if (items.length > 0) items.push({ type: 'separator' })
  items.push({
    label: t('Share.Copy Link'),
    icon: ['fas', 'link'],
    run: () => copyToClipboard(props.playlist.url)
  }, {
    label: t('Platforms.Open Website', { platform: platform.value?.name ?? props.playlist.platform }),
    icon: PLATFORM_ICONS[props.playlist.platform] ?? ['fas', 'external-link-alt'],
    run: () => openExternalLink(props.playlist.url)
  })
  if (process.env.IS_CAPACITOR) {
    items.push({ label: t('Share.Share Link'), icon: ['fas', 'share-alt'], run: () => shareLink(props.playlist.url) })
  }
  return items.map(item => item.type === 'separator' ? item : { enabled: true, ...item })
})

const menuButton = useTemplateRef('menuButton')
const {
  startMenuHold, moveMenuHold, cancelMenuHold, handleMenuHoldDragStart,
  openContextMenu, openOptionsMenu, handleMenuKeydown,
} = useCardContextMenu({ items: menuItems, title: () => props.playlist.title })
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
