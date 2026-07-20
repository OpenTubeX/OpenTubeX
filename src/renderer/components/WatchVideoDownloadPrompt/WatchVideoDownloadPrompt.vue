<template>
  <FtPrompt
    :label="t('Downloads.Download Video')"
    :autosize="true"
    @click="close"
  >
    <div class="downloadPromptContent">
      <p
        class="downloadVideoTitle center"
        dir="auto"
      >
        {{ title }}
      </p>

      <template v-if="activeDownload === null">
        <FtFlexBox>
          <FtSelect
            class="downloadTypeSelect"
            :placeholder="t('Downloads.Download Type')"
            :value="selectedTemplate"
            :select-names="templateNames"
            :select-values="templateValues"
            :icon="['fas', 'download']"
            @change="handleTemplateChange"
          />
        </FtFlexBox>

        <template v-if="selectedTemplate === 'custom'">
          <FtFlexBox>
            <FtInput
              class="customArgsInput"
              :placeholder="t('Downloads.Custom yt-dlp Arguments')"
              :show-action-button="false"
              :show-label="true"
              :value="customArgs"
              @input="(value) => customArgs = value"
            />
          </FtFlexBox>
          <FtFlexBox class="templateNameRow">
            <FtInput
              class="templateNameInput"
              :placeholder="t('Downloads.Template Name')"
              :show-action-button="false"
              :show-label="true"
              :value="newTemplateName"
              @input="(value) => newTemplateName = value"
            />
            <FtButton
              :label="t('Downloads.Save Template')"
              :disabled="newTemplateName.trim() === '' || customArgs.trim() === ''"
              :text-color="null"
              :background-color="null"
              @click="saveTemplate"
            />
          </FtFlexBox>
        </template>

        <template v-else-if="selectedCustomTemplate !== undefined">
          <p class="templateArgs center">
            <code>{{ selectedCustomTemplate.args }}</code>
          </p>
          <FtFlexBox>
            <FtButton
              :label="t('Downloads.Delete Template')"
              :icon="['fas', 'trash']"
              text-color="var(--destructive-text-color)"
              background-color="var(--destructive-color)"
              @click="deleteTemplate"
            />
          </FtFlexBox>
        </template>

        <p class="downloadFolderRow center">
          <FontAwesomeIcon :icon="['fas', 'folder-open']" />
          {{ downloadFolderDisplay }}
          <button
            type="button"
            class="chooseFolderButton"
            @click="chooseDownloadFolder"
          >
            {{ t('Downloads.Choose Folder') }}
          </button>
        </p>

        <FtFlexBox>
          <FtButton
            :label="t('Downloads.Download')"
            :icon="['fas', 'download']"
            @click="startDownload"
          />
          <FtButton
            :label="t('Cancel')"
            :text-color="null"
            :background-color="null"
            @click="close"
          />
        </FtFlexBox>
      </template>

      <template v-else>
        <div class="downloadProgressBarTrack">
          <div
            class="downloadProgressBarFill"
            :class="{ indeterminate: activeDownload.status === 'processing' }"
            :style="{ inlineSize: `${activeDownload.percent}%` }"
          />
        </div>
        <p class="downloadStatusLine center">
          {{ statusLine }}
        </p>
        <p
          v-if="activeDownload.status === 'failed' && activeDownload.errorMessage !== 'ENOENT' && activeDownload.errorMessage"
          class="downloadErrorDetails"
        >
          {{ activeDownload.errorMessage }}
        </p>
        <FtFlexBox>
          <FtButton
            v-if="downloadInProgress"
            :label="t('Downloads.Cancel Download')"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            @click="cancelDownload"
          />
          <FtButton
            :label="t('Close')"
            :text-color="null"
            :background-color="null"
            @click="close"
          />
        </FtFlexBox>
      </template>
    </div>
  </FtPrompt>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSelect from '../FtSelect/FtSelect.vue'

import store from '../../store/index'

import { showToast } from '../../helpers/utils'

const props = defineProps({
  videoId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()

const DEFAULT_TEMPLATES = [
  { value: 'video:best', mode: 'video' },
  { value: 'video:1080', mode: 'video', quality: '1080' },
  { value: 'video:720', mode: 'video', quality: '720' },
  { value: 'video:480', mode: 'video', quality: '480' },
  { value: 'audio:best', mode: 'audio' },
  { value: 'audio:mp3', mode: 'audio', audioFormat: 'mp3' }
]

const customArgs = ref('')
const newTemplateName = ref('')

// if a download for this video is still running, e.g. because the prompt
// was closed and reopened, reattach to it instead of offering a new download
/** @type {import('../../../main/ytDlp').YtDlpDownloadStatus | undefined} */
const runningDownload = Object.values(store.getters.getYtDlpDownloads)
  .filter((download) => {
    return download.videoId === props.videoId &&
      (download.status === 'downloading' || download.status === 'processing')
  })
  .at(-1)

/** @type {import('vue').Ref<number | null>} */
const downloadId = ref(runningDownload?.id ?? null)

/** @type {import('vue').ComputedRef<{ name: string, args: string }[]>} */
const customTemplates = computed(() => JSON.parse(store.getters.getYtDlpDownloadTemplates))

const selectedTemplate = computed(() => {
  /** @type {string} */
  const selected = store.getters.getYtDlpSelectedTemplate

  const isValid = selected === 'custom' ||
    DEFAULT_TEMPLATES.some((template) => template.value === selected) ||
    (selected.startsWith('template:') && customTemplates.value.some((template) => `template:${template.name}` === selected))

  return isValid ? selected : 'video:best'
})

const selectedCustomTemplate = computed(() => {
  if (!selectedTemplate.value.startsWith('template:')) {
    return undefined
  }

  const name = selectedTemplate.value.slice('template:'.length)
  return customTemplates.value.find((template) => template.name === name)
})

const defaultTemplateNames = computed(() => [
  t('Downloads.Templates.Video Best'),
  t('Downloads.Templates.Video Resolution', { resolution: '1080p' }),
  t('Downloads.Templates.Video Resolution', { resolution: '720p' }),
  t('Downloads.Templates.Video Resolution', { resolution: '480p' }),
  t('Downloads.Templates.Audio Best'),
  t('Downloads.Templates.Audio Format', { format: 'MP3' })
])

const templateNames = computed(() => [
  ...defaultTemplateNames.value,
  ...customTemplates.value.map((template) => template.name),
  t('Downloads.Templates.Custom Arguments')
])

const templateValues = computed(() => [
  ...DEFAULT_TEMPLATES.map((template) => template.value),
  ...customTemplates.value.map((template) => `template:${template.name}`),
  'custom'
])

/**
 * @param {string} value
 */
function handleTemplateChange(value) {
  store.dispatch('updateYtDlpSelectedTemplate', value)
}

function saveTemplate() {
  const name = newTemplateName.value.trim()
  const args = customArgs.value.trim()

  if (name === '' || args === '') {
    return
  }

  const templates = customTemplates.value.filter((template) => template.name !== name)
  templates.push({ name, args })

  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', `template:${name}`)

  newTemplateName.value = ''
  showToast(t('Downloads.Template Saved', { name }))
}

function deleteTemplate() {
  const template = selectedCustomTemplate.value
  if (template === undefined) {
    return
  }

  const templates = customTemplates.value.filter(({ name }) => name !== template.name)

  store.dispatch('updateYtDlpDownloadTemplates', JSON.stringify(templates))
  store.dispatch('updateYtDlpSelectedTemplate', 'video:best')
}

/** @type {import('vue').ComputedRef<string>} */
const downloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)

const downloadFolderDisplay = computed(() => {
  return downloadFolderPath.value === ''
    ? t('Downloads.System Downloads Folder')
    : downloadFolderPath.value
})

async function chooseDownloadFolder() {
  const path = await window.ftElectron.ytDlpChooseDownloadFolder(downloadFolderPath.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpDownloadFolderPath', path)
  }
}

async function startDownload() {
  const payload = {
    videoId: props.videoId,
    title: props.title
  }

  const defaultTemplate = DEFAULT_TEMPLATES.find((template) => template.value === selectedTemplate.value)

  if (defaultTemplate !== undefined) {
    payload.mode = defaultTemplate.mode
    if (defaultTemplate.quality) { payload.quality = defaultTemplate.quality }
    if (defaultTemplate.audioFormat) { payload.audioFormat = defaultTemplate.audioFormat }
  } else if (selectedCustomTemplate.value !== undefined) {
    payload.mode = 'custom'
    payload.customArgs = selectedCustomTemplate.value.args
  } else {
    payload.mode = 'custom'
    payload.customArgs = customArgs.value
  }

  const result = await window.ftElectron.ytDlpDownload(payload)

  if (result != null && 'id' in result) {
    downloadId.value = result.id
  } else if (result != null && 'error' in result) {
    // downloading the managed yt-dlp binary failed
    showToast(t('Downloads.Download Failed'))
  }
}

/** @type {import('vue').ComputedRef<import('../../../main/ytDlp').YtDlpDownloadStatus | null>} */
const activeDownload = computed(() => {
  if (downloadId.value === null) {
    return null
  }

  return store.getters.getYtDlpDownloads[downloadId.value] ?? {
    id: downloadId.value,
    status: 'downloading',
    percent: 0,
    speed: null,
    eta: null,
    errorMessage: null
  }
})

const downloadInProgress = computed(() => {
  return activeDownload.value !== null &&
    (activeDownload.value.status === 'downloading' || activeDownload.value.status === 'processing')
})

const statusLine = computed(() => {
  const download = activeDownload.value

  switch (download.status) {
    case 'downloading': {
      const parts = [`${download.percent.toFixed(1)}%`]
      if (download.speed) { parts.push(download.speed) }
      if (download.eta) { parts.push(`ETA ${download.eta}`) }
      return parts.join(' • ')
    }
    case 'processing':
      return t('Downloads.Processing')
    case 'completed':
      return t('Downloads.Download Complete')
    case 'cancelled':
      return t('Downloads.Download Cancelled')
    case 'failed':
      return download.errorMessage === 'ENOENT'
        ? t('Downloads.yt-dlp Not Found')
        : t('Downloads.Download Failed')
    default:
      return ''
  }
})

function cancelDownload() {
  if (downloadId.value !== null) {
    window.ftElectron.ytDlpCancelDownload(downloadId.value)
  }
}

function close() {
  emit('close')
}
</script>

<style scoped src="./WatchVideoDownloadPrompt.css" />
