<template>
  <FtPrompt
    :label="$t('Video.Metadata Cache.History')"
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
              <img
                v-if="thumbnailSource(version)"
                :src="thumbnailSource(version)"
                :alt="versionLabel(index)"
              >
            </div>
          </li>
        </ol>
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
              v-overlay-scrollbars
              class="metadataText metadataDescription"
              dir="auto"
            >
              {{ version.value || $t('Video.Metadata Cache.Empty') }}
            </div>
          </li>
        </ol>
      </section>
    </div>

    <template #footer>
      <FtFlexBox>
        <FtButton
          :label="$t('Close')"
          @click="emit('close')"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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
const { locale, t } = useI18n()

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'medium',
  timeStyle: 'short'
}))

const materializedRevisions = computed(() => {
  let thumbnail = null

  return props.history.revisions.map(revision => {
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

const titleHistory = computed(() => createFieldHistory(revision => revision.title))
const descriptionHistory = computed(() => createFieldHistory(revision => revision.description))
const thumbnailHistory = computed(() => createFieldHistory(revision => revision.thumbnail ?? revision.thumbnailUrl))

function versionLabel(index) {
  return t('Video.Metadata Cache.Previous Version', { number: index + 1 })
}

function formatDate(cachedAt) {
  return dateFormatter.value.format(cachedAt)
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
