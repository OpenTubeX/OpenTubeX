<template>
  <ul
    v-if="videos.length > 0"
    class="activeVideos"
    :aria-label="t('Downloads.Videos in Progress')"
  >
    <li
      v-for="(video, index) in videos"
      :key="index"
      class="activeVideo"
    >
      <p class="activeVideoText">
        <span
          class="activeVideoTitle"
          dir="auto"
          :title="video.label"
        >{{ video.label }}</span>
        <span
          class="activeVideoStatus"
          aria-hidden="true"
        >{{ video.statusText }}</span>
      </p>
      <div
        class="activeVideoTrack"
        role="progressbar"
        :aria-label="video.label"
        :aria-valuenow="video.indeterminate ? undefined : video.percent"
        :aria-valuetext="video.statusText"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="activeVideoFill"
          :class="{ indeterminate: video.indeterminate }"
          :style="{ transform: `scaleX(${video.percent / 100})` }"
        />
      </div>
    </li>
  </ul>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  download: { type: Object, required: true }
})
const { t } = useI18n()

// The parts of a split playlist download several videos at once, so show each of them
const videos = computed(() => {
  const { activeVideos, status, retryPayload } = props.download
  if (!['preparing', 'downloading', 'processing'].includes(status) || !Array.isArray(activeVideos) || activeVideos.length < 2) return []
  const videoIds = Array.isArray(retryPayload?.videoIds) ? retryPayload.videoIds : []
  return activeVideos.map(video => {
    const position = video.playlistIndex || videoIds.indexOf(video.videoId) + 1
    const percent = Number.isFinite(video.percent) ? Math.min(100, Math.max(0, video.percent)) : 0
    let statusText = t('Downloads.Preparing')
    if (video.status === 'downloading') statusText = video.live ? t('Downloads.Recording') : `${percent.toFixed(1)}%`
    else if (video.status === 'processing') statusText = t('Downloads.Processing')
    return {
      label: [position > 0 ? String(position) : '', video.title || video.videoId].filter(Boolean).join(' • '),
      statusText,
      percent,
      indeterminate: video.status !== 'downloading' || video.live === true
    }
  })
})
</script>

<style scoped>
.activeVideos {
  display: grid;
  gap: 6px;
  list-style: none;
  margin-block: 4px 8px;
  padding: 0;
}

.activeVideoText {
  color: var(--secondary-text-color);
  display: flex;
  font-size: 0.85rem;
  gap: 8px;
  margin: 0;
}

.activeVideoTitle {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activeVideoStatus {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.activeVideoTrack {
  background: color-mix(in srgb, var(--accent-color) 24%, var(--secondary-card-bg-color));
  block-size: 4px;
  border-radius: var(--shape-corner-extra-small);
  margin-block-start: 3px;
  overflow: hidden;
}

.activeVideoFill {
  background: var(--accent-color);
  block-size: 100%;
  inline-size: 100%;
  transform-origin: left;
  transition: transform var(--motion-default-effects);
}

.activeVideoFill:dir(rtl) {
  transform-origin: right;
}

.activeVideoFill.indeterminate {
  animation: active-video-pulse 1.5s ease-in-out infinite;
  transform: none !important;
}

@keyframes active-video-pulse {
  50% {
    opacity: 0.4;
  }
}

</style>
