<template>
  <div
    class="videoSwipeFrame"
    :class="{
      thumbnailSwipeEnabled,
      videoSwipeActive: thumbnailSwipe,
      videoSwipeDragging: thumbnailSwipe && !thumbnailSwipe.settling,
    }"
    :style="{
      '--video-swipe-offset': `${thumbnailSwipe?.offset ?? 0}px`,
      '--video-swipe-progress': thumbnailSwipe?.progress ?? 0,
    }"
    @pointerdown="startThumbnailSwipe"
    @pointermove="moveThumbnailSwipe"
    @pointerup="finishThumbnailSwipe"
    @pointercancel="abortThumbnailSwipe"
    @lostpointercapture.self="abortThumbnailSwipe"
  >
    <div
      v-if="thumbnailSwipe"
      :key="thumbnailSwipe.direction"
      class="thumbnailSwipeFeedback"
      :class="{
        thumbnailSwipeReady: thumbnailSwipe.progress === 1,
        thumbnailSwipeLeft: thumbnailSwipe.direction === 'left',
      }"
      :title="thumbnailSwipe.action.label"
      aria-hidden="true"
    >
      <FtIcon :icon="thumbnailSwipe.action.icon" />
    </div>
    <article class="downloadRow">
      <div class="downloadMain">
        <FtRetryImage
          :src="download.thumbnail || thumbnailPlaceholder"
          class="downloadThumbnail"
          alt=""
        />
        <div class="downloadDetails">
          <h3
            dir="auto"
            :title="download.title"
          >
            {{ download.title }}
          </h3>
          <p
            v-if="download.status === 'completed' && channelName"
            class="downloadChannel"
            dir="auto"
          >
            {{ channelName }}
          </p>
          <p
            v-if="statusText"
            class="downloadStatus"
            :aria-hidden="inProgress ? 'true' : undefined"
          >
            {{ statusText }}
          </p>
          <p
            v-if="availabilityText"
            class="downloadAvailability"
            :class="{ missing: download.availability === 'missing' }"
          >
            {{ availabilityText }}
          </p>
          <div
            v-if="inProgress"
            class="progressTrack"
            role="progressbar"
            :aria-label="download.title || t('Downloads.Downloading')"
            :aria-valuenow="download.status === 'downloading' ? progressPercentage : undefined"
            :aria-valuetext="statusText"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="progressFill"
              :class="{ indeterminate: download.status !== 'downloading' }"
              :style="{ transform: `scaleX(${progressPercentage / 100})` }"
              aria-hidden="true"
            />
          </div>
          <p
            v-if="compactSummary"
            class="downloadSummary"
          >
            {{ compactSummary }}
          </p>
          <p
            v-if="spaceWarningText"
            class="downloadSpaceWarning"
          >
            {{ spaceWarningText }}
          </p>
          <p
            v-if="errorText"
            class="downloadError"
            dir="auto"
          >
            {{ errorText }}
          </p>
          <DownloadFailureHint v-if="download.status === 'failed'" />
        </div>
      </div>
      <div class="downloadActions">
        <FtIconButton
          v-if="controllable"
          :title="paused ? t('Downloads.Resume Download') : t('Downloads.Pause Download')"
          :icon="['fas', paused ? 'play' : 'pause']"
          theme="primary"
          @click="paused ? emit('resume') : emit('pause')"
        />
        <FtIconButton
          v-else-if="canRetry && !canPlay"
          :title="t('Downloads.Retry Download')"
          :icon="['fas', 'sync']"
          theme="primary"
          :disabled="retrying"
          @click="emit('retry')"
        />
        <FtIconButton
          v-else-if="canPlay"
          :title="t('Downloads.Play Download')"
          :icon="['fas', 'play']"
          theme="primary"
          @click="emit('play')"
        />
        <FtIconButton
          ref="menuButton"
          :title="t('Video.More Options')"
          :icon="['fas', 'ellipsis-v']"
          theme="base-no-default"
          :use-shadow="false"
          @click="openMenu"
        />
      </div>
      <FtPrompt
        v-if="showDetails"
        :label="t('Channel.About.Details')"
        autosize
        fixed-layout
        @click="showDetails = false"
      >
        <div class="downloadMetadata">
          <FtRetryImage
            :src="download.thumbnail || thumbnailPlaceholder"
            class="downloadThumbnail"
            alt=""
          />
          <h3 dir="auto">
            {{ download.title }}
          </h3>
          <p
            v-if="channelName"
            dir="auto"
          >
            {{ channelName }}
          </p>
          <p
            v-if="summary"
            class="downloadSummary"
          >
            {{ summary }}
          </p>
          <p
            v-if="download.titleTruncated"
            class="downloadWarning"
          >
            <FtIcon
              :icon="['fas', 'triangle-exclamation']"
              aria-hidden="true"
            />
            {{ t('Downloads.File Name Shortened') }}
          </p>
          <ul
            v-if="destinations.length > 0"
            class="destinationList"
          >
            <li
              v-for="destination in destinations"
              :key="destination"
              class="destination"
              dir="auto"
              :title="destination"
            >
              {{ destination }}
            </li>
            <li
              v-if="hiddenDestinationCount > 0"
              class="destination"
            >
              {{ t('Downloads.More Files', { count: hiddenDestinationCount }, hiddenDestinationCount) }}
            </li>
          </ul>
        </div>
        <template #footer>
          <FtButton
            :label="t('Close')"
            :icon="['fas', 'xmark']"
            @click="showDetails = false"
          />
        
  </div>
</template>
    </FtPrompt>
  </article>
</template>

<script setup>
import FtButton from '../../components/FtButton/FtButton.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import { downloadFormats } from '../../helpers/downloadFilters'
import FtRetryImage from '../../components/FtRetryImage.vue'
import { displayAndroidPath } from '../../helpers/androidStorage'
import { ytDlp } from '../../helpers/ytDlp'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useSettingsOverlay } from '../../composables/useSettingsOverlay'
import { useStore } from 'vuex'
import { useThumbnailSwipe } from '../../composables/useThumbnailSwipe'
import { queueSwipeAction, downloadSwipeAction } from '../../helpers/videoSwipeActions'
import { isHistoryEntryWatched } from '../../helpers/history'
import { getAnimationSpeedMultiplier } from '../../helpers/animationSpeed'
import { isReducedMotionEnabled } from '../../helpers/reducedMotion'
import { lightHaptic } from '../../helpers/mobileHaptics'
import { useI18n } from 'vue-i18n'
import DownloadFailureHint from '../../components/DownloadFailureHint/DownloadFailureHint.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'
import { downloadTemplateName } from '../../helpers/downloadTemplates'
import { formatBytes } from '../../helpers/fileSize'
import { downloadErrorMessage } from '../../helpers/downloadErrors'
import { isDownloadPlaybackSupported, isPlayableDownloadFile, downloadQueueVideos } from '../../helpers/downloadPlayback'

// keeps a playlist download from filling the page with one line per video
const MAX_VISIBLE_DESTINATIONS = 3

const props = defineProps({
  download: { type: Object, required: true },
  retrying: { type: Boolean, default: false },
  queuePosition: { type: Number, default: 0 },
  canMoveEarlier: { type: Boolean, default: false },
  canMoveLater: { type: Boolean, default: false }
})
const emit = defineEmits(['clear', 'move', 'open', 'pause', 'play', 'queue', 'queue-next', 'remove', 'resume', 'retry'])
const IS_IOS = !!process.env.IS_IOS
const { t } = useI18n()
const showDetails = ref(false)
const menuButton = useTemplateRef('menuButton')
const paused = computed(() => ['paused', 'pausing'].includes(props.download.status))
const menuItems = computed(() => {
  const items = [{ label: t('Channel.About.Details'), icon: ['fas', 'circle-info'], run: () => { showDetails.value = true } }]
  if (controllable.value) {
    if (queuePending.value) {
      items.push(
        { label: t('Downloads.Move Earlier'), icon: ['fas', 'arrow-up'], enabled: props.canMoveEarlier, run: () => emit('move', -1) },
        { label: t('Downloads.Move Later'), icon: ['fas', 'arrow-down'], enabled: props.canMoveLater, run: () => emit('move', 1) }
      )
    }
    items.push({ label: t('Downloads.Cancel Download'), icon: ['fas', 'times'], run: cancelDownload })
  } else {
    if (canRetry.value && canPlay.value) items.push({ label: t('Downloads.Retry Download'), icon: ['fas', 'sync'], enabled: !props.retrying, run: () => emit('retry') })
    if (canPlay.value && !IS_IOS) items.push({ label: t('Video.Add to Queue'), icon: ['fas', 'add-to-queue'], run: () => emit('queue') })
    if (canAccessFiles.value) {
      items.push(
        { label: t('Downloads.Show in Folder'), icon: ['fas', 'folder-open'], run: () => emit('open') },
        { label: t('Downloads.Remove File'), icon: ['fas', 'trash'], run: () => emit('remove') }
      )
    }
    items.push({ label: t('Downloads.Clear From List'), icon: ['fas', 'times'], run: () => emit('clear') })
  }
  return items.map(item => ({ enabled: true, ...item }))
})
function openMenu() {
  const button = menuButton.value.$el.querySelector('button')
  button.focus({ preventScroll: true })
  const bounds = button.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
    detail: { x: document.body.dir === 'rtl' ? bounds.right : bounds.left, y: bounds.bottom, items: menuItems, touchFriendly: true }
  }))
}
function closeMenu() {
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: menuItems }))
}
useSettingsOverlay(closeMenu)
onBeforeUnmount(closeMenu)
const store = useStore()

function getThumbnailSwipeAction(direction) {
  const actionId = direction === 'left' ? store.getters.getThumbnailLeftSwipeAction : store.getters.getThumbnailRightSwipeAction
  if (actionId === 'download') {
    if (!controllable.value && !canAccessFiles.value) return null
    return downloadSwipeAction(props.download, {
      t, cancel: cancelDownload, remove: () => emit('remove'),
    })
  }
  if (!canPlay.value) return null
  const videos = downloadQueueVideos(props.download)
  if (['addToQueue', 'playNext'].includes(actionId) && !IS_IOS) {
    return queueSwipeAction(actionId, videos, store.getters.getWatchQueue, {
      t, commit: store.commit, add: next => next ? emit('queue-next') : emit('queue'),
    })
  }
  if (!['history', 'markAsFullySeen'].includes(actionId) || videos.length === 0) return null
  const entries = videos.map(video => {
    const file = props.download.files.find(file => file.videoId === video.videoId)
    const history = store.getters.getHistoryCacheById[video.videoId]
    return { ...video, ...history, lengthSeconds: file.duration ?? history?.lengthSeconds }
  })
  const watched = entries.every(isHistoryEntryWatched)
  const fully = actionId === 'markAsFullySeen'
  if (!watched && fully && entries.some(video => !Number.isFinite(video.lengthSeconds) || video.lengthSeconds <= 0)) return null
  return {
    label: watched ? t('Video.Unmark As Watched') : fully ? t('Video.Mark As Fully Watched') : t('Video.Mark As Watched'),
    icon: ['fas', watched ? 'eye-slash' : fully ? 'flag-checkered' : 'eye'],
    run: async () => {
      for (const video of entries) {
        if (watched && store.getters.getWatchedPercentageThreshold === 0) {
          await store.dispatch('removeFromHistory', video.videoId)
        } else {
          await store.dispatch('updateHistory', {
            ...video,
            isWatched: !watched,
            type: 'video',
            watchProgress: !watched && fully ? video.lengthSeconds : video.watchProgress ?? 0,
            timeWatched: video.timeWatched ?? Date.now(),
          })
        }
      }
    },
  }
}

const {
  enabled: thumbnailSwipeEnabled, swipe: thumbnailSwipe,
  startSwipe: startThumbnailSwipe, moveSwipe: moveThumbnailSwipe,
  finishSwipe: finishThumbnailSwipe, abortSwipe: abortThumbnailSwipe, cancelSwipe: cancelThumbnailSwipe,
} = useThumbnailSwipe({
  getAction: getThumbnailSwipeAction,
  cancelHold: () => {},
  suppressClick: () => {},
  getSettleDuration: () => isReducedMotionEnabled() ? 0 : 200 / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed),
  onCommit: action => {
    lightHaptic()
    action.run()
  },
})
watch([() => props.download.id, () => store.getters.getThumbnailLeftSwipeAction, () => store.getters.getThumbnailRightSwipeAction], cancelThumbnailSwipe)

const inProgress = computed(() => ['preparing', 'downloading', 'processing'].includes(props.download.status))
const progressPercentage = computed(() => (
  Number.isFinite(props.download.percent)
    ? Math.min(100, Math.max(0, props.download.percent))
    : 0
))
const controllable = computed(() => ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'].includes(props.download.status))
const queuePending = computed(() => (
  ['queued', 'paused'].includes(props.download.status) && props.download.started !== true
))
const canRetry = computed(() => (
  ['failed', 'cancelled'].includes(props.download.status) &&
  (props.download.retryPayload || props.download.videoId || props.download.playlistId)
))
const canAccessFiles = computed(() => (
  (props.download.status === 'completed' || (process.env.IS_CAPACITOR && props.download.status === 'failed')) &&
  props.download.destination &&
  props.download.availability !== 'missing'
))
const canPlay = computed(() => (
  isDownloadPlaybackSupported(props.download) &&
  Array.isArray(props.download.files) &&
  props.download.files.some(isPlayableDownloadFile)
))
const modeLabel = computed(() => {
  switch (props.download.mode) {
    case 'video':
      return t('Downloads.Video')
    case 'audio':
      return t('Downloads.Audio')
    case 'subtitles':
      return t('Search Listing.Label.Subtitles')
    default:
      return ''
  }
})
const channelName = computed(() => {
  const authors = [...new Set(props.download.files?.map(file => file.author).filter(Boolean) ?? [])]
  return authors.length === 1 ? authors[0] : ''
})
const compactSummary = computed(() => [
  downloadFormats(props.download).map(format => format.toUpperCase()).join(', ') || modeLabel.value,
  Number.isFinite(props.download.sizeBytes) && props.download.sizeBytes >= 0
    ? formatBytes(props.download.sizeBytes)
    : ''
].filter(Boolean).join(' | '))
const summary = computed(() => {
  const templateName = downloadTemplateName(props.download.template, t)

  return [
    modeLabel.value,
    templateName === '' ? '' : t('Downloads.Template Used', { name: templateName }),
    Number.isFinite(props.download.sizeBytes) && props.download.sizeBytes > 0
      ? formatBytes(props.download.sizeBytes)
      : ''
  ].filter(part => part !== '').join(' • ')
})
// downloads from before the file list was recorded only know their last file
const allDestinations = computed(() => {
  if (Array.isArray(props.download.destinations) && props.download.destinations.length > 0) {
    return props.download.destinations
  }
  return props.download.destination ? [props.download.destination] : []
})
const destinations = computed(() => allDestinations.value.slice(0, MAX_VISIBLE_DESTINATIONS).map(displayAndroidPath))
const hiddenDestinationCount = computed(() => allDestinations.value.length - destinations.value.length)
const availabilityText = computed(() => {
  if (props.download.status !== 'completed') return ''
  if (props.download.availability === 'missing') {
    return t('Downloads.Files Missing', { count: props.download.destinationCount }, props.download.destinationCount)
  }
  if (props.download.availability === 'partial') {
    return t('Downloads.Files Available', {
      available: props.download.availableDestinationCount,
      total: props.download.destinationCount
    })
  }
  return ''
})
const errorText = computed(() => {
  if (props.download.status !== 'failed' || !props.download.errorMessage) return ''
  if (props.download.errorMessage === 'INSUFFICIENT_SPACE') {
    return t('Downloads.Insufficient Disk Space', {
      required: formatBytes(props.download.estimatedSizeBytes),
      available: formatBytes(props.download.availableSpaceBytes)
    })
  }
  return props.download.errorMessage === 'ENOENT'
    ? t('Downloads.yt-dlp Not Found')
    : downloadErrorMessage(props.download.errorMessage, t)
})
const spaceWarningText = computed(() => {
  if (!['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'].includes(props.download.status)) return ''
  if (props.download.spaceWarning === 'unknown-estimate' && Number.isFinite(props.download.availableSpaceBytes)) {
    return t('Downloads.Unknown Download Size', { available: formatBytes(props.download.availableSpaceBytes) })
  }
  if (props.download.spaceWarning === 'space-check-unavailable') {
    return t('Downloads.Disk Space Check Unavailable')
  }
  return ''
})
const statusText = computed(() => {
  if (props.download.status === 'downloading') {
    return [`${progressPercentage.value.toFixed(1)}%`, props.download.speed, props.download.eta ? `ETA ${props.download.eta}` : null].filter(Boolean).join(' • ')
  }
  switch (props.download.status) {
    case 'queued':
      if (props.download.waitingFor === 'unmetered') return t('Downloads.Waiting for Unmetered Network')
      if (props.download.waitingFor === 'charging') return t('Downloads.Waiting for Charging')
      return props.queuePosition > 0
        ? t('Downloads.Queued Position', { position: props.queuePosition })
        : t('Downloads.Queued')
    case 'paused':
      return t('Downloads.Paused')
    case 'pausing':
      return t('Downloads.Pausing')
    case 'preparing':
      return t('Downloads.Preparing')
    case 'processing':
      return t('Downloads.Processing')
    case 'completed':
      return ''
    case 'cancelled':
      return ''
    case 'skipped':
      return t('Downloads.Automatic Download Skipped')
    default:
      return t('Downloads.Download Failed')
  }
})
function cancelDownload() {
  ytDlp.ytDlpCancelDownload(props.download.id)
}
</script>

<style scoped src="./Downloads.css" />

<style scoped lang="scss" src="../../components/thumbnailSwipe.scss" />
