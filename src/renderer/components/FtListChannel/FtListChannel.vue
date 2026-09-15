<template>
  <div
    class="ft-list-channel ft-list-item"
    :class="{
      list: listType === 'list',
      grid: listType === 'grid',
      [appearance]: true
    }"
  >
    <div class="channelThumbnail">
      <component
        :is="enableChannelLinks ? 'router-link' : 'div'"
        :to="`/channel/${id}`"
        class="channelThumbnailLink"
        tabindex="-1"
        aria-hidden="true"
      >
        <FtRetryImage
          :src="thumbnail"
          :class="!isGame ? 'channelImage' : 'gameImage'"
          alt=""
        />
      </component>
    </div>
    <div class="infoAndSubscribe">
      <div class="info">
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          class="title"
          :to="`/channel/${id}`"
        >
          <h3
            class="h3Title"
            dir="auto"
          >
            {{ name }}
          </h3>
        </component>
        <div
          ref="metadataLine"
          class="infoLine"
          :class="{ metadataWrapped }"
        >
          <component
            :is="enableChannelLinks ? 'router-link' : 'span'"
            v-if="handle !== null"
            class="handle"
            dir="auto"
            :to="`/channel/${id}`"
          >
            {{ handle }}
          </component>
          <span
            v-if="subscriberCount !== null && !hideChannelSubscriptions"
            class="subscriberCount"
            :class="{ hasMetadataSeparator: handle !== null }"
          >
            {{ $t('Global.Counts.Subscriber Count', {count: formattedSubscriberCount}, subscriberCount) }}
          </span>
          <span
            v-if="handle == null && videoCount != null"
            class="videoCount"
            :class="{ hasMetadataSeparator: subscriberCount !== null && !hideChannelSubscriptions }"
          >
            {{ $t('Global.Counts.Video Count', {count: formattedVideoCount}, videoCount) }}
          </span>
        </div>
        <p
          v-if="listType !== 'grid'"
          v-safer-html="description"
          class="description"
          dir="auto"
        />
      </div>
      <FtSubscribeButton
        v-if="!hideUnsubscribeButton"
        class="channelSubscribeButton"
        :channel-id="id"
        :channel-name="name"
        :channel-thumbnail="thumbnail"
      />
    </div>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import { vSaferHtml } from '../../directives/vSaferHtml'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { formatNumber } from '../../helpers/utils'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  appearance: {
    type: String,
    required: true
  }
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const listType = computed(() => {
  return store.getters.getListType
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelSubscriptions = computed(() => {
  return store.getters.getHideChannelSubscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => {
  return store.getters.getHideUnsubscribeButton
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

const metadataLine = useTemplateRef('metadataLine')
const metadataWrapped = ref(false)
let metadataResizeObserver = null

function updateMetadataWrapping() {
  const [firstItem, secondItem] = metadataLine.value?.children ?? []
  metadataWrapped.value = firstItem != null && secondItem != null &&
    Math.abs(firstItem.getBoundingClientRect().top - secondItem.getBoundingClientRect().top) > 1
}

onMounted(() => {
  updateMetadataWrapping()

  if (typeof ResizeObserver !== 'function') {
    return
  }

  metadataResizeObserver = new ResizeObserver(updateMetadataWrapping)
  metadataResizeObserver.observe(metadataLine.value)
  for (const item of metadataLine.value.children) {
    metadataResizeObserver.observe(item)
  }
})

onBeforeUnmount(() => metadataResizeObserver?.disconnect())

let id = ''
let thumbnail = ''
let name = ''
/** @type {number?} */
let subscriberCount = null
/** @type {number?} */
let videoCount = null
/** @type {string?} */
let handle = null
let description = ''
let isGame = null

if (process.env.SUPPORTS_LOCAL_API && props.data.dataSource === 'local') {
  parseLocalData()
} else {
  parseInvidiousData()
}

const formattedSubscriberCount = computed(() => {
  if (subscriberCount != null) {
    return formatNumber(subscriberCount)
  }

  return ''
})

const formattedVideoCount = computed(() => {
  if (videoCount != null) {
    return formatNumber(videoCount)
  }

  return ''
})

function parseLocalData() {
  thumbnail = props.data.thumbnail
  name = props.data.name
  id = props.data.id

  if (props.data.subscribers != null) {
    subscriberCount = props.data.subscribers
  }

  if (props.data.videos != null) {
    videoCount = props.data.videos
  }

  if (props.data.handle) {
    handle = props.data.handle
  }

  description = props.data.descriptionShort
  isGame = props.data.isGame
}

function parseInvidiousData() {
  // Can be prefixed with `https://` or `//` (protocol relative)
  /** @type {string | null} */
  const thumbnailUrl = props.data.authorThumbnails.at(-1)?.url ?? null

  thumbnail = youtubeImageUrlToInvidious(thumbnailUrl, currentInvidiousInstanceUrl.value)

  name = props.data.author
  id = props.data.authorId
  subscriberCount = props.data.subCount

  if (props.data.channelHandle != null) {
    handle = props.data.channelHandle
  } else {
    videoCount = props.data.videoCount
  }

  description = props.data.description
}
</script>

<style scoped lang="scss" src="./FtListChannel.scss" />
