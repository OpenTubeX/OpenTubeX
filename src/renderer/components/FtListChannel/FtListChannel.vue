<template>
  <div
    class="ft-list-channel ft-list-item"
    :class="{
      list: listType === 'list',
      grid: listType !== 'list',
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
          :fallback-icon="isGame ? ['fas', 'gamepad'] : ['fas', 'circle-user']"
          :src="thumbnail"
          :class="!isGame ? 'channelImage' : 'gameImage'"
          alt=""
        />
      </component>
    </div>
    <div
      ref="infoAndSubscribe"
      class="infoAndSubscribe"
    >
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
            <FtVerifiedBadge
              :name="name"
              :verified="data.authorVerified"
              :artist="data.authorVerifiedArtist"
            />
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
        <div
          v-if="isAiSlopWarned"
          class="videoTagLine"
        >
          <span class="channelTag aiSlopTag">
            <FtIcon
              :icon="['fas', 'robot']"
              aria-hidden="true"
            />
            {{ $t('Search Listing.Label.Possibly AI-generated') }}
          </span>
        </div>
        <p
          v-if="listType === 'list'"
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
        :channel-handle="handle"
        :compact="compactSubscribe"
      />
    </div>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import FtVerifiedBadge from '../FtVerifiedBadge/FtVerifiedBadge.vue'
import { vSaferHtml } from '../../directives/vSaferHtml'

import store from '../../store/index'

import { isOnAiSlopList } from '../../helpers/aiSlopList'
import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { getOriginalChannelName } from '../../helpers/api/local'
import { labeledSubscribeButtonWidth } from '../../helpers/subscribeButton'
import { formatNumber, formatSubscriberCount } from '../../helpers/utils'

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

/** Channels on the AiSList warnlist are labelled instead of being hidden */
const isAiSlopWarned = computed(() => isOnAiSlopList(store.getters.getAiSlopWarnedChannels, {
  authorId: props.data.id ?? props.data.authorId,
  authorHandle: props.data.handle ?? props.data.channelHandle
}))

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

const metadataLine = useTemplateRef('metadataLine')
const metadataWrapped = ref(false)
let metadataResizeObserver = null

function updateMetadataWrapping() {
  const [firstItem, secondItem] = metadataLine.value?.children ?? []
  metadataWrapped.value = firstItem != null && secondItem != null &&
    Math.abs(firstItem.getBoundingClientRect().top - secondItem.getBoundingClientRect().top) > 1
}

const infoAndSubscribe = useTemplateRef('infoAndSubscribe')
const compactSubscribe = ref(false)
let subscribeResizeObserver = null

/** Drops the subscribe label when the button group would overflow the card, like in narrow grid columns. */
function updateSubscribeLayout() {
  const buttonList = infoAndSubscribe.value?.querySelector('.buttonList')
  const button = buttonList?.querySelector('.subscribeButton')
  if (!button) return
  const available = infoAndSubscribe.value.getBoundingClientRect().width
  if (available <= 0) return
  const style = getComputedStyle(buttonList)
  const width = buttonList.getBoundingClientRect().width + (Number.parseFloat(style.marginInlineStart) || 0) +
    (Number.parseFloat(style.marginInlineEnd) || 0) + labeledSubscribeButtonWidth(button) - button.getBoundingClientRect().width
  const compact = width > available + 0.5
  if (compact !== compactSubscribe.value) compactSubscribe.value = compact
}

function observeSubscribeButton() {
  subscribeResizeObserver?.disconnect()
  const buttonList = infoAndSubscribe.value?.querySelector('.buttonList')
  if (subscribeResizeObserver && buttonList) {
    subscribeResizeObserver.observe(infoAndSubscribe.value)
    subscribeResizeObserver.observe(buttonList)
    // The hidden label of the compact button changes width without resizing the group.
    const label = buttonList.querySelector('.subscribeLabel')
    if (label) subscribeResizeObserver.observe(label)
  }
  updateSubscribeLayout()
}

watch(hideUnsubscribeButton, observeSubscribeButton, { flush: 'post' })

onMounted(() => {
  updateMetadataWrapping()

  if (typeof ResizeObserver !== 'function') {
    updateSubscribeLayout()
    return
  }

  metadataResizeObserver = new ResizeObserver(updateMetadataWrapping)
  metadataResizeObserver.observe(metadataLine.value)
  for (const item of metadataLine.value.children) {
    metadataResizeObserver.observe(item)
  }

  subscribeResizeObserver = new ResizeObserver(updateSubscribeLayout)
  observeSubscribeButton()
})

onBeforeUnmount(() => {
  metadataResizeObserver?.disconnect()
  subscribeResizeObserver?.disconnect()
})

let id = ''
let thumbnail = ''
const name = ref('')
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

watch([() => props.data, () => store.getters.getAvoidTranslation], ([data, preference], _, onCleanup) => {
  if (!process.env.SUPPORTS_LOCAL_API || data.dataSource !== 'local') return
  name.value = data.name
  if (preference !== 'entire_app' || data.isGame) return

  let active = true
  onCleanup(() => { active = false })
  getOriginalChannelName(data.id).then(originalName => {
    if (!active || !originalName) return
    name.value = originalName
    if (store.getters.getSubscribedChannelIdSet.has(data.id)) {
      store.dispatch('updateSubscriptionDetails', { channelId: data.id, channelName: originalName })
    }
  })
}, { immediate: true })

const formattedSubscriberCount = computed(() => {
  if (subscriberCount != null) {
    return formatSubscriberCount(subscriberCount)
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
  name.value = props.data.name
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

  thumbnail = youtubeImageUrlToInvidious(thumbnailUrl)

  name.value = props.data.author
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
