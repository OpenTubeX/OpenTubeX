<template>
  <div
    class="watchVideoChaptersPanel"
    :style="maxListHeight ? { '--chapters-max-block-size': `${maxListHeight}px` } : null"
  >
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
      ref="chapterList"
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
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'
import WatchVideoChapters from '../WatchVideoChapters/WatchVideoChapters.vue'

const HEIGHT_STORAGE_KEY = 'opentubex-chapters-panel-height'

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

/** @returns {number | null} */
function readStoredHeight() {
  const height = Number.parseFloat(localStorage.getItem(HEIGHT_STORAGE_KEY) ?? '')
  return height > 0 ? height : null
}

// The list fits its chapters up to this height. Dragging its resize handle
// sets an inline height, which becomes the new limit here and for later panels.
const maxListHeight = ref(readStoredHeight())
const chapterList = useTemplateRef('chapterList')
const listStyleObserver = new MutationObserver(() => {
  const height = Number.parseFloat(chapterList.value?.$el.style.height)
  if (!(height > 0) || height === maxListHeight.value) return
  maxListHeight.value = height
  localStorage.setItem(HEIGHT_STORAGE_KEY, String(height))
})
onMounted(() => listStyleObserver.observe(chapterList.value.$el, { attributeFilter: ['style'] }))
onBeforeUnmount(() => listStyleObserver.disconnect())
</script>

<style scoped src="./WatchVideoChaptersPanel.css" />
