<template>
  <FtSettingsSection
    :title="t('Settings.External Software Settings.External Software Settings')"
  >
    <FtFlexBox>
      <FtSelect
        v-if="ytDlpSource === 'managed'"
        class="sourceSelect"
        :placeholder="t('Settings.External Software Settings.yt-dlp Channel')"
        :value="ytDlpChannel"
        :select-names="CHANNEL_NAMES"
        :select-values="CHANNEL_VALUES"
        :tooltip="t('Tooltips.External Software Settings.yt-dlp Channel')"
        :icon="['fas', 'download']"
        @change="updateYtDlpChannel"
      />
      <FtSelect
        class="sourceSelect"
        :placeholder="t('Settings.External Software Settings.yt-dlp Source')"
        :value="ytDlpSource"
        :select-names="sourceNames"
        :select-values="SOURCE_VALUES"
        :tooltip="t('Tooltips.External Software Settings.yt-dlp Source')"
        :icon="['fas', 'download']"
        @change="updateYtDlpSource"
      />
      <FtSelect
        class="sourceSelect"
        :placeholder="t('Settings.External Software Settings.FFmpeg Source')"
        :value="ytDlpFfmpegSource"
        :select-names="sourceNames"
        :select-values="SOURCE_VALUES"
        :tooltip="t('Tooltips.External Software Settings.FFmpeg Source')"
        :icon="['fas', 'file-video']"
        @change="updateYtDlpFfmpegSource"
      />
    </FtFlexBox>
    <FtFlexBox class="binaryStatusStart">
      <p
        v-if="ytDlpInfo === null"
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Checking yt-dlp') }}
      </p>
      <p
        v-else-if="!ytDlpInfo.available"
        class="ytDlpStatus ytDlpWarning"
      >
        <FtIcon :icon="['fas', 'circle-exclamation']" />
        {{ ytDlpSource === 'managed'
          ? t('Settings.External Software Settings.Managed Not Downloaded')
          : t('Settings.External Software Settings.System yt-dlp Missing Warning') }}
      </p>
      <p
        v-else
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Detected Version Template', { version: ytDlpInfo.version }) }}
      </p>
    </FtFlexBox>
    <FtFlexBox>
      <p
        v-if="ffmpegInfo === null"
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Checking FFmpeg') }}
      </p>
      <p
        v-else-if="!ffmpegInfo.available"
        class="ytDlpStatus ytDlpWarning"
      >
        <FtIcon :icon="['fas', 'circle-exclamation']" />
        {{ ytDlpFfmpegSource === 'managed'
          ? t('Settings.External Software Settings.FFmpeg Managed Not Downloaded')
          : t('Settings.External Software Settings.System FFmpeg Missing Warning') }}
      </p>
      <p
        v-else
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Detected FFmpeg Version Template', { version: ffmpegInfo.version }) }}
      </p>
    </FtFlexBox>
    <FtFlexBox class="binaryStatusEnd">
      <p
        v-if="ffprobeInfo === null"
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Checking FFprobe') }}
      </p>
      <p
        v-else-if="!ffprobeInfo.available"
        class="ytDlpStatus ytDlpWarning"
      >
        <FtIcon :icon="['fas', 'circle-exclamation']" />
        {{ ytDlpFfmpegSource === 'managed'
          ? t('Settings.External Software Settings.FFprobe Managed Not Downloaded')
          : t('Settings.External Software Settings.System FFprobe Missing Warning') }}
      </p>
      <p
        v-else
        class="ytDlpStatus"
      >
        {{ t('Settings.External Software Settings.Detected FFprobe Version Template', { version: ffprobeInfo.version }) }}
      </p>
    </FtFlexBox>
    <FtFlexBox v-if="ytDlpSource === 'managed' || ytDlpFfmpegSource === 'managed'">
      <FtButton
        v-if="ytDlpSource === 'managed'"
        :label="ytDlpBinaryDownloadInProgress
          ? t('Settings.External Software Settings.Downloading yt-dlp')
          : (ytDlpInfo === null
            ? t('Settings.External Software Settings.Checking yt-dlp')
            : ytDlpInfo.available
              ? t('Settings.External Software Settings.Update yt-dlp')
              : t('Settings.External Software Settings.Download yt-dlp'))"
        :icon="['fas', 'download']"
        :disabled="ytDlpBinaryDownloadInProgress || ytDlpInfo === null"
        :text-color="null"
        :background-color="null"
        @click="downloadBinary('yt-dlp')"
      />
      <FtButton
        v-if="ytDlpFfmpegSource === 'managed'"
        :label="ffmpegBinaryDownloadInProgress
          ? t('Settings.External Software Settings.Downloading FFmpeg and FFprobe')
          : (ffmpegInfo === null
            ? t('Settings.External Software Settings.Checking FFmpeg')
            : ffmpegToolsAvailable
              ? t('Settings.External Software Settings.Update FFmpeg and FFprobe')
              : t('Settings.External Software Settings.Download FFmpeg and FFprobe'))"
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
    <FtFlexBox
      v-if="ytDlpSource === 'system' || ytDlpFfmpegSource === 'system'"
      class="executablePathInputs settingsFlexStart460px"
    >
      <FtInput
        v-if="ytDlpSource === 'system'"
        :placeholder="t('Settings.External Software Settings.yt-dlp Executable Path')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpPath"
        :tooltip="t('Tooltips.External Software Settings.yt-dlp Executable Path')"
        @input="updateYtDlpPath"
        @click="chooseExecutablePath('yt-dlp')"
      />
      <FtInput
        v-if="ytDlpFfmpegSource === 'system'"
        :placeholder="t('Settings.External Software Settings.FFmpeg Executable Path')"
        :show-action-button="true"
        :allow-action-button-when-empty="true"
        :force-action-button-icon-name="['fas', 'folder-open']"
        :show-label="true"
        :value="ytDlpFfmpegPath"
        :tooltip="t('Tooltips.External Software Settings.FFmpeg Executable Path')"
        @input="updateYtDlpFfmpegPath"
        @click="chooseExecutablePath('ffmpeg')"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
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
const CHANNEL_NAMES = ['Stable', 'Nightly', 'Master']
const CHANNEL_VALUES = ['stable', 'nightly', 'master']

const sourceNames = computed(() => [
  t('Settings.External Software Settings.Sources.System'),
  t('Settings.External Software Settings.Sources.Managed')
])

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const ytDlpSource = computed(() => store.getters.getYtDlpSource)

/** @type {import('vue').ComputedRef<'stable' | 'nightly' | 'master'>} */
const ytDlpChannel = computed(() => store.getters.getYtDlpChannel)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpPath = computed(() => store.getters.getYtDlpPath)

/** @type {import('vue').ComputedRef<'system' | 'managed'>} */
const ytDlpFfmpegSource = computed(() => store.getters.getYtDlpFfmpegSource)

/** @type {import('vue').ComputedRef<string>} */
const ytDlpFfmpegPath = computed(() => store.getters.getYtDlpFfmpegPath)

/** @typedef {import('../../main/ytDlp').YtDlpBinaryInfo} BinaryInfo */

/**
 * @type {import('vue').Ref<Record<'ytDlp' | 'ffmpeg' | 'ffprobe', {
 *   managed: BinaryInfo | null,
 *   system: { path: string, info: BinaryInfo } | null
 * }>>}
 */
const binariesInfoCache = ref({
  ytDlp: { managed: null, system: null },
  ffmpeg: { managed: null, system: null },
  ffprobe: { managed: null, system: null }
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

/** @type {import('vue').ComputedRef<BinaryInfo | null>} */
const ffprobeInfo = computed(() => ytDlpFfmpegSource.value === 'managed'
  ? binariesInfoCache.value.ffprobe.managed
  : binariesInfoCache.value.ffprobe.system?.path === ytDlpFfmpegPath.value
    ? binariesInfoCache.value.ffprobe.system.info
    : null)

const ffmpegToolsAvailable = computed(() => ffmpegInfo.value?.available === true && ffprobeInfo.value?.available === true)

const ytDlpBinaryDownloadInProgress = ref(false)
const ffmpegBinaryDownloadInProgress = ref(false)

/** @type {import('vue').Ref<{ binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean } | null>} */
const binaryDownloadProgress = ref(null)
const activeBinaryDownloads = new Set()
const binaryDownloadPercentages = new Map()

let systemInfoRequestId = 0
let managedInfoRequestId = 0
let refreshTimeout = null

/**
 * A failed check has to be reported as "not available" rather than left pending,
 * otherwise the status stays at "Checking…" and the download buttons stay disabled.
 * @param {Parameters<typeof window.ftElectron.ytDlpGetInfo>[0]} options
 */
async function getBinariesInfo(options) {
  try {
    return await window.ftElectron.ytDlpGetInfo(options)
  } catch (error) {
    console.error('Checking the yt-dlp, FFmpeg, and FFprobe binaries failed', error)

    /** @type {import('../../main/ytDlp').YtDlpBinaryInfo} */
    const unavailable = { source: options.ytDlpSource, available: false, version: null }

    const unavailableFfmpegTool = { ...unavailable, source: options.ffmpegSource }
    return { ytDlp: unavailable, ffmpeg: unavailableFfmpegTool, ffprobe: unavailableFfmpegTool }
  }
}

async function refreshSystemBinariesInfo() {
  const requestId = ++systemInfoRequestId
  const ytDlpSystemPath = ytDlpPath.value
  const ffmpegSystemPath = ytDlpFfmpegPath.value

  const info = await getBinariesInfo({
    ytDlpSource: 'system',
    ytDlpPath: ytDlpSystemPath,
    ffmpegSource: 'system',
    ffmpegPath: ffmpegSystemPath
  })

  if (requestId === systemInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.system = { path: ytDlpSystemPath, info: info.ytDlp }
    binariesInfoCache.value.ffmpeg.system = { path: ffmpegSystemPath, info: info.ffmpeg }
    binariesInfoCache.value.ffprobe.system = { path: ffmpegSystemPath, info: info.ffprobe }
  }
}

async function refreshManagedBinariesInfo() {
  const requestId = ++managedInfoRequestId

  // Stale "not downloaded" must not stick around while we re-probe after a
  // download — null means the UI shows "Checking…".
  if (binariesInfoCache.value.ytDlp.managed?.available === false) {
    binariesInfoCache.value.ytDlp.managed = null
  }
  if (binariesInfoCache.value.ffmpeg.managed?.available === false) {
    binariesInfoCache.value.ffmpeg.managed = null
  }
  if (binariesInfoCache.value.ffprobe.managed?.available === false) {
    binariesInfoCache.value.ffprobe.managed = null
  }

  const info = await getBinariesInfo({
    ytDlpSource: 'managed',
    ytDlpPath: '',
    ffmpegSource: 'managed',
    ffmpegPath: ''
  })

  if (requestId === managedInfoRequestId && info !== null) {
    binariesInfoCache.value.ytDlp.managed = info.ytDlp
    binariesInfoCache.value.ffmpeg.managed = info.ffmpeg
    binariesInfoCache.value.ffprobe.managed = info.ffprobe
  }
}

async function refreshBinariesInfo() {
  await Promise.all([refreshSystemBinariesInfo(), refreshManagedBinariesInfo()])
}

/**
 * Keeps the combined progress for concurrent downloads monotonic.
 * @param {{ binary: 'yt-dlp' | 'ffmpeg', percent: number | null, inProgress: boolean }} progress
 */
function updateBinaryDownloadProgress(progress) {
  if (progress.percent !== null) {
    const previousBinaryPercentage = binaryDownloadPercentages.get(progress.binary) ?? 0
    binaryDownloadPercentages.set(progress.binary, Math.max(previousBinaryPercentage, progress.percent))
  } else if (!binaryDownloadPercentages.has(progress.binary)) {
    // the download reported no percentage, because its total size is unknown
    binaryDownloadPercentages.set(progress.binary, null)
  }

  const percentages = [...binaryDownloadPercentages.values()]
  const knownPercentages = percentages.filter(percent => percent !== null)

  // Without a single known percentage there is nothing to fill the bar with,
  // so it falls back to showing that something is happening at all
  if (knownPercentages.length === 0) {
    binaryDownloadProgress.value = { ...progress, percent: null }
    return
  }

  const combinedPercentage = knownPercentages.reduce((sum, percent) => sum + percent, 0) / percentages.length
  const displayedPercentage = binaryDownloadProgress.value?.percent ?? 0
  binaryDownloadProgress.value = {
    ...progress,
    percent: Math.max(displayedPercentage, combinedPercentage)
  }
}

onMounted(() => {
  refreshBinariesInfo()

  window.ftElectron.setYtDlpBinaryDownloadProgressListener((progress) => {
    const inProgress = progress.binary === 'yt-dlp'
      ? ytDlpBinaryDownloadInProgress
      : ffmpegBinaryDownloadInProgress
    inProgress.value = progress.inProgress

    if (progress.inProgress) {
      activeBinaryDownloads.add(progress.binary)
      updateBinaryDownloadProgress(progress)
    } else {
      if (activeBinaryDownloads.has(progress.binary)) {
        updateBinaryDownloadProgress(progress)
      }
      activeBinaryDownloads.delete(progress.binary)
      if (activeBinaryDownloads.size === 0) {
        binaryDownloadProgress.value = null
        binaryDownloadPercentages.clear()
      }
      refreshManagedBinariesInfo()
    }
  })
})

onBeforeUnmount(() => {
  clearTimeout(refreshTimeout)
  systemInfoRequestId++
  managedInfoRequestId++
  activeBinaryDownloads.clear()
  binaryDownloadPercentages.clear()
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
 * @param {'stable' | 'nightly' | 'master'} value
 */
function updateYtDlpChannel(value) {
  store.dispatch('updateYtDlpChannel', value)
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
 * @param {'yt-dlp' | 'ffmpeg'} binary
 * @param {string} error
 */
function showDownloadErrorToast(binary, error) {
  showToast({
    message: binary === 'yt-dlp'
      ? t('Settings.External Software Settings.yt-dlp Download Error Template', { error })
      : t('Settings.External Software Settings.FFmpeg and FFprobe Download Error Template', { error }),
    icon: ['fas', 'circle-exclamation'],
  })
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
      const key = binary === 'yt-dlp' ? 'ytDlp' : 'ffmpeg'
      binariesInfoCache.value[key].managed = { source: 'managed', available: true, version: result.version }

      if (result.updated) {
        showToast({
          message: binary === 'yt-dlp'
            ? t('Settings.External Software Settings.yt-dlp Downloaded Template', { version: result.version })
            : t('Settings.External Software Settings.FFmpeg and FFprobe Downloaded Template', { version: result.version }),
          icon: ['fas', 'download'],
        })
      } else {
        const tool = binary === 'yt-dlp' ? 'yt-dlp' : 'FFmpeg and FFprobe'
        showToast({
          message: t('Settings.External Software Settings.Managed Tool Already Current Template', {
            tool,
            version: result.version
          }),
          icon: ['fas', 'check'],
        })
      }
    } else {
      showDownloadErrorToast(binary, result?.error ?? '')
    }
  } catch (error) {
    // without this the button would just go back to its previous label,
    // leaving the failure unexplained
    showDownloadErrorToast(binary, error.message)
  } finally {
    if (activeBinaryDownloads.size === 0) {
      binaryDownloadProgress.value = null
      binaryDownloadPercentages.clear()
    }
    try {
      await refreshManagedBinariesInfo()
    } finally {
      inProgress.value = false
    }
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

.executablePathInputs {
  column-gap: 12px;
}

.executablePathInputs :deep(.ft-input-component) {
  inline-size: 340px;
  max-inline-size: 100%;
}

.binaryStatusStart {
  margin-block-start: 8px;
}

.binaryStatusEnd {
  margin-block-end: 8px;
}

.ytDlpStatus {
  margin-block: 0;
}

.ytDlpWarning {
  color: var(--destructive-color);
  font-weight: bold;
  inline-size: 100%;
  padding-block: 8px;
  text-align: center;
}

.binaryProgressBarTrack {
  background-color: #9e9e9e;
  block-size: 8px;
  border-radius: calc(4px * var(--ui-roundness));
  margin-block: 10px;
  margin-inline: auto;
  max-inline-size: 500px;
  overflow: hidden;
}

.binaryProgressBarFill {
  background-color: var(--accent-color);
  block-size: 100%;
  border-radius: calc(4px * var(--ui-roundness));
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
