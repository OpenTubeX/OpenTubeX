<template>
  <FtSettingsSection
    :title="t('Settings.Download Settings.Download Settings')"
  >
    <FtFlexBox>
      <FtSelect
        class="sourceSelect"
        :placeholder="t('Settings.Download Settings.yt-dlp Source')"
        :value="ytDlpSource"
        :select-names="sourceNames"
        :select-values="SOURCE_VALUES"
        :tooltip="t('Tooltips.Download Settings.yt-dlp Source')"
        :icon="['fas', 'download']"
        @change="updateYtDlpSource"
      />
      <FtSelect
        class="sourceSelect"
        :placeholder="t('Settings.Download Settings.FFmpeg Source')"
        :value="ytDlpFfmpegSource"
        :select-names="sourceNames"
        :select-values="SOURCE_VALUES"
        :tooltip="t('Tooltips.Download Settings.FFmpeg Source')"
        :icon="['fas', 'file-video']"
        @change="updateYtDlpFfmpegSource"
      />
    </FtFlexBox>
    <FtFlexBox>
      <p
        v-if="ytDlpInfo === null"
        class="ytDlpStatus"
      >
        {{ t('Settings.Download Settings.Checking yt-dlp') }}
      </p>
      <p
        v-else-if="!ytDlpInfo.available"
        class="ytDlpStatus ytDlpWarning"
      >
        <FontAwesomeIcon :icon="['fas', 'circle-exclamation']" />
        {{ ytDlpSource === 'managed'
          ? t('Settings.Download Settings.Managed Not Downloaded')
          : t('Settings.Download Settings.System yt-dlp Missing Warning') }}
      </p>
      <p
        v-else
        class="ytDlpStatus"
      >
        {{ t('Settings.Download Settings.Detected Version Template', { version: ytDlpInfo.version }) }}
      </p>
    </FtFlexBox>
    <FtFlexBox>
      <p
        v-if="ffmpegInfo === null"
        class="ytDlpStatus"
      >
        {{ t('Settings.Download Settings.Checking FFmpeg') }}
      </p>
      <p
        v-else-if="!ffmpegInfo.available"
        class="ytDlpStatus ytDlpWarning"
      >
        <FontAwesomeIcon :icon="['fas', 'circle-exclamation']" />
        {{ ytDlpFfmpegSource === 'managed'
          ? t('Settings.Download Settings.FFmpeg Managed Not Downloaded')
          : t('Settings.Download Settings.System FFmpeg Missing Warning') }}
      </p>
      <p
        v-else
        class="ytDlpStatus"
      >
        {{ t('Settings.Download Settings.Detected FFmpeg Version Template', { version: ffmpegInfo.version }) }}
      </p>
    </FtFlexBox>
    <FtFlexBox v-if="ytDlpSource === 'managed' || ytDlpFfmpegSource === 'managed'">
      <FtButton
        v-if="ytDlpSource === 'managed'"
        :label="ytDlpBinaryDownloadInProgress
          ? t('Settings.Download Settings.Downloading yt-dlp')
          : (ytDlpInfo === null
            ? t('Settings.Download Settings.Checking yt-dlp')
            : ytDlpInfo.available
              ? t('Settings.Download Settings.Update yt-dlp')
              : t('Settings.Download Settings.Download yt-dlp'))"
        :icon="['fas', 'download']"
        :disabled="ytDlpBinaryDownloadInProgress || ytDlpInfo === null"
        :text-color="null"
        :background-color="null"
        @click="downloadBinary('yt-dlp')"
      />
      <FtButton
        v-if="ytDlpFfmpegSource === 'managed'"
        :label="ffmpegBinaryDownloadInProgress
          ? t('Settings.Download Settings.Downloading FFmpeg')
          : (ffmpegInfo === null
            ? t('Settings.Download Settings.Checking FFmpeg')
            : ffmpegInfo.available
              ? t('Settings.Download Settings.Update FFmpeg')
              : t('Settings.Download Settings.Download FFmpeg'))"
        :icon="['fas', 'download']"
        :disabled="ffmpegBinaryDownloadInProgress || ffmpegInfo === null"
        :text-color="null"
        :background-color="null"
        @click="downloadBinary('ffmpeg')"
      />
    </FtFlexBox>
    <!-- extra wrapper, as the section adds inline padding to direct div children,
      which would offset the fill inside the track -->
    <div v-if="binaryDownloadProgress !== null">
      <div class="binaryProgressBarTrack">
        <div
          class="binaryProgressBarFill"
          :class="{ indeterminate: binaryDownloadProgress.percent === null }"
          :style="{ inlineSize: `${binaryDownloadProgress.percent ?? 100}%` }"
        />
      </div>
    </div>
    <FtFlexBox class="settingsFlexStart460px">
      <FtInput
        v-if="ytDlpSource === 'system'"
        :placeholder="t('Settings.Download Settings.yt-dlp Executable Path')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpPath"
        :tooltip="t('Tooltips.Download Settings.yt-dlp Executable Path')"
        @input="updateYtDlpPath"
        @click="chooseExecutablePath('yt-dlp')"
      />
      <FtInput
        v-if="ytDlpFfmpegSource === 'system'"
        :placeholder="t('Settings.Download Settings.FFmpeg Executable Path')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpFfmpegPath"
        :tooltip="t('Tooltips.Download Settings.FFmpeg Executable Path')"
        @input="updateYtDlpFfmpegPath"
        @click="chooseExecutablePath('ffmpeg')"
      />
      <FtInput
        :placeholder="t('Settings.Download Settings.Download Folder')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpDownloadFolderPath"
        :tooltip="t('Tooltips.Download Settings.Download Folder')"
        @input="updateYtDlpDownloadFolderPath"
        @click="chooseDownloadFolder"
      />
    </FtFlexBox>
    <FtFlexBox>
      <p class="templatesHint">
        {{ t('Settings.Download Settings.Templates Hint') }}
      </p>
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtButton from './FtButton/FtButton.vue'
import FtInput from './FtInput/FtInput.vue'
import FtSelect from './FtSelect/FtSelect.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'

import store from '../store/index'

import { showToast } from '../helpers/utils'

const { t } = useI18n()

const SOURCE_VALUES = ['system', 'managed']

const sourceNames = computed(() => [
  t('Settings.Download Settings.Sources.System'),
  t('Settings.Download Settings.Sources.Managed')
])

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const ytDlpSource = computed(() => store.getters.getYtDlpSource)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPath = computed(() => store.getters.getYtDlpPath)

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const ytDlpFfmpegSource = computed(() => store.getters.getYtDlpFfmpegSource)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpFfmpegPath = computed(() => store.getters.getYtDlpFfmpegPath)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpDownloadFolderPath = computed(() => store.getters.getYtDlpDownloadFolderPath)

/** @typedef {import('../../main/ytDlp').YtDlpBinaryInfo} BinaryInfo */

/**
 * @type {import('vue').Ref<Record<'ytDlp' | 'ffmpeg', {
 *   managed: BinaryInfo | null,
 *   system: { path: string, info: BinaryInfo } | null
 * }>>}
 */
const binariesInfoCache = ref({
  ytDlp: { managed: null, system: null },
  ffmpeg: { managed: null, system: null }
})

/** @type {import('vue').ComputedRef<BinaryInfo | null>} */
const ytDlpInfo = computed(() => ytDlpSource.value === 'managed'
  ? binariesInfoCache.value.ytDlp.managed
  : binariesInfoCache.value.ytDlp.system?.path === ytDlpPath.value
    ? binariesInfoCache.value.ytDlp.system.info
    : null)

/** @type {import('vue').ComputedRef<BinaryInfo | null>} */
const ffmpegInfo = computed(() => ytDlpFfmpegSource.value === 'managed'
  ? binariesInfoCache.value.ffmpeg.managed
  : binariesInfoCache.value.ffmpeg.system?.path === ytDlpFfmpegPath.value
    ? binariesInfoCache.value.ffmpeg.system.info
    : null)

const ytDlpBinaryDownloadInProgress = ref(false)
const ffmpegBinaryDownloadInProgress = ref(false)

/** @type {import('vue').Ref<{ binary: 'yt-dlp' | 'ffmpeg', percent: number | null } | null>} */
const binaryDownloadProgress = ref(null)

let systemInfoRequestId = 0
let managedInfoRequestId = 0
let refreshTimeout = null

async function refreshSystemBinariesInfo() {
  const requestId = ++systemInfoRequestId
  const ytDlpSystemPath = ytDlpPath.value
  const ffmpegSystemPath = ytDlpFfmpegPath.value

  const info = await window.ftElectron.ytDlpGetInfo({
    ytDlpSource: 'system',
    ytDlpPath: ytDlpSystemPath,
    ffmpegSource: 'system',
    ffmpegPath: ffmpegSystemPath
  })

  if (requestId === systemInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.system = { path: ytDlpSystemPath, info: info.ytDlp }
    binariesInfoCache.value.ffmpeg.system = { path: ffmpegSystemPath, info: info.ffmpeg }
  }
}

async function refreshManagedBinariesInfo() {
  const requestId = ++managedInfoRequestId
  const info = await window.ftElectron.ytDlpGetInfo({
    ytDlpSource: 'managed',
    ytDlpPath: '',
    ffmpegSource: 'managed',
    ffmpegPath: ''
  })

  if (requestId === managedInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.managed = info.ytDlp
    binariesInfoCache.value.ffmpeg.managed = info.ffmpeg
  }
}

async function refreshBinariesInfo() {
  await Promise.all([refreshSystemBinariesInfo(), refreshManagedBinariesInfo()])
}

onMounted(() => {
  refreshBinariesInfo()

  window.ftElectron.setYtDlpBinaryDownloadProgressListener((progress) => {
    binaryDownloadProgress.value = progress
  })
})

onBeforeUnmount(() => {
  clearTimeout(refreshTimeout)
  systemInfoRequestId++
  managedInfoRequestId++
  window.ftElectron.setYtDlpBinaryDownloadProgressListener(null)
})

// Re-check path-dependent system binaries after edits. Source switches use
// the already cached status for that source and therefore do not flicker.
watch([ytDlpPath, ytDlpFfmpegPath], () => {
  clearTimeout(refreshTimeout)
  systemInfoRequestId++
  refreshTimeout = setTimeout(refreshSystemBinariesInfo, 500)
})

/**
 * @param {'system' | 'managed'} value
 */
function updateYtDlpSource(value) {
  store.dispatch('updateYtDlpSource', value)
}

/**
 * @param {string} value
 */
function updateYtDlpPath(value) {
  store.dispatch('updateYtDlpPath', value)
}

/**
 * @param {'system' | 'managed'} value
 */
function updateYtDlpFfmpegSource(value) {
  store.dispatch('updateYtDlpFfmpegSource', value)
}

/**
 * @param {string} value
 */
function updateYtDlpFfmpegPath(value) {
  store.dispatch('updateYtDlpFfmpegPath', value)
}

/**
 * @param {string} value
 */
function updateYtDlpDownloadFolderPath(value) {
  store.dispatch('updateYtDlpDownloadFolderPath', value)
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binary
 */
async function downloadBinary(binary) {
  const inProgress = binary === 'yt-dlp' ? ytDlpBinaryDownloadInProgress : ffmpegBinaryDownloadInProgress
  inProgress.value = true

  try {
    const result = await window.ftElectron.ytDlpDownloadBinary(binary)

    if (result != null && 'version' in result) {
      showToast(binary === 'yt-dlp'
        ? t('Settings.Download Settings.yt-dlp Downloaded Template', { version: result.version })
        : t('Settings.Download Settings.FFmpeg Downloaded Template', { version: result.version }))
    } else {
      const error = result?.error ?? ''
      showToast(binary === 'yt-dlp'
        ? t('Settings.Download Settings.yt-dlp Download Error Template', { error })
        : t('Settings.Download Settings.FFmpeg Download Error Template', { error }))
    }
  } finally {
    binaryDownloadProgress.value = null
    try {
      await refreshManagedBinariesInfo()
    } finally {
      inProgress.value = false
    }
  }
}

async function chooseDownloadFolder() {
  const path = await window.ftElectron.ytDlpChooseDownloadFolder(ytDlpDownloadFolderPath.value)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch('updateYtDlpDownloadFolderPath', path)
  }
}

/**
 * @param {'yt-dlp' | 'ffmpeg'} binary
 */
async function chooseExecutablePath(binary) {
  const currentPath = binary === 'yt-dlp' ? ytDlpPath.value : ytDlpFfmpegPath.value
  const path = await window.ftElectron.ytDlpChooseExecutable(currentPath)

  if (typeof path === 'string' && path.length > 0) {
    store.dispatch(binary === 'yt-dlp' ? 'updateYtDlpPath' : 'updateYtDlpFfmpegPath', path)
  }
}
</script>

<style scoped>
.sourceSelect {
  inline-size: 250px;
}

.ytDlpStatus {
  margin-block: 0;
}

.ytDlpWarning {
  color: var(--destructive-color);
  font-weight: bold;
}

.binaryProgressBarTrack {
  background-color: #9e9e9e;
  block-size: 8px;
  border-radius: 4px;
  margin-block: 10px;
  margin-inline: auto;
  max-inline-size: 500px;
  overflow: hidden;
}

.binaryProgressBarFill {
  background-color: var(--accent-color);
  block-size: 100%;
  border-radius: 4px;
  transition: inline-size 0.3s ease;
}

.binaryProgressBarFill.indeterminate {
  animation: binary-progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes binary-progress-indeterminate {
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 1;
  }
}

@media only screen and (width <= 800px) {
  .sourceSelect {
    inline-size: calc(100% - 28px);
  }
}
</style>
