<template>
  <FtCard class="transcriptCard">
    <div class="transcriptHeader">
      <h3 class="transcriptTitle">
        <FontAwesomeIcon
          v-if="fullscreenOverlay"
          :icon="['fas', 'file-lines']"
        />
        {{ t('Video.Transcript.Title') }}
      </h3>
      <div
        class="transcriptHeaderActions"
        @focusout="handleHeaderActionsFocusout"
        @keydown.esc.stop.prevent="languageMenuOpen = false"
      >
        <button
          v-if="fullscreenOverlay"
          type="button"
          class="transcriptHeaderAction"
          :class="{ active: searchOpen }"
          :title="t('Video.Transcript.Search')"
          :aria-label="t('Video.Transcript.Search')"
          :aria-expanded="String(searchOpen)"
          @click="toggleTranscriptSearch"
        >
          <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" />
        </button>
        <button
          v-if="fullscreenOverlay && captions.length > 1"
          type="button"
          class="transcriptHeaderAction"
          :class="{ active: languageMenuOpen }"
          :title="t('Video.Transcript.Language')"
          :aria-label="t('Video.Transcript.Language')"
          :aria-expanded="String(languageMenuOpen)"
          @click="languageMenuOpen = !languageMenuOpen"
        >
          <FontAwesomeIcon :icon="['fas', 'language']" />
        </button>
        <div
          v-if="segments.length > 0"
          class="transcriptActions"
        >
          <template v-if="fullscreenOverlay">
            <FtIconButton
              :title="t('Video.Transcript.Copy')"
              :icon="['fas', 'copy']"
              theme="base-no-default"
              :use-shadow="false"
              @click="copyTranscript"
            />
            <FtIconButton
              :title="t('Video.Transcript.Save')"
              :icon="['fas', 'download']"
              theme="base-no-default"
              :use-shadow="false"
              @click="saveTranscript"
            />
          </template>
          <template v-else>
            <FtButton
              :label="t('Video.Transcript.Copy')"
              :icon="['fas', 'copy']"
              @click="copyTranscript"
            />
            <FtButton
              :label="t('Video.Transcript.Save')"
              :icon="['fas', 'download']"
              @click="saveTranscript"
            />
          </template>
        </div>
        <FtIconButton
          :title="t('Video.Transcript.Close')"
          :icon="['fas', 'xmark']"
          theme="base-no-default"
          :use-shadow="false"
          @click="emit('close')"
        />
        <div
          v-if="languageMenuOpen"
          class="transcriptLanguageMenu"
        >
          <button
            v-for="(caption, index) in captions"
            :key="index"
            type="button"
            :class="{ selected: selectedCaptionIndex === String(index) }"
            @click="selectCaptionLanguage(index)"
          >
            <span>{{ caption.label }}</span>
            <FontAwesomeIcon
              v-if="selectedCaptionIndex === String(index)"
              :icon="['fas', 'check']"
            />
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="captions.length > 0 && (!fullscreenOverlay || searchOpen)"
      class="transcriptControls"
    >
      <FtInput
        :value="searchQuery"
        :placeholder="t('Video.Transcript.Search')"
        :show-action-button="false"
        :show-clear-text-button="true"
        @input="searchQuery = $event"
        @clear="searchQuery = ''"
      />
      <FtSelect
        v-if="!fullscreenOverlay && captions.length > 1"
        :value="selectedCaptionIndex"
        :select-names="captions.map(caption => caption.label)"
        :select-values="captions.map((caption, index) => String(index))"
        :placeholder="t('Video.Transcript.Language')"
        :icon="['fas', 'language']"
        @change="selectedCaptionIndex = $event"
      />
    </div>

    <FtLoader v-if="isLoading" />
    <p
      v-else-if="statusMessage"
      class="transcriptMessage"
    >
      {{ statusMessage }}
    </p>
    <div
      v-else
      ref="segmentList"
      class="transcriptSegments"
      role="list"
      :aria-label="t('Video.Transcript.Title')"
    >
      <div
        v-for="segment in filteredSegments"
        :key="`${segment.start}-${segment.index}`"
        role="listitem"
      >
        <button
          :data-segment-index="segment.index"
          class="transcriptSegment"
          :class="{ active: segment.index === activeSegmentIndex }"
          :aria-current="segment.index === activeSegmentIndex ? 'true' : null"
          @click="emit('timestamp-event', segment.start)"
        >
          <span class="transcriptTimestamp">{{ formatTimestamp(segment.start) }}</span>
          <span class="transcriptText">{{ segment.text }}</span>
        </button>
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import { getTranscriptPreScrollTop } from './transcriptScroll.js'

import {
  copyToClipboard,
  formatDurationAsTimestamp,
  showToast,
  writeFileWithPicker
} from '../../helpers/utils'

const props = defineProps({
  captions: {
    type: Array,
    default: () => []
  },
  currentTime: {
    type: Number,
    default: 0
  },
  preferredCaptionIndex: {
    type: Number,
    default: 0
  },
  videoTitle: {
    type: String,
    default: ''
  },
  fullscreenOverlay: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'timestamp-event'])
const { t } = useI18n()

const selectedCaptionIndex = ref(String(props.preferredCaptionIndex))
const languageMenuOpen = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const segments = ref([])
const isLoading = ref(false)
const loadFailed = ref(false)
const segmentList = useTemplateRef('segmentList')

/** @type {AbortController|null} */
let loadController = null
let hasAlignedActiveSegment = false

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLocaleLowerCase())
const filteredSegments = computed(() => {
  if (normalizedSearchQuery.value === '') {
    return segments.value
  }

  return segments.value.filter(segment => segment.text.toLocaleLowerCase().includes(normalizedSearchQuery.value))
})
const activeSegmentIndex = computed(() => {
  return segments.value.findLastIndex(segment => (
    props.currentTime >= segment.start && props.currentTime < segment.end
  ))
})
const statusMessage = computed(() => {
  if (props.captions.length === 0) {
    return t('Video.Transcript.Unavailable')
  }
  if (loadFailed.value) {
    return t('Video.Transcript.Load Error')
  }
  if (segments.value.length === 0) {
    return t('Video.Transcript.Empty')
  }
  if (filteredSegments.value.length === 0) {
    return t('Video.Transcript.No Results')
  }

  return ''
})

watch(
  [() => props.captions, selectedCaptionIndex],
  async ([captions]) => {
    loadController?.abort()
    loadController = null
    hasAlignedActiveSegment = false
    segments.value = []
    isLoading.value = false
    loadFailed.value = false

    const caption = captions[Number(selectedCaptionIndex.value)]
    if (!caption) {
      return
    }

    const controller = new AbortController()
    loadController = controller
    isLoading.value = true

    try {
      const response = await fetch(caption.url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      segments.value = parseTranscript(await response.text())
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Unable to load transcript', error)
        loadFailed.value = true
      }
    } finally {
      if (loadController === controller) {
        loadController = null
        isLoading.value = false
      }
    }
  },
  { immediate: true, deep: true }
)

watch(() => props.captions, (captions) => {
  if (Number(selectedCaptionIndex.value) >= captions.length) {
    selectedCaptionIndex.value = '0'
  }
})

watch(() => props.preferredCaptionIndex, (index) => {
  selectedCaptionIndex.value = String(index)
})

watch(() => props.fullscreenOverlay, () => {
  searchOpen.value = false
  searchQuery.value = ''
  languageMenuOpen.value = false
})

watch(activeSegmentIndex, async (index) => {
  if (index < 0 || normalizedSearchQuery.value !== '') {
    return
  }

  await nextTick()
  const list = segmentList.value
  const activeSegment = list?.querySelector(`[data-segment-index="${index}"]`)
  if (!list || !activeSegment) {
    return
  }

  const top = activeSegment.offsetTop - list.clientHeight / 2 + activeSegment.clientHeight / 2
  if (!hasAlignedActiveSegment) {
    list.scrollTop = getTranscriptPreScrollTop(list.scrollTop, top, list.clientHeight)
  }

  list.scrollTo({ top, behavior: 'smooth' })
  hasAlignedActiveSegment = true
})

onBeforeUnmount(() => loadController?.abort())

function formatTimestamp(seconds) {
  return formatDurationAsTimestamp(Math.floor(seconds))
}

function toggleTranscriptSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) {
    searchQuery.value = ''
  }
}

function selectCaptionLanguage(index) {
  selectedCaptionIndex.value = String(index)
  languageMenuOpen.value = false
}

function handleHeaderActionsFocusout(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    languageMenuOpen.value = false
  }
}

function transcriptText() {
  return segments.value
    .map(segment => `${formatTimestamp(segment.start)} ${segment.text}`)
    .join('\n')
}

async function copyTranscript() {
  await copyToClipboard(transcriptText(), {
    messageOnSuccess: t('Video.Transcript.Copied')
  })
}

async function saveTranscript() {
  const safeTitle = (props.videoTitle || t('Video.Transcript.Title'))
    .replaceAll(/[\\/:*?"<>|]/g, '_')

  try {
    const saved = await writeFileWithPicker(
      `${safeTitle} - transcript.txt`,
      transcriptText(),
      t('Video.Transcript.Text File'),
      'text/plain',
      '.txt',
      'video-transcript-export',
      'downloads'
    )

    if (saved) {
      showToast(t('Video.Transcript.Saved'))
    }
  } catch (error) {
    console.error('Unable to save transcript', error)
    showToast(`${t('Video.Transcript.Save Error')}: ${error}`, 5000)
  }
}

/**
 * @param {string} transcript
 * @returns {{ index: number, start: number, end: number, text: string }[]}
 */
function parseTranscript(transcript) {
  const blocks = transcript.replaceAll('\r', '').replace(/^\uFEFF/, '').split(/\n{2,}/)
  const parsedSegments = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex === -1) {
      continue
    }

    const timestamps = lines[timingIndex].match(
      /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/
    )
    if (!timestamps) {
      continue
    }

    const cueText = lines.slice(timingIndex + 1).join('\n')

    parsedSegments.push({
      start: parseTimestamp(timestamps[1]),
      end: parseTimestamp(timestamps[2]),
      text: cleanCaptionText(cueText),
      hasInlineTimestamps: /<(?:\d+:)?\d{2}:\d{2}[.,]\d{3}>/.test(cueText)
    })
  }

  const segments = parsedSegments.some(segment => segment.hasInlineTimestamps)
    ? normalizeRollingCaptions(parsedSegments)
    : parsedSegments.filter(segment => segment.text !== '')

  return segments.map(({ start, end, text }, index) => ({ index, start, end, text }))
}

/**
 * YouTube's auto-generated VTT alternates rolling karaoke cues with short
 * committed cues. Keep only the text added by each cue to avoid duplicates.
 * @param {{ start: number, end: number, text: string }[]} segments
 * @returns {{ start: number, end: number, text: string }[]}
 */
function normalizeRollingCaptions(segments) {
  const normalized = []
  let previousText = ''

  for (const segment of segments) {
    const text = removeOverlappingPrefix(previousText, segment.text)
    previousText = segment.text

    if (text !== '') {
      normalized.push({ ...segment, text })
    }
  }

  return normalized.map((segment, index) => ({
    ...segment,
    end: normalized[index + 1]?.start ?? segment.end
  }))
}

function removeOverlappingPrefix(previousText, text) {
  if (previousText === '' || text === '') {
    return text
  }

  const previousWords = previousText.split(' ')
  const words = text.split(' ')
  const maxOverlap = Math.min(previousWords.length, words.length)

  for (let length = maxOverlap; length > 0; length--) {
    const previousStart = previousWords.length - length
    const matches = words.slice(0, length).every((word, index) => (
      word === previousWords[previousStart + index]
    ))

    if (matches) {
      return words.slice(length).join(' ')
    }
  }

  return text
}

function parseTimestamp(timestamp) {
  const parts = timestamp.replace(',', '.').split(':').map(Number)
  const seconds = parts.pop()
  const minutes = parts.pop() ?? 0
  const hours = parts.pop() ?? 0

  return hours * 3600 + minutes * 60 + seconds
}

function cleanCaptionText(text) {
  const element = document.createElement('div')
  element.innerHTML = text
    .replaceAll(/<(?:\d+:)?\d{2}:\d{2}[.,]\d{3}>/g, '')
    .replaceAll(/<br\s*\/?>/gi, '\n')
  return element.textContent.replaceAll(/\s*\n\s*/g, ' ').replaceAll(/\s+/g, ' ').trim()
}
</script>

<style scoped src="./WatchVideoTranscript.css" />
