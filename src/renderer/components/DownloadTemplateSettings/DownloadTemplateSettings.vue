<template>
  <FtButton
    :label="t('Settings.Download Settings.Manage Download Templates', { templateCount: customTemplates.length })"
    :icon="['fas', 'save']"
    @click="openManager"
  />
  <FtSettingsSubpage
    :open="showManager"
    :title="t('Settings.Download Settings.Download Templates')"
    :icon="['fas', 'save']"
    @close="showManager = false"
  >
    <div class="templateManagerHeader">
      <FtSelect
        :placeholder="t('Settings.Download Settings.Template Source')"
        :value="selectedSourceValue"
        :select-names="templateSelectionNames"
        :select-values="templateSelectionValues"
        :show-icon="false"
        @change="loadTemplateSource"
      />
      <FtInput
        :placeholder="t('Downloads.Template Name')"
        :show-label="true"
        :show-action-button="false"
        :maxlength="100"
        :value="draftName"
        @input="draftName = $event"
      />
    </div>
    <div
      v-overlay-scrollbars
      class="templateOptions"
    >
      <section class="optionSection optionGrid">
        <FtSelect
          :placeholder="t('Downloads.Media Type')"
          :value="options.mode"
          :select-names="[t('Downloads.Video'), t('Downloads.Audio'), t('Downloads.Subtitles')]"
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

      <section class="optionSection">
        <FtInput
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
        <div class="optionGrid">
          <FtInput
            :placeholder="t('Downloads.Start Time')"
            :disabled="subtitlesOnly"
            :show-action-button="false"
            :show-label="true"
            :value="options.startTime"
            @input="setOption('startTime', $event)"
          />
          <FtInput
            :placeholder="t('Downloads.End Time')"
            :disabled="subtitlesOnly"
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
            :default-value="!subtitlesOnly && options.splitChapters"
            :disabled="subtitlesOnly"
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
          class="subtitleLanguages"
          :placeholder="t('Downloads.Subtitle Languages')"
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
          :placeholder="t('Downloads.Additional yt-dlp Arguments')"
          :show-action-button="false"
          :show-label="true"
          :value="options.customArgs"
          @input="setOption('customArgs', $event)"
        />
      </section>
    </div>
    <footer class="templateManagerFooter">
      <FtFlexBox>
        <FtButton
          :label="t('Settings.Download Settings.New Template')"
          :icon="['fas', 'plus']"
          :text-color="null"
          :background-color="null"
          @click="loadTemplateSource('')"
        />
        <FtButton
          v-if="selectedTemplateName !== ''"
          :label="t('Settings.Download Settings.Create Template Copy')"
          :icon="['fas', 'copy']"
          :text-color="null"
          :background-color="null"
          @click="createCopy"
        />
        <FtButton
          :label="t('Downloads.Save Template')"
          :icon="['fas', 'save']"
          :disabled="draftName.trim() === ''"
          @click="saveTemplate"
        />
        <FtButton
          v-if="selectedTemplateName !== ''"
          :label="t('Downloads.Delete Template')"
          :icon="['fas', 'trash']"
          theme="destructive"
          @click="deleteTemplate"
        />
      </FtFlexBox>
    </footer>
  </FtSettingsSubpage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'
import {
  DEFAULT_DOWNLOAD_TEMPLATES,
  getDownloadTemplateOptions,
  replaceAutomaticDownloadTemplateReferences
} from '../../helpers/downloadTemplates'
import { showToast } from '../../helpers/utils'

const { locale, t } = useI18n()
const showManager = ref(false)
const selectedSourceValue = ref('')
const selectedTemplateName = ref('')
const draftName = ref('')

const SPONSORBLOCK_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction', 'music_offtopic', 'preview', 'filler']

function defaultSubtitleLanguages() {
  return [...new Set([locale.value.split('-')[0], 'en'])]
    .map(language => `${language}.*`)
    .join(',')
}

function baseOptions() {
  return {
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
    sponsorBlockCategories: [...SPONSORBLOCK_CATEGORIES],
    includeSubtitles: false,
    embedSubtitles: true,
    subtitleLanguages: defaultSubtitleLanguages(),
    subtitleFormat: '',
    embedThumbnail: false,
    embedMetadata: false,
    customArgs: ''
  }
}

const options = reactive(baseOptions())

const customTemplates = computed(() => {
  try {
    const parsed = JSON.parse(store.getters.getYtDlpDownloadTemplates || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})
const templateSelectionNames = computed(() => [
  t('Settings.Download Settings.New Template'),
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => t('Settings.Download Settings.Built-in Template', {
    name: template.label(t)
  })),
  ...customTemplates.value.map(template => t('Settings.Download Settings.Custom Template Name', {
    name: template.name
  }))
])
const templateSelectionValues = computed(() => [
  '',
  ...DEFAULT_DOWNLOAD_TEMPLATES.map(template => `builtin:${template.value}`),
  ...customTemplates.value.map(template => `custom:${template.name}`)
])
const subtitlesOnly = computed(() => options.mode === 'subtitles')
const formatOptionKey = computed(() => {
  if (subtitlesOnly.value) return 'subtitleFormat'
  return options.mode === 'video' ? 'videoCodec' : 'audioFormat'
})
const formatLabel = computed(() => {
  if (subtitlesOnly.value) return t('Downloads.Subtitle Format')
  return options.mode === 'video' ? t('Downloads.Video Codec') : t('Downloads.Audio Codec')
})
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
const sponsorBlockCategoriesEnabled = computed(() => !subtitlesOnly.value && options.removeSponsorblock)
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
const fileNameTemplateHelp = computed(() => t('Downloads.File Name Template Help', {
  title: '{title}',
  author: '{author}',
  upload_date: '{upload_date}',
  id: '{id}',
  playlist: '{playlist}',
  playlist_index: '{playlist_index}',
  ext: '{ext}'
}))

function normalizedOptions(source) {
  const defaults = baseOptions()
  return Object.fromEntries(Object.keys(defaults).map(key => {
    const value = source?.[key] ?? defaults[key]
    return [key, Array.isArray(value) ? [...value].sort() : value]
  }))
}

function setOption(key, value) {
  options[key] = value
}

function setSelectedCodec(value) {
  setOption(formatOptionKey.value, value)
}

function openManager() {
  showManager.value = true
  loadTemplateSource(customTemplates.value[0] ? `custom:${customTemplates.value[0].name}` : '')
}

function loadTemplateSource(value) {
  selectedSourceValue.value = value

  if (value.startsWith('builtin:')) {
    const templateValue = value.slice('builtin:'.length)
    selectedTemplateName.value = ''
    draftName.value = ''
    Object.assign(options, normalizedOptions(
      getDownloadTemplateOptions(templateValue, customTemplates.value) ?? {}
    ))
    return
  }

  if (value.startsWith('custom:')) {
    const name = value.slice('custom:'.length)
    const template = customTemplates.value.find(template => template.name === name)
    if (template) {
      selectedTemplateName.value = template.name
      draftName.value = template.name
      Object.assign(options, normalizedOptions(
        template.options ?? (template.args ? { customArgs: template.args } : {})
      ))
      return
    }
  }

  selectedSourceValue.value = ''
  selectedTemplateName.value = ''
  draftName.value = ''
  Object.assign(options, normalizedOptions({}))
}

function createCopy() {
  const sourceName = selectedTemplateName.value
  if (sourceName === '') return
  selectedSourceValue.value = ''
  selectedTemplateName.value = ''
  draftName.value = t('Settings.Download Settings.Template Copy Name', { name: sourceName })
}

function updateReferences(oldValue, replacementValue) {
  if (store.getters.getYtDlpSelectedTemplate === oldValue) {
    store.dispatch('updateYtDlpSelectedTemplate', replacementValue)
  }
  store.dispatch('updateYtDlpAutomaticDownloadRules', replaceAutomaticDownloadTemplateReferences(
    store.getters.getYtDlpAutomaticDownloadRules,
    oldValue,
    replacementValue
  ))
}

function saveTemplate() {
  const name = draftName.value.trim()
  if (name === '') return

  const previousName = selectedTemplateName.value
  if (customTemplates.value.some(template => template.name === name && template.name !== previousName)) {
    showToast({ message: t('Downloads.Template Name Exists', { name }), icon: ['fas', 'circle-exclamation'] })
    return
  }
  const templates = customTemplates.value.filter(template => (
    template.name !== previousName && template.name !== name
  ))
  templates.push({ name, options: normalizedOptions(options) })
  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))

  if (previousName !== '' && previousName !== name) {
    updateReferences(`template:${previousName}`, `template:${name}`)
  }

  selectedTemplateName.value = name
  selectedSourceValue.value = `custom:${name}`
  draftName.value = name
  showToast({ message: t('Downloads.Template Saved', { name }), icon: ['fas', 'save'] })
}

function deleteTemplate() {
  const name = selectedTemplateName.value
  if (name === '') return

  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(
    customTemplates.value.filter(template => template.name !== name)
  ))
  updateReferences(`template:${name}`, 'video:best')
  loadTemplateSource('')
}
</script>

<style scoped>
.templateManagerHeader {
  flex: none;
  display: grid;
  align-items: start;
  grid-template-columns: minmax(240px, 1fr) minmax(280px, 2fr);
  gap: 16px;
  padding: 16px 20px;
}

.templateOptions {
  min-block-size: 0;
  flex: 1;
  padding-inline: 20px;
}

.optionSection {
  border-block-start: 1px solid var(--side-nav-color);
  padding-block: 16px;
}

.optionSection:first-child {
  border-block-start: 0;
}

.optionSection h3 {
  font-size: 1rem;
  margin-block: 0 12px;
}

.optionGrid,
.toggleGrid {
  display: grid;
  align-items: start;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.optionGrid > :deep(.select),
.templateManagerHeader > :deep(.select) {
  inline-size: 100%;
}

.templateManagerHeader > :deep(.ft-input-component) {
  margin-block-start: 30px;
}

.templateManagerHeader :deep(.selectLabel) {
  position: absolute;
  inset-block-start: -20px;
  inset-inline-start: 0;
  color: var(--accent-color);
  font-size: 14px;
  line-height: 1;
}

.templateManagerHeader :deep(.ft-input) {
  margin-block-end: 0;
}

.toggleGrid {
  margin-block-start: 10px;
}

.sponsorCategories {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 18px;
}

.disabledOptions {
  opacity: 0.4;
}

.subtitleLanguages {
  margin-block-start: 12px;
}

.templateManagerFooter {
  flex: none;
  border-block-start: 1px solid var(--side-nav-color);
  padding: 10px 20px;
}

@container (width <= 600px) {
  .templateManagerHeader,
  .optionGrid,
  .toggleGrid,
  .sponsorCategories {
    grid-template-columns: 1fr;
  }
}
</style>
