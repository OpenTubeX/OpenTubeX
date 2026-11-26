<template>
  <FtPrompt
    :label="downloadLabel"
    :autosize="true"
    fixed-layout
    :content-scrollable="false"
    :card-class="activeDownload === null ? 'downloadPromptCard' : 'downloadPromptCard activeDownloadCard'"
    :inert="showSaveTemplatePrompt"
    @click="close"
  >
    <template #label="{ labelId }">
      <header class="downloadHeader">
        <p class="downloadKind">
          {{ downloadLabel }}
        </p>
        <h2
          :id="labelId"
          class="downloadVideoTitle"
          dir="auto"
        >
          {{ title }}
        </h2>
      </header>
      <section
        v-if="activeDownload === null"
        class="optionSection templateSection fixedTemplateSection"
      >
        <div class="templateControls">
          <FtSelect
            class="fullWidth"
            :placeholder="t('Downloads.Template')"
            :value="displayedTemplate"
            :select-names="templateNames"
            :select-values="templateValues"
            :icon="['fas', 'download']"
            @change="handleTemplateChange"
          />
          <FtIconButton
            v-if="isDirty"
            class="templateActionButton"
            :title="t('Downloads.Save Template')"
            :icon="['fas', 'floppy-disk']"
            theme="secondary"
            @click="openSaveTemplatePrompt"
          />
          <FtIconButton
            v-if="!isDirty && selectedCustomTemplate !== undefined"
            class="templateActionButton"
            :title="t('Downloads.Delete Template')"
            :icon="['fas', 'trash']"
            theme="destructive"
            @click="deleteTemplate"
          />
        </div>
      </section>
    </template>
    <div class="downloadPromptContent">
      <div
        v-if="activeDownload === null"
        ref="optionsScroller"
        v-overlay-scrollbars
        class="downloadOptions"
      >
        <div ref="optionsContent">
          <details
            v-if="selectableVideos.length > 1"
            class="videoSelection"
            @toggle="handleVideoSelectionToggle"
          >
            <summary>{{ t('Downloads.Videos Selected', { selected: selectedVideoCount, total: videoSelectionTotal }) }}</summary>
            <section class="optionSection">
              <FtCheckboxList
                v-model="selectAllVideos"
                :labels="[t('Select all')]"
                :values="['all']"
                :indeterminate-values="partialVideoSelection && selectedVideos.length > 0 ? ['all'] : []"
              />
              <div
                ref="videoSelectionScroller"
                v-overlay-scrollbars
                class="videoSelectionScroller"
              >
                <div
                  ref="videoSelectionContent"
                  class="videoSelectionContent"
                >
                  <FtCheckboxList
                    v-model="selectedVideoPositions"
                    class="videoSelectionList"
                    :labels="selectableVideos.map(video => `${video.position}. ${video.title || video.videoId}`)"
                    :values="selectableVideos.map(video => video.position)"
                  />
                </div>
              </div>
              <p
                v-if="videosLoading"
                class="videoSelectionNote"
              >
                {{ t('Downloads.Loading Remaining Videos') }}
              </p>
              <p
                v-else-if="moreVideosAvailable"
                class="videoSelectionNote"
              >
                {{ t('Downloads.Unloaded Videos Excluded') }}
              </p>
              <p
                v-if="tooManyVideosSelected"
                class="videoSelectionNote invalidSelection"
              >
                {{ t('Downloads.Too Many Videos Selected', { max: MAX_LOCAL_PLAYLIST_VIDEOS }) }}
              </p>
            </section>
          </details>
          <section class="optionSection optionGrid">
            <FtSelect
              :placeholder="t('Downloads.Media Type')"
              :value="options.mode"
              :select-names="[t('Downloads.Video'), t('Downloads.Audio'), t('Search Listing.Label.Subtitles')]"
              :select-values="['video', 'audio', 'subtitles']"
              @change="setOption('mode', $event)"
            />
            <FtSelect
              :placeholder="t('Downloads.Maximum Resolution')"
              :value="options.quality"
              :disabled="options.mode !== 'video'"
              :select-names="[t('Downloads.Best Available'), '2160p', '1440p', '1080p', '720p', '480p', '360p']"
              :select-values="['', '2160', '1440', '1080', '720', '480', '360']"
              @change="setOption('quality', $event)"
            />
            <FtSelect
              :placeholder="t('Downloads.Container')"
              :value="options.videoFormat"
              :disabled="options.mode !== 'video'"
              :select-names="[t('Downloads.Automatic'), 'MP4', 'MKV', 'WebM']"
              :select-values="['', 'mp4', 'mkv', 'webm']"
              @change="setOption('videoFormat', $event)"
            />
            <FtSelect
              :placeholder="formatLabel"
              :value="selectedCodec"
              :select-names="codecNames"
              :select-values="codecValues"
              @change="setSelectedCodec"
            />
          </section>

          <details
            :open="!phoneLayout || filenameTemplateInvalid"
            class="advancedDownloadOptions"
          >
            <summary>{{ t('Settings.Categories.Advanced') }}</summary>

            <section class="optionSection">
              <FtInput
                class="fullWidth"
                :class="{ invalidTemplate: filenameTemplateInvalid }"
                :icon="['fas', 'file-lines']"
                :label="t('Downloads.File Name Template')"
                placeholder="{title}.{ext}"
                :tooltip="fileNameTemplateHelp"
                :invalid="filenameTemplateInvalid"
                :supporting-text="filenameTemplateInvalid ? t('Downloads.File Name Template Invalid') : ''"
                :show-action-button="false"
                :show-label="true"
                :value="options.filenameTemplate"
                @input="setOption('filenameTemplate', $event)"
              />
            </section>

            <section class="optionSection">
              <h3>{{ t('Downloads.Time Range and Chapters') }}</h3>
              <div class="segmentGrid">
                <FtInput
                  :icon="['fas', 'clock']"
                  :label="t('Downloads.Start Time')"
                  :input-filter="filterDownloadTimeInput"
                  placeholder="HH:MM:SS"
                  :disabled="subtitlesOnly"
                  :show-action-button="false"
                  :show-label="true"
                  :value="options.startTime"
                  @input="setOption('startTime', $event)"
                />
                <span
                  class="timeRangeSeparator"
                  aria-hidden="true"
                />
                <FtInput
                  :icon="['fas', 'clock']"
                  :label="t('Downloads.End Time')"
                  :input-filter="filterDownloadTimeInput"
                  placeholder="HH:MM:SS"
                  :disabled="subtitlesOnly"
                  :show-action-button="false"
                  :show-label="true"
                  :value="options.endTime"
                  @input="setOption('endTime', $event)"
                />
              </div>
              <div class="centeredToggle">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Split by Chapters')"
                  :default-value="!subtitlesOnly && options.splitChapters"
                  :disabled="subtitlesOnly"
                  @change="setOption('splitChapters', $event)"
                />
              </div>
            </section>

            <section class="optionSection">
              <h3>{{ t('Settings.SponsorBlock Settings.SponsorBlock Settings') }}</h3>
              <div class="centeredToggle">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Remove Segments')"
                  :default-value="!subtitlesOnly && options.removeSponsorblock"
                  :disabled="subtitlesOnly"
                  @change="setOption('removeSponsorblock', $event)"
                />
              </div>
              <div
                :class="{ disabledOptions: !sponsorBlockCategoriesEnabled }"
                :inert="!sponsorBlockCategoriesEnabled"
                :aria-disabled="!sponsorBlockCategoriesEnabled"
              >
                <FtCheckboxList
                  v-model="sponsorBlockCategories"
                  class="sponsorCategories"
                  :labels="sponsorBlockCategoryLabels"
                  :values="SPONSORBLOCK_CATEGORIES"
                />
              </div>
            </section>

            <section class="optionSection">
              <h3>{{ t('Downloads.Subtitles and Metadata') }}</h3>
              <div class="toggleGrid">
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Cover Art')"
                  :default-value="!subtitlesOnly && options.embedThumbnail"
                  :disabled="subtitlesOnly"
                  @change="setOption('embedThumbnail', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Metadata')"
                  :default-value="!subtitlesOnly && options.embedMetadata"
                  :disabled="subtitlesOnly"
                  @change="setOption('embedMetadata', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Include Subtitles')"
                  :default-value="subtitlesOnly || options.includeSubtitles"
                  :disabled="subtitlesOnly"
                  @change="setOption('includeSubtitles', $event)"
                />
                <FtToggleSwitch
                  compact
                  :label="t('Downloads.Embed Subtitles')"
                  :default-value="!subtitlesOnly && options.embedSubtitles"
                  :disabled="subtitlesOnly || !options.includeSubtitles"
                  @change="setOption('embedSubtitles', $event)"
                />
              </div>
              <FtInput
                class="fullWidth subtitleLanguages"
                :icon="['fas', 'language']"
                :label="t('Downloads.Subtitle Languages')"
                placeholder="en.*,de.*"
                :tooltip="t('Downloads.Subtitle Languages Help')"
                :disabled="!subtitlesOnly && !options.includeSubtitles"
                :show-action-button="false"
                :show-label="true"
                :value="options.subtitleLanguages"
                @input="setOption('subtitleLanguages', $event)"
              />
            </section>

            <section class="optionSection">
              <FtInput
                class="fullWidth"
                :icon="['fas', 'terminal']"
                :label="t('Downloads.Additional yt-dlp Arguments')"
                :placeholder="t('Form Inputs.Download Arguments Hint')"
                :show-action-button="false"
                :show-label="true"
                :value="options.customArgs"
                @input="setOption('customArgs', $event)"
              />
            </section>
          </details>
        </div>
      </div>

      <div
        v-else
        ref="progressScroller"
        v-overlay-scrollbars
        class="downloadProgress"
      >
        <div
          ref="progressContent"
          class="downloadProgressContent"
        >
          <div class="downloadProgressState">
            <div
              v-if="downloadInProgress"
              class="downloadProgressBarTrack"
            >
              <div
                class="downloadProgressBarFill"
                :class="{ indeterminate: ['preparing', 'processing'].includes(activeDownload.status) || activeDownload.live }"
                :style="{ transform: `scaleX(${Math.min(100, Math.max(0, activeDownload.percent)) / 100})` }"
              />
            </div>
            <p class="downloadStatusLine">
              {{ statusLine }}
            </p>
          </div>
          <DownloadActiveVideos
            class="downloadActiveVideos"
            :download="activeDownload"
          />
          <p
            v-if="activeDownload.status === 'completed' && activeDownload.errorMessage"
            class="downloadWarning"
          >
            <FtIcon
              :icon="['fas', 'triangle-exclamation']"
              aria-hidden="true"
            />
            {{ t('Downloads.Some Videos Not Downloaded') }}
          </p>
          <p
            v-if="['failed', 'completed'].includes(activeDownload.status) && activeDownload.errorMessage !== 'ENOENT' && activeDownload.errorMessage"
            class="downloadErrorDetails"
          >
            {{ downloadErrorMessage(activeDownload.errorMessage, t) }}
          </p>
          <p
            v-if="activeDownload.titleTruncated"
            class="downloadWarning"
          >
            <FtIcon
              :icon="['fas', 'triangle-exclamation']"
              aria-hidden="true"
            />
            {{ t('Downloads.File Name Shortened') }}
          </p>
          <DownloadFailureHint v-if="activeDownload.status === 'failed' && suggestsYtDlpUpdate(activeDownload.errorMessage)" />
        </div>
      </div>
    </div>
    <template #footer>
      <footer
        class="downloadFooter"
        :class="{ activeDownloadFooter: activeDownload !== null }"
      >
        <p class="downloadFolderRow">
          <FtIcon :icon="['fas', 'folder-open']" />
          <span :title="downloadFolderDisplay">{{ downloadFolderDisplay }}</span>
          <FtButton
            type="button"
            class="chooseFolderButton"
            @click="chooseDownloadFolder"
          >
            <FtIcon
              :icon="['fas', 'folder-open']"
              aria-hidden="true"
            />
            {{ downloadFolderRequired ? t('Downloads.Select Folder') : t('Downloads.Choose Folder') }}
          </FtButton>
        </p>
        <FtButtonGroup>
          <FtButton
            v-if="activeDownload === null"
            :label="t('Downloads.Download')"
            :icon="['fas', 'download']"
            :disabled="downloadFolderRequired || filenameTemplateInvalid || !videoSelectionValid"
            @click="startDownload"
          />
          <FtButton
            v-if="activeDownload !== null && canStopRecording(activeDownload)"
            :label="t('Downloads.Stop Recording')"
            :icon="['fas', 'stop']"
            @click="stopRecording"
          />
          <FtButton
            v-if="downloadInProgress"
            :label="t('Downloads.Cancel Download')"
            :icon="['fas', 'circle-xmark']"
            theme="destructive"
            @click="cancelDownload"
          />
          <FtButton
            v-if="activeDownload !== null"
            :label="t('Downloads.Open Downloads')"
            :icon="['fas', 'download']"
            :text-color="null"
            :background-color="null"
            @click="openDownloads"
          />
          <FtButton
            :label="activeDownload === null ? t('Cancel') : t('Close')"
            :icon="['fas', 'xmark']"
            :text-color="null"
            :background-color="null"
            @click="close"
          />
        </FtButtonGroup>
      </footer>
    </template>
  </FtPrompt>
  <FtPrompt
    v-if="showSaveTemplatePrompt"
    autosize
    :label="t('Downloads.Save Template')"
    @click="closeSaveTemplatePrompt"
  >
    <div class="saveTemplatePrompt">
      <FtInput
        ref="templateNameInput"
        :icon="['fas', 'hashtag']"
        :label="t('Downloads.Template Name')"
        :placeholder="t('Form Inputs.Template Name Example')"
        :show-action-button="false"
        :show-label="true"
        :value="newTemplateName"
        @input="(value) => newTemplateName = value"
        @keydown.enter="saveTemplate"
      />
      <FtButtonGroup>
        <FtButton
          :label="t('Downloads.Save Template')"
          :icon="['fas', 'floppy-disk']"
          theme="primary"
          :disabled="newTemplateName.trim() === '' || filenameTemplateInvalid"
          @click="saveTemplate"
        />
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          :text-color="null"
          :background-color="null"
          @click="closeSaveTemplatePrompt"
        />
      </FtButtonGroup>
    </div>
  </FtPrompt>
</template>

<script setup>
import { displayAndroidPath } from '../../helpers/androidStorage'
import { ytDlp } from '../../helpers/ytDlp'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useScrollClamp } from '../../composables/useScrollClamp'
import DownloadActiveVideos from '../DownloadActiveVideos/DownloadActiveVideos.vue'
import DownloadFailureHint from '../DownloadFailureHint/DownloadFailureHint.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtButtonGroup from '../FtButtonGroup/FtButtonGroup.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'
import {
  baseDownloadOptions,
  DEFAULT_DOWNLOAD_TEMPLATES,
  DOWNLOAD_SPONSORBLOCK_CATEGORIES,
  filterDownloadTimeInput,
  getDownloadTemplateOptions,
  normalizeDownloadOptions,
  parseCustomDownloadTemplates,
  replaceAutomaticDownloadTemplateReferences
} from '../../helpers/downloadTemplates'
import { findActiveDownload } from '../../helpers/templateDownloads'
import { showToast } from '../../helpers/utils'
import { canStopRecording, recordingStatusText } from '../../helpers/downloadRecording'
import { downloadErrorMessage, suggestsYtDlpUpdate } from '../../helpers/downloadErrors'
import { isSafeDownloadFilenameTemplate, MAX_LOCAL_PLAYLIST_VIDEOS } from '../../../ytDlpArguments'

const props = defineProps({
  videoId: { type: String, default: '' },
  externalUrl: { type: String, default: '' },
  videoIds: { type: Array, default: () => [] },
  playlistId: { type: String, default: '' },
  playlistKey: { type: String, default: '' },
  isPlaylist: { type: Boolean, default: false },
  // limits how many processes download a remote playlist at the same time
  videoCount: { type: Number, default: 0 },
  title: { type: String, required: true },
  thumbnail: { type: String, default: '' },
  // the loaded videos of a playlist, which can be deselected
  videos: { type: Array, default: () => [] },
  // a YouTube playlist has videos that aren't loaded yet
  moreVideosAvailable: { type: Boolean, default: false },
  videosLoading: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'select-videos'])
const { t, locale } = useI18n()
const phoneLayout = usePhoneLayout()
const optionsScroller = useTemplateRef('optionsScroller')
const optionsContent = useTemplateRef('optionsContent')
useScrollClamp(optionsScroller, optionsContent)
useScrollClamp(useTemplateRef('progressScroller'), useTemplateRef('progressContent'))
// Titles unwrap when the dialog widens, which shortens the video list
useScrollClamp(useTemplateRef('videoSelectionScroller'), useTemplateRef('videoSelectionContent'))
const downloadLabel = computed(() => props.isPlaylist
  ? t('Downloads.Download Playlist')
  : t('Downloads.Download Video'))

const BASE_OPTIONS = Object.freeze(baseDownloadOptions(locale.value))
const customTemplates = computed(() => parseCustomDownloadTemplates(store.getters.getYtDlpDownloadTemplates))
const storedSelection = store.getters.getYtDlpSelectedTemplate
const selectedTemplate = ref(storedSelection)
const isDirty = ref(false)
const newTemplateName = ref('')
const showSaveTemplatePrompt = ref(false)
const templateNameInput = useTemplateRef('templateNameInput')
const options = reactive({ ...BASE_OPTIONS })

const SPONSORBLOCK_CATEGORIES = DOWNLOAD_SPONSORBLOCK_CATEGORIES
const sponsorBlockCategories = computed({
  get: () => options.sponsorBlockCategories,
  set: value => setOption('sponsorBlockCategories', value)
})
const sponsorBlockCategoryLabels = computed(() => [
  t('Video.Sponsor Block category.sponsor'),
  t('Video.Sponsor Block category.intro'),
  t('Video.Sponsor Block category.outro'),
  t('Video.Sponsor Block category.self-promotion'),
  t('Video.Sponsor Block category.interaction'),
  t('Video.Sponsor Block category.music offtopic'),
  t('Video.Sponsor Block category.recap'),
  t('Video.Sponsor Block category.filler')
])
const subtitlesOnly = computed(() => options.mode === 'subtitles')
// the codec select doubles as the subtitle format select, as neither codec applies to subtitles
const formatOptionKey = computed(() => {
  if (subtitlesOnly.value) return 'subtitleFormat'
  return options.mode === 'video' ? 'videoCodec' : 'audioFormat'
})
const formatLabel = computed(() => {
  if (subtitlesOnly.value) return t('Downloads.Subtitle Format')
  return options.mode === 'video' ? t('Downloads.Video Codec') : t('Downloads.Audio Codec')
})
const sponsorBlockCategoriesEnabled = computed(() => !subtitlesOnly.value && options.removeSponsorblock)
const selectedCodec = computed(() => options[formatOptionKey.value])
const codecNames = computed(() => {
  if (subtitlesOnly.value) return [t('Downloads.Automatic'), 'SRT', 'VTT', 'ASS', 'LRC']
  return options.mode === 'video'
    ? [t('Downloads.Automatic'), 'H.264', 'H.265 / HEVC', 'VP9', 'AV1']
    : [t('Downloads.Best Available'), 'MP3', 'M4A', 'Opus', 'FLAC']
})
const codecValues = computed(() => {
  if (subtitlesOnly.value) return ['', 'srt', 'vtt', 'ass', 'lrc']
  return options.mode === 'video'
    ? ['', 'h264', 'h265', 'vp9', 'av1']
    : ['', 'mp3', 'm4a', 'opus', 'flac']
})
const filenameTemplateInvalid = computed(() => !isSafeDownloadFilenameTemplate(options.filenameTemplate))
const fileNameTemplateHelp = computed(() => t('Downloads.File Name Template Help', {
  title: '{title}',
  author: '{author}',
  upload_date: '{upload_date}',
  id: '{id}',
  playlist: '{playlist}',
  playlist_index: '{playlist_index}',
  ext: '{ext}'
}))

function getTemplateOptions(value) {
  return getDownloadTemplateOptions(value, customTemplates.value) ?? {}
}

function normalizeOptions(source) {
  return normalizeDownloadOptions(source, BASE_OPTIONS)
}

function optionsMatchTemplate(value) {
  return JSON.stringify(normalizeOptions(options)) ===
    JSON.stringify(normalizeOptions(getTemplateOptions(value)))
}

function findMatchingTemplate() {
  const candidates = [
    selectedTemplate.value,
    ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value),
    ...customTemplates.value.map(template => `template:${template.name}`)
  ]

  return [...new Set(candidates)].find(optionsMatchTemplate)
}

function loadTemplate(value) {
  Object.assign(options, normalizeOptions(getTemplateOptions(value)))
  selectedTemplate.value = value
  isDirty.value = false
}
let initialTemplate = 'video:best'
if (DEFAULT_DOWNLOAD_TEMPLATES.some(template => template.value === storedSelection) || storedSelection.startsWith('template:')) {
  initialTemplate = storedSelection
}
loadTemplate(initialTemplate)

const selectedCustomTemplate = computed(() => customTemplates.value.find(
  template => `template:${template.name}` === selectedTemplate.value
))
const displayedTemplate = computed(() => isDirty.value ? 'unsaved' : selectedTemplate.value)
const templateNames = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.label(t)),
  ...customTemplates.value.map(template => template.name),
  ...(isDirty.value ? [t('Downloads.Unsaved')] : [])
])
const templateValues = computed(() => [
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value),
  ...customTemplates.value.map(template => `template:${template.name}`),
  ...(isDirty.value ? ['unsaved'] : [])
])

function handleTemplateChange(value) {
  if (value !== 'unsaved') {
    loadTemplate(value)
    store.dispatch('updateYtDlpSelectedTemplate', value)
  }
}
function setOption(key, value) {
  options[key] = value
  const matchingTemplate = findMatchingTemplate()
  if (matchingTemplate !== undefined) {
    selectedTemplate.value = matchingTemplate
    isDirty.value = false
    store.dispatch('updateYtDlpSelectedTemplate', matchingTemplate)
  } else {
    isDirty.value = true
  }
}
function setSelectedCodec(value) {
  setOption(formatOptionKey.value, value)
}
function saveTemplate() {
  const name = newTemplateName.value.trim()
  if (name === '' || filenameTemplateInvalid.value) return
  const templates = customTemplates.value.filter(template => template.name !== name)
  templates.push({ name, options: { ...options } })
  const value = `template:${name}`
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', value)
  selectedTemplate.value = value
  isDirty.value = false
  newTemplateName.value = ''
  showSaveTemplatePrompt.value = false
  showToast({ message: t('Downloads.Template Saved', { name }), icon: ['fas', 'floppy-disk'] })
}
function openSaveTemplatePrompt() {
  newTemplateName.value = selectedCustomTemplate.value?.name ?? ''
  showSaveTemplatePrompt.value = true
  nextTick(() => templateNameInput.value?.select())
}
function closeSaveTemplatePrompt() {
  showSaveTemplatePrompt.value = false
  newTemplateName.value = ''
}
function deleteTemplate() {
  if (!selectedCustomTemplate.value) return
  const deletedValue = `template:${selectedCustomTemplate.value.name}`
  const templates = customTemplates.value.filter(template => template.name !== selectedCustomTemplate.value.name)
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', 'video:best')
  store.dispatch('updateYtDlpAutomaticDownloadRules', rules => replaceAutomaticDownloadTemplateReferences(
    rules,
    deletedValue,
    'video:best'
  ))
  loadTemplate('video:best')
}

// Positions start at 1, like the file names' playlist index. Videos of YouTube playlists keep
// their index, which counts the entries the playlist page leaves out.
const selectableVideos = computed(() => props.isPlaylist
  ? props.videos.map((video, index) => ({
      videoId: video.videoId,
      title: video.title,
      position: props.playlistId !== '' && Number.isSafeInteger(video.index) && video.index >= 0 ? video.index + 1 : index + 1
    }))
      .filter(video => typeof video.videoId === 'string' && video.videoId !== '')
  : [])
// New pages of a YouTube playlist load as selected, so remember the deselected videos
const deselectedVideoPositions = ref(new Set())
const selectedVideos = computed(() => selectableVideos.value.filter(video => !deselectedVideoPositions.value.has(video.position)))
const partialVideoSelection = computed(() => selectedVideos.value.length < selectableVideos.value.length)
const selectedVideoPositions = computed({
  get: () => selectedVideos.value.map(video => video.position),
  set: (positions) => {
    const selected = new Set(positions)
    deselectedVideoPositions.value = new Set(selectableVideos.value
      .filter(video => !selected.has(video.position)).map(video => video.position))
  }
})
const selectAllVideos = computed({
  get: () => partialVideoSelection.value ? [] : ['all'],
  set: (value) => {
    deselectedVideoPositions.value = value.includes('all')
      ? new Set()
      : new Set(selectableVideos.value.map(video => video.position))
  }
})
// Selecting every video downloads the whole playlist, including videos that aren't loaded yet
const videoSelectionTotal = computed(() => Math.max(selectableVideos.value.length, props.videoCount))
const selectedVideoCount = computed(() => partialVideoSelection.value ? selectedVideos.value.length : videoSelectionTotal.value)
const tooManyVideosSelected = computed(() => partialVideoSelection.value && selectedVideos.value.length > MAX_LOCAL_PLAYLIST_VIDEOS)
const videoSelectionValid = computed(() => !partialVideoSelection.value ||
  (selectedVideos.value.length > 0 && !tooManyVideosSelected.value && !props.videosLoading))
function handleVideoSelectionToggle(event) {
  if (event.target.open) emit('select-videos')
}

const runningDownload = findActiveDownload(store.getters.getYtDlpDownloads, props)
const downloadId = ref(runningDownload?.id ?? null)
const downloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)
const downloadFolderRequired = computed(() => (process.env.IS_CAPACITOR || window.ftElectron?.isFlatpak) && downloadFolderPath.value === '')
const downloadFolderDisplay = computed(() => displayAndroidPath(downloadFolderPath.value) || (downloadFolderRequired.value
  ? t('Downloads.Folder Required')
  : t('Downloads.System Downloads Folder')))

async function chooseDownloadFolder() {
  try {
    return await ytDlp.ytDlpChooseDownloadFolder()
  } catch (error) {
    showToast({
      message: error?.message || t('Settings.Data Settings.Unable to write file'),
      icon: ['fas', 'circle-exclamation']
    })
    return null
  }
}
async function startDownload() {
  if (!videoSelectionValid.value) return
  const selection = partialVideoSelection.value ? selectedVideos.value : null
  const result = await ytDlp.ytDlpDownload({
    ...normalizeOptions(options),
    videoId: props.videoId,
    ...(props.externalUrl ? { externalUrl: props.externalUrl } : {}),
    // A selection keeps the playlist ID, which plays the downloaded videos in the playlist
    videoIds: selection ? selection.map(video => video.videoId) : [...props.videoIds],
    ...(selection ? { playlistIndexes: selection.map(video => video.position) } : {}),
    playlistId: props.playlistId,
    playlistKey: props.playlistKey,
    isPlaylist: props.isPlaylist,
    ...(props.isPlaylist && props.videoCount > 0 && !selection ? { videoCount: props.videoCount } : {}),
    title: props.title,
    thumbnail: props.thumbnail,
    // edited options no longer describe the template they started from
    template: isDirty.value ? '' : selectedTemplate.value
  })
  if (result != null && 'id' in result) downloadId.value = result.id
  else if (result != null && 'error' in result) showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
}
const activeDownload = computed(() => downloadId.value === null
  ? null
  : store.getters.getYtDlpDownloads[downloadId.value] ?? {
    id: downloadId.value, status: 'preparing', percent: 0, speed: null, eta: null, errorMessage: null
  })
const downloadInProgress = computed(() => activeDownload.value !== null &&
  ['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused'].includes(activeDownload.value.status))
const statusLine = computed(() => {
  const download = activeDownload.value
  if (!download) return ''
  if (download.status === 'queued') return t('Downloads.Queued')
  if (download.status === 'paused') return t('Downloads.Paused')
  if (download.status === 'pausing') return t('Downloads.Pausing')
  if (download.status === 'downloading' && download.live) return recordingStatusText(download, t)
  if (download.status === 'downloading') return [`${download.percent.toFixed(1)}%`, download.speed, download.eta ? `ETA ${download.eta}` : null].filter(Boolean).join(' • ')
  if (download.status === 'preparing') return t('Downloads.Preparing')
  if (download.status === 'processing') return t('Downloads.Processing')
  if (download.status === 'completed') return t('Downloads.Download Complete')
  if (download.status === 'cancelled') return t('Downloads.Download Cancelled')
  return download.errorMessage === 'ENOENT' ? t('Downloads.yt-dlp Not Found') : t('Downloads.Download Failed')
})
function cancelDownload() {
  if (downloadId.value !== null) ytDlp.ytDlpCancelDownload(downloadId.value)
}
function stopRecording() {
  if (downloadId.value !== null) ytDlp.ytDlpControlDownload(downloadId.value, 'stop')
}
function openDownloads() {
  close()
  store.dispatch('showSettingsWindow', 'downloads')
}
function close() { emit('close') }
</script>

<style scoped src="./WatchVideoDownloadPrompt.css" />
