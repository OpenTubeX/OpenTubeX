<template>
  <div class="chaptersList">
    <div
      ref="chaptersWrapper"
      v-observe-visibility="observeVisibilityOptions"
      v-overlay-scrollbars
      class="chaptersWrapper"
      :class="{ compact }"
      role="list"
      @wheel.passive="stopFollowing"
      @pointerdown="handlePointerDown"
      @touchmove.passive="stopFollowing"
      @keydown="handleKeydown"
      @keydown.arrow-up.stop.prevent="navigateChapters('up')"
      @keydown.arrow-down.stop.prevent="navigateChapters('down')"
    >
      <div
        ref="chaptersContent"
        class="chaptersContent"
        role="presentation"
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
            v-if="loopedChapterIndex !== null"
            class="chapterAction loopChapter"
            :class="{ active: index === loopedChapterIndex }"
            type="button"
            :aria-label="$t('Chapters.Loop Chapter', { chapter: chapter.title })"
            :aria-pressed="index === loopedChapterIndex ? 'true' : 'false'"
            :title="$t('Chapters.Loop Chapter', { chapter: chapter.title })"
            @click="emit('loop-chapter', index)"
          >
            <FtIcon :icon="['fas', 'retweet']" />
          </button>
          <button
            class="chapterAction copyTimestamp"
            type="button"
            :aria-label="$t('Chapters.Copy Timestamp Link', { timestamp: chapter.timestamp })"
            :title="$t('Chapters.Copy Timestamp Link', { timestamp: chapter.timestamp })"
            @click="copyTimestamp(index)"
          >
            <FtIcon :icon="['fas', 'share-alt']" />
          </button>
        </div>
      </div>
    </div>
    <Transition name="chaptersSync">
      <button
        v-if="!followCurrentChapter"
        class="chaptersSync"
        type="button"
        @click="syncToCurrentChapter"
        @keydown.space.stop
      >
        <FtIcon
          class="chaptersSyncIcon"
          :icon="['fas', 'clock']"
          aria-hidden="true"
        />
        {{ $t('Chapters.Sync to Video Time') }}
      </button>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { ObserveVisibility as vObserveVisibility } from 'vue-observe-visibility'

import { getCenteredChapterScrollTop } from './chapterScroll'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

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
  },
  /** The looped chapter, -1 for none, or null to hide the loop buttons. */
  loopedChapterIndex: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['copy-timestamp', 'loop-chapter', 'timestamp-event'])

const chaptersWrapper = useTemplateRef('chaptersWrapper')
// The scroll container, which the sidebar panel resizes.
defineExpose({ chaptersWrapper })

const chaptersContent = useTemplateRef('chaptersContent')
let scrollFrame = null
// Scrolling the list by hand stops it from following playback until the
// sync button, a chapter click, or reopening the list brings it back.
const followCurrentChapter = ref(true)
const resizeObserver = new ResizeObserver(scheduleScrollClamp)

/** A remaining range up to this size is rounding at fractional UI scales. */
const SCROLL_RANGE_TOLERANCE = 1

function canScroll() {
  const container = chaptersWrapper.value
  return !!container && container.scrollHeight - container.clientHeight > SCROLL_RANGE_TOLERANCE
}

function stopFollowing() {
  if (canScroll()) followCurrentChapter.value = false
}

/** @param {MouseEvent} event */
function syncToCurrentChapter(event) {
  const hadFocus = event.currentTarget === document.activeElement
  followCurrentChapter.value = true
  scrollToCurrentChapter()
  // The button goes away, so keep focus in the list rather than losing it to
  // the page. The smooth scroll above brings the chapter into view.
  if (hadFocus) {
    chaptersContent.value?.children[currentIndex.value]
      ?.querySelector('.chapterSeek')
      ?.focus({ preventScroll: true })
  }
}

/** @param {PointerEvent} event */
function handlePointerDown(event) {
  if (event.button === 1 || event.target.closest('.os-scrollbar')) {
    stopFollowing()
  }
}

/** @param {KeyboardEvent} event */
function handleKeydown(event) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
    stopFollowing()
  }
}

function scheduleScrollClamp() {
  if (scrollFrame !== null) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null
    if (chaptersWrapper.value && chaptersContent.value) {
      clampOverlayScrollTop(chaptersWrapper.value, chaptersContent.value)
      // Nothing is left to scroll away from, so there is nothing to sync back to.
      if (!canScroll()) followCurrentChapter.value = true
      if (followCurrentChapter.value) scrollToCurrentChapter(0)
    }
  })
}

onMounted(() => {
  resizeObserver.observe(chaptersWrapper.value)
  resizeObserver.observe(chaptersContent.value)
})
onBeforeUnmount(() => {
  resizeObserver.disconnect()
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
})
const currentIndex = ref(props.currentChapterIndex)

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

watch(chaptersWithThumbnails, scheduleScrollClamp, { flush: 'post' })

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
      // Wait for the panel/dock layout to settle; centering with a zero-height
      // container would scroll by half a row and clip the first chapter.
      followCurrentChapter.value = true
      requestAnimationFrame(() => scrollToCurrentChapter())
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
  followCurrentChapter.value = true
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
  const chapterRows = Array.from(chaptersContent.value.children)
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
 * @param {number} [remainingAttempts]
 */
function scrollToCurrentChapter(remainingAttempts = 5) {
  const container = chaptersWrapper.value
  const currentItem = chaptersContent.value?.children[currentIndex.value]

  // Deferred and retried calls run a frame later; a manual scroll in between wins.
  if (!followCurrentChapter.value || !container || !currentItem) {
    return
  }

  clampOverlayScrollTop(container, chaptersContent.value)
  const containerRect = container.getBoundingClientRect()
  const currentItemRect = currentItem.getBoundingClientRect()

  if (containerRect.height < currentItemRect.height && remainingAttempts > 0) {
    requestAnimationFrame(() => scrollToCurrentChapter(remainingAttempts - 1))
    return
  }

  const maxScrollTop = container.scrollHeight - container.clientHeight
  let top = getCenteredChapterScrollTop(
    container.scrollTop + (currentItemRect.top - containerRect.top),
    currentItemRect.height,
    containerRect.height,
    maxScrollTop
  )

  if (top == null) {
    if (remainingAttempts > 0) {
      requestAnimationFrame(() => scrollToCurrentChapter(remainingAttempts - 1))
    }
    return
  }

  // At fractional UI scales the real end can lie past the rounded maximum.
  // Stopping short of it lets the next touch swipe latch onto the list
  // instead of chaining to the page, so let the browser clamp to its end.
  if (top >= maxScrollTop) top = container.scrollHeight
  // Writing scrollTop here would stop a composited smooth scroll that's still
  // running, and with it the new one.
  container.scrollTo({ top, behavior: 'smooth' })
}

</script>

<style scoped src="./WatchVideoChapters.css" />
