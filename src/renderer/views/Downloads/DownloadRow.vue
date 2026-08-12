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
        <p class="downloadStatus">
          {{ statusText }}
        </p>
        <div
          v-if="inProgress"
          class="progressTrack"
          :aria-label="statusText"
        >
          <div
            class="progressFill"
            :class="{ indeterminate: download.status === 'processing' }"
            :style="{ inlineSize: `${download.percent}%` }"
          />
        </div>
        <p
          v-if="summary"
          class="downloadSummary"
        >
          {{ summary }}
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
          v-if="download.status === 'completed' && download.destination"
          :title="t('Downloads.Show in Folder')"
          :icon="['fas', 'folder-open']"
          theme="secondary"
          @click="emit('open')"
        />
        <FtIconButton
          v-if="download.status === 'completed' && download.destination"
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
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'
import { downloadTemplateName } from '../../helpers/downloadTemplates'

// keeps a playlist download from filling the page with one line per video
const MAX_VISIBLE_DESTINATIONS = 3

const props = defineProps({ download: { type: Object, required: true } })
const emit = defineEmits(['clear', 'open', 'remove'])
const { t } = useI18n()
const inProgress = computed(() => ['downloading', 'processing'].includes(props.download.status))
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
    templateName === '' ? '' : t('Downloads.Template Used', { name: templateName })
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
const statusText = computed(() => {
  if (props.download.status === 'downloading') {
    return [`${props.download.percent.toFixed(1)}%`, props.download.speed, props.download.eta ? `ETA ${props.download.eta}` : null].filter(Boolean).join(' • ')
  }
  switch (props.download.status) {
    case 'processing':
      return t('Downloads.Processing')
    case 'completed':
      return t('Downloads.Download Complete')
    case 'cancelled':
      return t('Downloads.Download Cancelled')
    default:
      return t('Downloads.Download Failed')
  }
})
function cancelDownload() {
  window.ftElectron.ytDlpCancelDownload(props.download.id)
}
</script>

<style scoped src="./Downloads.css" />
