<template>
  <article class="downloadRow">
    <div class="downloadMain">
      <img
        :src="download.thumbnail || thumbnailPlaceholder"
        class="downloadThumbnail"
        alt=""
      >
      <div class="downloadDetails">
        <h3 dir="auto">
          {{ download.title }}
        </h3>
        <p
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
            :class="{ indeterminate: download.status === 'processing' }"
            :style="{ inlineSize: `${progressPercentage}%` }"
            aria-hidden="true"
          />
        </div>
        <p
          v-if="summary"
          class="downloadSummary"
        >
          {{ summary }}
        </p>
        <p
          v-if="errorText"
          class="downloadError"
          dir="auto"
        >
          {{ errorText }}
        </p>
        <DownloadFailureHint v-if="download.status === 'failed'" />
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
    </div>
    <div class="downloadActions">
      <FtIconButton
        v-if="inProgress"
        :title="t('Downloads.Cancel Download')"
        :icon="['fas', 'times']"
        theme="destructive"
        @click="cancelDownload"
      />
      <template v-else>
        <FtIconButton
          v-if="canRetry"
          :title="t('Downloads.Retry Download')"
          :icon="['fas', 'sync']"
          theme="primary"
          :disabled="retrying"
          @click="emit('retry')"
        />
        <FtIconButton
          v-if="canPlay"
          :title="t('Downloads.Play Download')"
          :icon="['fas', 'play']"
          theme="primary"
          @click="emit('play')"
        />
        <FtIconButton
          v-if="canAccessFiles"
          :title="t('Downloads.Show in Folder')"
          :icon="['fas', 'folder-open']"
          theme="secondary"
          @click="emit('open')"
        />
        <FtIconButton
          v-if="canAccessFiles"
          :title="t('Downloads.Remove File')"
          :icon="['fas', 'trash']"
          theme="destructive"
          @click="emit('remove')"
        />
        <FtIconButton
          :title="t('Downloads.Clear From List')"
          :icon="['fas', 'times']"
          theme="secondary"
          @click="emit('clear')"
        />
      </template>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DownloadFailureHint from '../../components/DownloadFailureHint/DownloadFailureHint.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'
import { downloadTemplateName } from '../../helpers/downloadTemplates'
import { formatBytes } from '../../helpers/fileSize'

// keeps a playlist download from filling the page with one line per video
const MAX_VISIBLE_DESTINATIONS = 3

const props = defineProps({
  download: { type: Object, required: true },
  retrying: { type: Boolean, default: false }
})
const emit = defineEmits(['clear', 'open', 'play', 'remove', 'retry'])
const { t } = useI18n()
const inProgress = computed(() => ['downloading', 'processing'].includes(props.download.status))
const progressPercentage = computed(() => (
  Number.isFinite(props.download.percent)
    ? Math.min(100, Math.max(0, props.download.percent))
    : 0
))
const canRetry = computed(() => (
  ['failed', 'cancelled'].includes(props.download.status) &&
  (props.download.retryPayload || props.download.videoId || props.download.playlistId)
))
const canAccessFiles = computed(() => (
  props.download.status === 'completed' &&
  props.download.destination &&
  props.download.availability !== 'missing'
))
const canPlay = computed(() => (
  props.download.status === 'completed' &&
  ['video', 'audio'].includes(props.download.mode) &&
  Array.isArray(props.download.files) &&
  props.download.files.some(file => file.available !== false)
))
const modeLabel = computed(() => {
  switch (props.download.mode) {
    case 'video':
      return t('Downloads.Video')
    case 'audio':
      return t('Downloads.Audio')
    case 'subtitles':
      return t('Downloads.Subtitles')
    default:
      return ''
  }
})
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
const destinations = computed(() => allDestinations.value.slice(0, MAX_VISIBLE_DESTINATIONS))
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
  return props.download.errorMessage === 'ENOENT'
    ? t('Downloads.yt-dlp Not Found')
    : props.download.errorMessage
})
const statusText = computed(() => {
  if (props.download.status === 'downloading') {
    return [`${progressPercentage.value.toFixed(1)}%`, props.download.speed, props.download.eta ? `ETA ${props.download.eta}` : null].filter(Boolean).join(' • ')
  }
  switch (props.download.status) {
    case 'processing':
      return t('Downloads.Processing')
    case 'completed':
      return props.download.availability === 'missing'
        ? t('Downloads.Download Missing')
        : t('Downloads.Download Complete')
    case 'cancelled':
      return t('Downloads.Download Cancelled')
    case 'skipped':
      return t('Downloads.Automatic Download Skipped')
    default:
      return t('Downloads.Download Failed')
  }
})
function cancelDownload() {
  window.ftElectron.ytDlpCancelDownload(props.download.id)
}
</script>

<style scoped src="./Downloads.css" />
