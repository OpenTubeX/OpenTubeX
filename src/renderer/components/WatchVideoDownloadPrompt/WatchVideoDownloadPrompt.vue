<template>
  <FtPrompt
    :label="downloadLabel"
    :autosize="true"
    card-class="downloadPromptCard"
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
    </template>
    <div class="downloadPromptContent">
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
            class="saveTemplateButton"
            :title="t('Downloads.Save Template')"
            :icon="['fas', 'save']"
            theme="secondary"
            @click="openSaveTemplatePrompt"
          />
        </div>
        <FtButton
          v-if="!isDirty && selectedCustomTemplate !== undefined"
          :label="t('Downloads.Delete Template')"
          :icon="['fas', 'trash']"
          text-color="var(--destructive-text-color)"
          background-color="var(--destructive-color)"
          @click="deleteTemplate"
        />
      </section>
      <div
        v-if="activeDownload === null"
        v-overlay-scrollbars
        class="downloadOptions"
      >
        <section class="optionSection optionGrid">
          <FtSelect
            :placeholder="t('Downloads.Media Type')"
            :value="options.mode"
            :select-names="[t('Downloads.Video'), t('Downloads.Audio')]"
            :select-values="['video', 'audio']"
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
            :placeholder="options.mode === 'video' ? t('Downloads.Video Codec') : t('Downloads.Audio Codec')"
            :value="selectedCodec"
            :select-names="codecNames"
            :select-values="codecValues"
            @change="setSelectedCodec"
          />
        </section>

        <section class="optionSection">
          <FtInput
            class="fullWidth"
            :placeholder="t('Downloads.File Name Template')"
            :tooltip="fileNameTemplateHelp"
            :show-action-button="false"
            :show-label="true"
            :value="options.filenameTemplate"
            @input="setOption('filenameTemplate', $event)"
          />
        </section>

        <section class="optionSection">
          <h3>{{ t('Downloads.Time Range and Chapters') }}</h3>
          <div class="optionGrid segmentGrid">
            <FtInput
              :placeholder="t('Downloads.Start Time')"
              :show-action-button="false"
              :show-label="true"
              :value="options.startTime"
              @input="setOption('startTime', $event)"
            />
            <FtInput
              :placeholder="t('Downloads.End Time')"
              :show-action-button="false"
              :show-label="true"
              :value="options.endTime"
              @input="setOption('endTime', $event)"
            />
          </div>
          <div class="toggleGrid">
            <FtToggleSwitch
              compact
              :label="t('Downloads.Split by Chapters')"
              :default-value="options.splitChapters"
              @change="setOption('splitChapters', $event)"
            />
          </div>
        </section>

        <section class="optionSection">
          <h3>{{ t('Downloads.SponsorBlock') }}</h3>
          <div class="toggleGrid">
            <FtToggleSwitch
              compact
              :label="t('Downloads.Remove Segments')"
              :default-value="options.removeSponsorblock"
              @change="setOption('removeSponsorblock', $event)"
            />
          </div>
          <div
            :class="{ disabledOptions: !options.removeSponsorblock }"
            :inert="!options.removeSponsorblock"
            :aria-disabled="!options.removeSponsorblock"
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
              :default-value="options.embedThumbnail"
              @change="setOption('embedThumbnail', $event)"
            />
            <FtToggleSwitch
              compact
              :label="t('Downloads.Embed Metadata')"
              :default-value="options.embedMetadata"
              @change="setOption('embedMetadata', $event)"
            />
            <FtToggleSwitch
              compact
              :label="t('Downloads.Include Subtitles')"
              :default-value="options.includeSubtitles"
              @change="setOption('includeSubtitles', $event)"
            />
            <FtToggleSwitch
              compact
              :label="t('Downloads.Embed Subtitles')"
              :default-value="options.embedSubtitles"
              :disabled="!options.includeSubtitles"
              @change="setOption('embedSubtitles', $event)"
            />
          </div>
          <FtInput
            class="fullWidth subtitleLanguages"
            :placeholder="t('Downloads.Subtitle Languages')"
            :tooltip="t('Downloads.Subtitle Languages Help')"
            :disabled="!options.includeSubtitles"
            :show-action-button="false"
            :show-label="true"
            :value="options.subtitleLanguages"
            @input="setOption('subtitleLanguages', $event)"
          />
        </section>

        <section class="optionSection">
          <FtInput
            class="fullWidth"
            :placeholder="t('Downloads.Additional yt-dlp Arguments')"
            :show-action-button="false"
            :show-label="true"
            :value="options.customArgs"
            @input="setOption('customArgs', $event)"
          />
        </section>
      </div>

      <div
        v-else
        class="downloadProgress"
      >
        <div class="downloadProgressState">
          <div
            v-if="downloadInProgress"
            class="downloadProgressBarTrack"
          >
            <div
              class="downloadProgressBarFill"
              :class="{ indeterminate: activeDownload.status === 'processing' }"
              :style="{ inlineSize: `${activeDownload.percent}%` }"
            />
          </div>
          <p class="downloadStatusLine">
            {{ statusLine }}
          </p>
        </div>
        <p
          v-if="activeDownload.status === 'failed' && activeDownload.errorMessage !== 'ENOENT' && activeDownload.errorMessage"
          class="downloadErrorDetails"
        >
          {{ activeDownload.errorMessage }}
        </p>
      </div>

      <footer class="downloadFooter">
        <p class="downloadFolderRow">
          <FontAwesomeIcon :icon="['fas', 'folder-open']" />
          <span>{{ downloadFolderDisplay }}</span>
          <button
            type="button"
            class="chooseFolderButton"
            @click="chooseDownloadFolder"
          >
            {{ downloadFolderRequired ? t('Downloads.Select Folder') : t('Downloads.Choose Folder') }}
          </button>
        </p>
        <FtFlexBox>
          <FtButton
            v-if="activeDownload === null"
            :label="t('Downloads.Download')"
            :icon="['fas', 'download']"
            :disabled="downloadFolderRequired"
            @click="startDownload"
          />
          <FtButton
            v-else-if="downloadInProgress"
            :label="t('Downloads.Cancel Download')"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            @click="cancelDownload"
          />
          <FtButton
            :label="activeDownload === null ? t('Cancel') : t('Close')"
            :text-color="null"
            :background-color="null"
            @click="close"
          />
        </FtFlexBox>
      </footer>
    </div>
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
        :placeholder="t('Downloads.Template Name')"
        :show-action-button="false"
        :show-label="true"
        :value="newTemplateName"
        @input="(value) => newTemplateName = value"
        @keydown.enter="saveTemplate"
      />
      <FtFlexBox>
        <FtButton
          :label="t('Downloads.Save Template')"
          :icon="['fas', 'save']"
          :disabled="newTemplateName.trim() === ''"
          @click="saveTemplate"
        />
        <FtButton
          :label="t('Cancel')"
          :text-color="null"
          :background-color="null"
          @click="closeSaveTemplatePrompt"
        />
      </FtFlexBox>
    </div>
  </FtPrompt>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import store from '../../store/index'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  videoId: { type: String, default: '' },
  videoIds: { type: Array, default: () => [] },
  playlistId: { type: String, default: '' },
  playlistKey: { type: String, default: '' },
  isPlaylist: { type: Boolean, default: false },
  title: { type: String, required: true },
  thumbnail: { type: String, default: '' }
})
const emit = defineEmits(['close'])
const { t } = useI18n()
const downloadLabel = computed(() => props.isPlaylist
  ? t('Downloads.Download Playlist')
  : t('Downloads.Download Video'))

const BASE_OPTIONS = Object.freeze({
  mode: 'video',
  quality: '',
  videoFormat: '',
  videoCodec: '',
  audioFormat: '',
  filenameTemplate: '{title} [{id}].{ext}',
  startTime: '',
  endTime: '',
  splitChapters: false,
  removeSponsorblock: false,
  sponsorBlockCategories: ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler'],
  includeSubtitles: false,
  embedSubtitles: true,
  subtitleLanguages: 'all,-live_chat',
  embedThumbnail: false,
  embedMetadata: false,
  customArgs: ''
})
const DEFAULT_TEMPLATES = [
  { value: 'video:best', options: {} },
  { value: 'video:best:mp4', options: { videoFormat: 'mp4' } },
  { value: 'video:1080', options: { quality: '1080' } },
  { value: 'video:1080:mp4', options: { quality: '1080', videoFormat: 'mp4' } },
  { value: 'video:720', options: { quality: '720' } },
  { value: 'video:720:mp4', options: { quality: '720', videoFormat: 'mp4' } },
  { value: 'video:480', options: { quality: '480' } },
  { value: 'video:480:mp4', options: { quality: '480', videoFormat: 'mp4' } },
  { value: 'audio:best', options: { mode: 'audio', embedThumbnail: true, embedMetadata: true } },
  { value: 'audio:mp3', options: { mode: 'audio', audioFormat: 'mp3', embedThumbnail: true, embedMetadata: true } }
]

const customTemplates = computed(() => JSON.parse(store.getters.getYtDlpDownloadTemplates))
const storedSelection = store.getters.getYtDlpSelectedTemplate
const selectedTemplate = ref(storedSelection)
const isDirty = ref(false)
const newTemplateName = ref('')
const showSaveTemplatePrompt = ref(false)
const templateNameInput = useTemplateRef('templateNameInput')
const options = reactive({ ...BASE_OPTIONS })

const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler']
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
const selectedCodec = computed(() => options.mode === 'video' ? options.videoCodec : options.audioFormat)
const codecNames = computed(() => options.mode === 'video'
  ? [t('Downloads.Automatic'), 'H.264', 'H.265 / HEVC', 'VP9', 'AV1']
  : [t('Downloads.Best Available'), 'MP3', 'M4A', 'Opus', 'FLAC'])
const codecValues = computed(() => options.mode === 'video'
  ? ['', 'h264', 'h265', 'vp9', 'av1']
  : ['', 'mp3', 'm4a', 'opus', 'flac'])
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
  const defaultTemplate = DEFAULT_TEMPLATES.find(template => template.value === value)
  if (defaultTemplate) return defaultTemplate.options
  const custom = customTemplates.value.find(template => `template:${template.name}` === value)
  if (custom?.options) return custom.options
  if (custom?.args) return { customArgs: custom.args }
  return {}
}

function normalizeOptions(source) {
  return Object.fromEntries(Object.keys(BASE_OPTIONS).map(key => {
    const value = source[key] ?? BASE_OPTIONS[key]
    return [key, Array.isArray(value) ? [...value].sort() : value]
  }))
}

function optionsMatchTemplate(value) {
  return JSON.stringify(normalizeOptions(options)) ===
    JSON.stringify(normalizeOptions(getTemplateOptions(value)))
}

function findMatchingTemplate() {
  const candidates = [
    selectedTemplate.value,
    ...DEFAULT_TEMPLATES.map(template => template.value),
    ...customTemplates.value.map(template => `template:${template.name}`)
  ]

  return [...new Set(candidates)].find(optionsMatchTemplate)
}

function loadTemplate(value) {
  Object.assign(options, normalizeOptions(getTemplateOptions(value)))
  selectedTemplate.value = value
  isDirty.value = false
}
loadTemplate(
  DEFAULT_TEMPLATES.some(template => template.value === storedSelection) || storedSelection.startsWith('template:')
    ? storedSelection
    : 'video:best'
)

const selectedCustomTemplate = computed(() => customTemplates.value.find(
  template => `template:${template.name}` === selectedTemplate.value
))
const displayedTemplate = computed(() => isDirty.value ? 'unsaved' : selectedTemplate.value)
const defaultTemplateNames = computed(() => [
  t('Downloads.Templates.Video Best'), `${t('Downloads.Templates.Video Best')} (MP4)`,
  t('Downloads.Templates.Video Resolution', { resolution: '1080p' }), `${t('Downloads.Templates.Video Resolution', { resolution: '1080p' })} (MP4)`,
  t('Downloads.Templates.Video Resolution', { resolution: '720p' }), `${t('Downloads.Templates.Video Resolution', { resolution: '720p' })} (MP4)`,
  t('Downloads.Templates.Video Resolution', { resolution: '480p' }), `${t('Downloads.Templates.Video Resolution', { resolution: '480p' })} (MP4)`,
  t('Downloads.Templates.Audio Best'), t('Downloads.Templates.Audio Format', { format: 'MP3' })
])
const templateNames = computed(() => [
  ...defaultTemplateNames.value,
  ...customTemplates.value.map(template => template.name),
  ...(isDirty.value ? [t('Downloads.Unsaved')] : [])
])
const templateValues = computed(() => [
  ...DEFAULT_TEMPLATES.map(template => template.value),
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
  setOption(options.mode === 'video' ? 'videoCodec' : 'audioFormat', value)
}
function saveTemplate() {
  const name = newTemplateName.value.trim()
  if (name === '') return
  const templates = customTemplates.value.filter(template => template.name !== name)
  templates.push({ name, options: { ...options } })
  const value = `template:${name}`
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', value)
  selectedTemplate.value = value
  isDirty.value = false
  newTemplateName.value = ''
  showSaveTemplatePrompt.value = false
  showToast({ message: t('Downloads.Template Saved', { name }), icon: ['fas', 'save'] })
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
  const templates = customTemplates.value.filter(template => template.name !== selectedCustomTemplate.value.name)
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', 'video:best')
  loadTemplate('video:best')
}

function matchesDownload(download) {
  if (!props.isPlaylist) return download.videoId === props.videoId
  return props.playlistKey !== '' && download.playlistKey === props.playlistKey
}

const runningDownload = Object.values(store.getters.getYtDlpDownloads).filter(download =>
  matchesDownload(download) &&
  (download.status === 'downloading' || download.status === 'processing')
).at(-1)
const downloadId = ref(runningDownload?.id ?? null)
const downloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)
const downloadFolderRequired = computed(() => window.ftElectron.isFlatpak && downloadFolderPath.value === '')
const downloadFolderDisplay = computed(() => downloadFolderPath.value || (downloadFolderRequired.value
  ? t('Downloads.Folder Required')
  : t('Downloads.System Downloads Folder')))

async function chooseDownloadFolder() {
  const path = await window.ftElectron.ytDlpChooseDownloadFolder(downloadFolderPath.value)
  if (typeof path === 'string' && path.length > 0) store.dispatch('updateYtDlpDownloadFolderPath', path)
}
async function startDownload() {
  const result = await window.ftElectron.ytDlpDownload({
    ...normalizeOptions(options),
    videoId: props.videoId,
    videoIds: [...props.videoIds],
    playlistId: props.playlistId,
    playlistKey: props.playlistKey,
    isPlaylist: props.isPlaylist,
    title: props.title,
    thumbnail: props.thumbnail
  })
  if (result != null && 'id' in result) downloadId.value = result.id
  else if (result != null && 'error' in result) showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
}
const activeDownload = computed(() => downloadId.value === null
  ? null
  : store.getters.getYtDlpDownloads[downloadId.value] ?? {
    id: downloadId.value, status: 'downloading', percent: 0, speed: null, eta: null, errorMessage: null
  })
const downloadInProgress = computed(() => activeDownload.value !== null && ['downloading', 'processing'].includes(activeDownload.value.status))
const statusLine = computed(() => {
  const download = activeDownload.value
  if (!download) return ''
  if (download.status === 'downloading') return [`${download.percent.toFixed(1)}%`, download.speed, download.eta ? `ETA ${download.eta}` : null].filter(Boolean).join(' • ')
  if (download.status === 'processing') return t('Downloads.Processing')
  if (download.status === 'completed') return t('Downloads.Download Complete')
  if (download.status === 'cancelled') return t('Downloads.Download Cancelled')
  return download.errorMessage === 'ENOENT' ? t('Downloads.yt-dlp Not Found') : t('Downloads.Download Failed')
})
function cancelDownload() {
  if (downloadId.value !== null) window.ftElectron.ytDlpCancelDownload(downloadId.value)
}
function close() { emit('close') }
</script>

<style scoped src="./WatchVideoDownloadPrompt.css" />
