<template>
  <FtPrompt
    :label="$t('Settings.Privacy Settings.Cache Video Metadata')"
    card-class="videoMetadataHistoryPrompt"
    fixed-layout
    @click="emit('close')"
  >
    <div class="historySections">
      <section
        v-if="titleHistory.length > 0"
        class="historySection"
      >
        <h3>{{ $t('Video.Metadata Cache.Title History') }}</h3>
        <ol class="textHistory">
          <li
            v-for="(version, index) in titleHistory"
            :key="versionKey(version, index)"
            class="historyEntry"
          >
            <div class="historyEntryHeader">
              <strong>{{ versionLabel(index) }}</strong>
              <time :datetime="dateTime(version.cachedAt)">{{ formatDate(version.cachedAt) }}</time>
            </div>
            <div
              class="metadataText"
              dir="auto"
            >
              {{ version.value }}
            </div>
          </li>
        </ol>
        <FtButton
          v-if="isPaged && fields.title.cursor.value"
          :label="$t('Theme Discovery.Load More')"
          :icon="['fas', 'arrow-down']"
          @click="load('title', true)"
        />
      </section>

      <section
        v-if="thumbnailHistory.length > 0"
        class="historySection"
      >
        <h3>{{ $t('Video.Metadata Cache.Thumbnail History') }}</h3>
        <ol class="thumbnailHistory">
          <li
            v-for="(version, index) in thumbnailHistory"
            :key="versionKey(version, index)"
            class="historyEntry"
          >
            <div class="historyEntryHeader">
              <strong>{{ versionLabel(index) }}</strong>
              <time :datetime="dateTime(version.cachedAt)">{{ formatDate(version.cachedAt) }}</time>
            </div>
            <div class="thumbnailFrame">
              <FtRetryImage
                v-if="!isPaged && thumbnailSource(version)"
                :src="thumbnailSource(version)"
                :alt="versionLabel(index)"
              />
              <WatchMetadataThumbnail
                v-if="isPaged"
                :revision-id="version.thumbnailRevisionId"
                :fallback-url="version.thumbnailUrl"
                :alt="versionLabel(index)"
              />
            </div>
          </li>
        </ol>
        <FtButton
          v-if="isPaged && fields.thumbnail.cursor.value"
          :label="$t('Theme Discovery.Load More')"
          :icon="['fas', 'arrow-down']"
          @click="load('thumbnail', true)"
        />
      </section>

      <section
        v-if="descriptionHistory.length > 0"
        class="historySection"
      >
        <h3>{{ $t('Video.Metadata Cache.Description History') }}</h3>
        <ol class="textHistory">
          <li
            v-for="(version, index) in descriptionHistory"
            :key="versionKey(version, index)"
            class="historyEntry"
          >
            <div class="historyEntryHeader">
              <strong>{{ versionLabel(index) }}</strong>
              <time :datetime="dateTime(version.cachedAt)">{{ formatDate(version.cachedAt) }}</time>
            </div>
            <div
              ref="descriptionScrollers"
              v-overlay-scrollbars
              class="metadataText metadataDescription"
              dir="auto"
            >
              <div class="metadataDescriptionContent">
                {{ version.value || $t('Video.Metadata Cache.Empty') }}
              </div>
            </div>
          </li>
        </ol>
        <FtButton
          v-if="isPaged && fields.description.cursor.value"
          :label="$t('Theme Discovery.Load More')"
          :icon="['fas', 'arrow-down']"
          @click="load('description', true)"
        />
      </section>
    </div>

    <template #footer>
      <FtFlexBox>
        <FtButton
          :label="$t('Close')"
          :icon="['fas', 'xmark']"
          @click="emit('close')"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import WatchMetadataThumbnail from './WatchMetadataThumbnail.vue'
import { DBLibraryHandlers } from '../../../datastores/handlers/index'
import FtRetryImage from '../FtRetryImage.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { formatDateTime } from '../../helpers/dateFormat'
import store from '../../store'
import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

const props = defineProps({
  history: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close'])
const isPaged = computed(() => typeof props.history.videoId === 'string')
const fields = Object.fromEntries(['title', 'description', 'thumbnail'].map(field => [field, { records: shallowRef([]), cursor: ref(null), busy: ref(false) }]))
let generation = 0
async function load(field, append = false) {
  const current = generation
  const state = fields[field]
  if (!isPaged.value || state.busy.value) return
  state.busy.value = true
  try {
    const page = await DBLibraryHandlers.query('metadataPage', { videoId: props.history.videoId, field, cursor: append ? state.cursor.value : null })
    if (current !== generation) return
    if (page.stale) { state.busy.value = false; await load(field); return }
    state.records.value = append ? state.records.value.concat(page.records) : page.records
    state.cursor.value = page.cursor
  } finally { if (current === generation) state.busy.value = false }
}
watch(() => props.history.videoId, () => {
  ++generation
  for (const [field, state] of Object.entries(fields)) {
    state.busy.value = false; state.records.value = []; state.cursor.value = null
    load(field).catch(console.error)
  }
}, { immediate: true })
const { locale, t } = useI18n()
const descriptionScrollers = useTemplateRef('descriptionScrollers')
const dateFormat = computed(() => store.getters.getDateFormat)
const timeFormat = computed(() => store.getters.getTimeFormat)

let descriptionResizeObserver = null

function observeDescriptions() {
  descriptionResizeObserver?.disconnect()
  const scrollers = descriptionScrollers.value ?? []
  const clampDescriptions = () => {
    for (const scroller of scrollers) {
      const content = scroller.firstElementChild
      if (content) clampOverlayScrollTop(scroller, content)
    }
  }
  if (typeof ResizeObserver === 'function') {
    descriptionResizeObserver = new ResizeObserver(clampDescriptions)
    for (const scroller of scrollers) {
      descriptionResizeObserver.observe(scroller)
      if (scroller.firstElementChild) descriptionResizeObserver.observe(scroller.firstElementChild)
    }
  }
  clampDescriptions()
}
onMounted(() => nextTick(observeDescriptions))
watch(() => fields.description.records.value, () => nextTick(observeDescriptions))

onBeforeUnmount(() => { ++generation; descriptionResizeObserver?.disconnect() })

const materializedRevisions = computed(() => {
  let thumbnail = null

  return (props.history.revisions ?? []).map(revision => {
    if (revision.hasThumbnailChange) thumbnail = revision.thumbnail
    return { ...revision, thumbnail }
  })
})

function createFieldHistory(valueForRevision) {
  const versions = []
  let previousValue
  let hasPreviousValue = false

  for (const revision of materializedRevisions.value) {
    const value = valueForRevision(revision)
    if (!hasPreviousValue || value !== previousValue) {
      versions.push({ ...revision, value })
      previousValue = value
      hasPreviousValue = true
    }
  }

  // The latest value is already visible on the watch page; this modal only
  // presents values which the video used previously.
  versions.pop()
  return versions.reverse()
}

const titleHistory = computed(() => isPaged.value ? fields.title.records.value : createFieldHistory(revision => revision.title))
const descriptionHistory = computed(() => isPaged.value ? fields.description.records.value : createFieldHistory(revision => revision.description))
const thumbnailHistory = computed(() => isPaged.value ? fields.thumbnail.records.value : createFieldHistory(revision => revision.thumbnail ?? revision.thumbnailUrl))

function versionLabel(index) {
  return t('Video.Metadata Cache.Previous Version', { number: index + 1 })
}

function formatDate(cachedAt) {
  return formatDateTime(
    cachedAt,
    locale.value,
    dateFormat.value,
    { dateStyle: 'medium' },
    { timeStyle: 'short' },
    timeFormat.value
  )
}

function dateTime(cachedAt) {
  return new Date(cachedAt).toISOString()
}

function versionKey(version, index) {
  return `${version._id ?? version.cachedAt}-${index}`
}

function thumbnailSource(version) {
  return version.thumbnail || version.thumbnailUrl
}
</script>

<style scoped src="./WatchVideoMetadataHistory.css" />
