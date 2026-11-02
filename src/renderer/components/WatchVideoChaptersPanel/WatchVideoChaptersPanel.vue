<template>
  <div class="watchVideoChaptersPanel">
    <div class="chaptersPanelHeader">
      <h3 class="chaptersPanelTitle">
        {{ title }}
      </h3>
      <button
        type="button"
        class="chaptersPanelClose"
        :aria-label="t('Chapters.Close Chapters')"
        :title="t('Chapters.Close Chapters')"
        @click="emit('close')"
      >
        <FtIcon :icon="['fas', 'xmark']" />
      </button>
    </div>
    <WatchVideoChapters
      :chapters="chapters"
      :chapter-thumbnails="chapterThumbnails"
      :current-chapter-index="currentChapterIndex"
      :fallback-thumbnail="fallbackThumbnail"
      :looped-chapter-index="loopedChapterIndex"
      @copy-timestamp="emit('copy-timestamp', $event)"
      @loop-chapter="emit('loop-chapter', $event)"
      @timestamp-event="emit('timestamp-event', $event)"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'
import WatchVideoChapters from '../WatchVideoChapters/WatchVideoChapters.vue'

defineProps({
  title: { type: String, required: true },
  chapters: { type: Array, required: true },
  currentChapterIndex: { type: Number, required: true },
  chapterThumbnails: { type: Array, default: () => [] },
  fallbackThumbnail: { type: String, default: '' },
  loopedChapterIndex: { type: Number, default: null }
})
const emit = defineEmits(['close', 'copy-timestamp', 'loop-chapter', 'timestamp-event'])
const { t } = useI18n()
</script>

<style scoped src="./WatchVideoChaptersPanel.css" />
