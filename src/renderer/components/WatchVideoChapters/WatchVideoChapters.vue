<template>
  <div
    ref="chaptersWrapper"
    v-observe-visibility="observeVisibilityOptions"
    v-overlay-scrollbars
    class="chaptersWrapper"
    :class="{ compact }"
    role="list"
    @keydown.arrow-up.stop.prevent="navigateChapters('up')"
    @keydown.arrow-down.stop.prevent="navigateChapters('down')"
  >
    <div
      v-for="(chapter, index) in chaptersWithThumbnails"
      :key="index"
      class="chapter"
      :class="{ current: index === currentIndex }"
      role="listitem"
    >
      <button
        class="chapterSeek"
        type="button"
        :aria-current="index === currentIndex ? 'true' : null"
        @click="changeChapter(index)"
      >
        <span
          v-if="!compact"
          aria-hidden="true"
          class="chapterThumbnail"
          :style="getThumbnailStyle(chapter.displayThumbnail)"
        />
        <span class="chapterInfo">
          <span
            class="chapterTitle"
            dir="auto"
          >
            {{ chapter.title }}
          </span>
          <span class="chapterTimestamp">
            {{ chapter.timestamp }}
          </span>
        </span>
      </button>
      <button
        class="copyTimestamp"
        type="button"
        :aria-label="$t('Chapters.Copy Timestamp Link', { timestamp: chapter.timestamp })"
        :title="$t('Chapters.Copy Timestamp Link', { timestamp: chapter.timestamp })"
        @click="copyTimestamp(index)"
      >
        <FontAwesomeIcon :icon="['fas', 'share-alt']" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  chapters: {
    type: Array,
    required: true
  },
  currentChapterIndex: {
    type: Number,
    required: true
  },
  chapterThumbnails: {
    type: Array,
    default: () => []
  },
  fallbackThumbnail: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['copy-timestamp', 'timestamp-event'])

const chaptersWrapper = useTemplateRef('chaptersWrapper')
const currentIndex = ref(props.currentChapterIndex)
let resizeFrame = null
let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame)
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      reconcileScrollRange()
    })
  })
  resizeObserver.observe(chaptersWrapper.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (resizeFrame !== null) {
    cancelAnimationFrame(resizeFrame)
  }
})

watch(() => props.currentChapterIndex, (value) => {
  if (currentIndex.value !== value) {
    currentIndex.value = value
    scrollToCurrentChapter()
  }
})

const chaptersWithThumbnails = computed(() => {
  return props.chapters.map((chapter, index) => {
    let displayThumbnail = chapter.thumbnail?.url ? chapter.thumbnail : props.chapterThumbnails[index]

    if (!displayThumbnail && props.fallbackThumbnail) {
      displayThumbnail = {
        url: props.fallbackThumbnail,
        width: 16,
        height: 9
      }
    }

    return { ...chapter, displayThumbnail }
  })
})

/** @type {import('vue').ComputedRef<boolean>} */
const compact = computed(() => {
  return !chaptersWithThumbnails.value.some(chapter => chapter.displayThumbnail)
})

/**
 * @param {{ url: string, width?: number, height?: number, imageWidth?: number, imageHeight?: number, positionX?: number, positionY?: number, sprite?: boolean } | null} thumbnail
 * @returns {Record<string, string>}
 */
function getThumbnailStyle(thumbnail) {
  if (!thumbnail) {
    return {}
  }

  const width = thumbnail.width || 16
  const height = thumbnail.height || 9
  const style = {
    aspectRatio: `${width} / ${height}`,
    backgroundImage: `url(${JSON.stringify(thumbnail.url)})`
  }

  if (thumbnail.sprite && thumbnail.imageWidth && thumbnail.imageHeight) {
    const horizontalRange = thumbnail.imageWidth - width
    const verticalRange = thumbnail.imageHeight - height
    const horizontalPosition = horizontalRange > 0 ? (thumbnail.positionX ?? 0) / horizontalRange * 100 : 0
    const verticalPosition = verticalRange > 0 ? (thumbnail.positionY ?? 0) / verticalRange * 100 : 0

    style.backgroundPosition = `${horizontalPosition}% ${verticalPosition}%`
    style.backgroundSize = `${thumbnail.imageWidth / width * 100}% ${thumbnail.imageHeight / height * 100}%`
  }

  return style
}

const observeVisibilityOptions = {
  callback: (isVisible, _entry) => {
    if (isVisible) {
      scrollToCurrentChapter()
    }
  },
  intersection: {
    rootMargin: '0% 0% 0% 0%',
  },
  once: false,
}

/**
 * @param {number} index
 */
function changeChapter(index) {
  currentIndex.value = index
  emit('timestamp-event', props.chapters[index].startSeconds)
}

/**
 * @param {number} index
 */
function copyTimestamp(index) {
  emit('copy-timestamp', props.chapters[index].startSeconds)
}

/**
 * @param {'up' | 'down'} direction
 */
function navigateChapters(direction) {
  const chapterRows = Array.from(chaptersWrapper.value.children)
  const focusedRow = document.activeElement?.closest('.chapter')
  const focusedIndex = chapterRows.indexOf(focusedRow)
  const offset = direction === 'up' ? -1 : 1
  let newIndex

  if (focusedIndex === -1) {
    newIndex = direction === 'up' ? chapterRows.length - 1 : 0
  } else {
    newIndex = (focusedIndex + offset + chapterRows.length) % chapterRows.length
  }

  chapterRows[newIndex].querySelector('.chapterSeek')?.focus()
}

/**
 */
function scrollToCurrentChapter() {
  const container = chaptersWrapper.value
  const currentItem = container?.children[currentIndex.value]

  if (!container || !currentItem) {
    return
  }

  const containerRect = container.getBoundingClientRect()
  const currentItemRect = currentItem.getBoundingClientRect()

  if (currentItemRect.top < containerRect.top) {
    container.scrollTop += currentItemRect.top - containerRect.top
  } else if (currentItemRect.bottom > containerRect.bottom) {
    container.scrollTop += currentItemRect.bottom - containerRect.bottom
  }
}

/**
 * Clamp offsets chosen while an opening or resizing panel was smaller than its
 * final size, then refresh the custom scrollbar against the settled geometry.
 */
function reconcileScrollRange() {
  const container = chaptersWrapper.value
  if (!container) {
    return
  }

  const chapterRows = container.querySelectorAll(':scope > .chapter')
  const firstChapter = chapterRows[0]
  const lastChapter = chapterRows[chapterRows.length - 1]
  const contentHeight = firstChapter && lastChapter
    ? lastChapter.offsetTop - firstChapter.offsetTop + lastChapter.offsetHeight
    : 0
  const maximumScrollTop = Math.max(0, contentHeight - container.clientHeight)
  restoreOverlayScrollTop(container, Math.min(container.scrollTop, maximumScrollTop))
}
</script>

<style scoped src="./WatchVideoChapters.css" />
