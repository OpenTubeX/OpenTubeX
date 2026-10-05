<template>
  <div class="downloadsPage">
    <div
      v-if="downloads.length > 0 || enableDownloads"
      class="downloadsHeader"
    >
      <p v-if="downloads.length > 0">
        {{ t('Downloads.Total Size', { size: formattedTotalSize }) }}
      </p>
      <div class="downloadHeaderActions">
        <FtButton
          v-if="enableDownloads"
          :label="t('Downloads.Add Download')"
          :icon="['fas', 'plus']"
          @click="showUrlPrompt = true"
        />
        <FtButton
          v-if="pausableDownloads.length > 0"
          :label="t('Downloads.Pause All')"
          :icon="['fas', 'pause']"
          :text-color="null"
          :background-color="null"
          @click="queueAction('pause-all')"
        />
        <FtButton
          v-if="resumableDownloads.length > 0"
          :label="t('Downloads.Resume All')"
          :icon="['fas', 'play']"
          :text-color="null"
          :background-color="null"
          @click="queueAction('resume-all')"
        />
        <FtButton
          v-if="failedDownloads.length > 0"
          :label="t('Downloads.Retry All')"
          :icon="['fas', 'sync']"
          :text-color="null"
          :background-color="null"
          @click="queueAction('retry-all')"
        />
        <FtButton
          v-if="clearableDownloads.length > 0"
          :label="t('Downloads.Clear Failed Canceled Skipped And Missing')"
          :icon="['fas', 'trash']"
          :text-color="null"
          :background-color="null"
          @click="clearFailedAndMissing"
        />
      </div>
    </div>

    <section
      v-if="activeDownloads.length > 0"
      class="downloadSection"
    >
      <h2>{{ t('Downloads.Downloading') }}</h2>
      <DownloadRow
        v-for="download in activeDownloads"
        :key="download.id"
        :download="download"
        @pause="controlDownload(download.id, 'pause')"
        @resume="controlDownload(download.id, 'resume')"
      />
    </section>

    <section
      v-if="queuedDownloads.length > 0"
      class="downloadSection"
    >
      <h2>{{ t('Downloads.Queue') }}</h2>
      <DownloadRow
        v-for="(download, index) in queuedDownloads"
        :key="download.id"
        :download="download"
        :queue-position="index + 1"
        :can-move-earlier="index > 0"
        :can-move-later="index < queuedDownloads.length - 1"
        @move="controlDownload(download.id, 'move', $event)"
        @pause="controlDownload(download.id, 'pause')"
        @resume="controlDownload(download.id, 'resume')"
      />
    </section>

    <section
      v-if="finishedDownloads.length > 0"
      class="downloadSection"
    >
      <div class="downloadSectionHeading">
        <h2>{{ t('Downloads.Downloaded') }}</h2>
        <FtIconButton
          v-if="completedDownloads.length > 0"
          :title="t('Search Filters.Search Filters')"
          :icon="['fas', 'filter']"
          :aria-expanded="showDownloadFilters"
          theme="secondary"
          @click="showDownloadFilters = !showDownloadFilters"
        />
      </div>
      <div
        v-if="showDownloadFilters"
        class="downloadFilterPanel"
      >
        <FtInput
          class="downloadSearch"
          input-type="search"
          :placeholder="t('Search Bar.Search')"
          :icon="['fas', 'search']"
          :label="t('Downloads.Search Completed')"
          :show-label="true"
          :show-action-button="false"
          :value="downloadQuery"
          @input="downloadQuery = $event"
        />
        <div class="downloadFilters">
          <FtSelect
            :placeholder="t('Downloads.Format')"
            :value="formatFilter"
            :select-names="formatNames"
            :select-values="formatValues"
            @change="formatFilter = $event"
          />
          <FtSelect
            :placeholder="t('Search Filters.Time.Time')"
            :value="dateFilter"
            :select-names="dateNames"
            :select-values="dateValues"
            @change="dateFilter = $event"
          />
          <FtSelect
            :placeholder="t('Global.Sort By')"
            :value="sortOrder"
            :select-names="sortNames"
            :select-values="sortValues"
            @change="sortOrder = $event"
          />
        </div>
      </div>
      <p
        v-if="completedDownloads.length > 0 && visibleCompletedDownloads.length === 0"
        class="downloadNoResults"
        role="status"
      >
        {{ t('Downloads.No Matching Downloads') }}
      </p>
      <DownloadRow
        v-for="download in visibleFinishedDownloads"
        :key="download.id"
        :download="download"
        :retrying="retryingDownloadIds.includes(download.id)"
        @clear="clearDownload(download.id)"
        @open="openDownload(download.id)"
        @play="playDownload(download)"
        @queue="queueDownload(download)"
        @remove="pendingRemoval = download"
        @retry="retryDownload(download)"
      />
    </section>

    <section
      v-if="canceledDownloads.length > 0"
      class="downloadSection"
    >
      <h2>{{ t('Downloads.Canceled') }}</h2>
      <DownloadRow
        v-for="download in canceledDownloads"
        :key="download.id"
        :download="download"
        :retrying="retryingDownloadIds.includes(download.id)"
        @clear="clearDownload(download.id)"
        @retry="retryDownload(download)"
      />
    </section>

    <div
      v-if="downloads.length === 0"
      class="emptyDownloads"
    >
      <FtIcon :icon="['fas', 'download']" />
      <h2>{{ t('Downloads.No Downloads') }}</h2>
      <p>{{ t('Downloads.No Downloads Description') }}</p>
    </div>
    <FtPrompt
      v-if="showUrlPrompt && enableDownloads"
      autosize
      :label="t('Downloads.Add Download')"
      @click="showUrlPrompt = false"
    >
      <div class="addDownloadPrompt">
        <FtInput
          input-type="url"
          :icon="['fas', 'link']"
          :label="t('Form Inputs.Video URL')"
          :placeholder="t('Form Inputs.Paste Link')"
          :show-label="true"
          :show-action-button="false"
          :value="downloadUrl"
          :maxlength="8192"
          @input="downloadUrl = $event"
          @keydown.enter.prevent="openDownloadOptions"
        />
        <FtFlexBox>
          <FtButton
            :label="t('Video.Next')"
            :icon="['fas', 'arrow-right']"
            :disabled="!validDownloadUrl"
            @click="openDownloadOptions"
          />
          <FtButton
            :label="t('Cancel')"
            :icon="['fas', 'xmark']"
            :text-color="null"
            :background-color="null"
            @click="showUrlPrompt = false"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>
    <WatchVideoDownloadPrompt
      v-if="enableDownloads && selectedDownloadUrl"
      :key="selectedDownloadUrl"
      :external-url="selectedDownloadUrl"
      :title="selectedDownloadUrl"
      @close="selectedDownloadUrl = ''"
    />
    <FtPrompt
      v-if="pendingRemoval !== null"
      autosize
      :label="t('Downloads.Remove File Confirmation')"
      :extra-labels="[IS_CAPACITOR ? t('Downloads.Remove File Permanently Warning', { title: pendingRemoval.title }) : t('Downloads.Remove File Warning', { title: pendingRemoval.title })]"
      :option-names="[t('Downloads.Remove File'), t('Cancel')]"
      :option-values="['remove', 'cancel']"
      is-first-option-destructive
      @click="handleRemovePrompt"
    />
  </div>
</template>

<script setup>
import { ytDlp } from '../../helpers/ytDlp'
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DownloadRow from './DownloadRow.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import WatchVideoDownloadPrompt from '../../components/WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import { isYtDlpMediaUrl } from '../../../ytDlpArguments'
import store from '../../store/index'
import { formatBytes } from '../../helpers/fileSize'
import { downloadQueueVideos, downloadWatchRoute, isPlayableDownloadFile } from '../../helpers/downloadPlayback'
import { downloadFormats, filterCompletedDownloads } from '../../helpers/downloadFilters'
import { showToast } from '../../helpers/utils'

const { t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const router = useRouter()
const pendingRemoval = ref(null)
const showUrlPrompt = ref(false)
const downloadUrl = ref('')
const selectedDownloadUrl = ref('')
const enableDownloads = computed(() => store.getters.getEnableDownloads)
const validDownloadUrl = computed(() => isYtDlpMediaUrl(downloadUrl.value.trim()))
const retryingDownloadIds = ref([])
const showDownloadFilters = ref(false)
const downloadQuery = ref('')
const formatFilter = ref('')
const dateFilter = ref('')
const sortOrder = ref('date-desc')
const dateValues = ['', 'week', 'month', 'year']
const sortValues = ['date-desc', 'date-asc', 'size-desc', 'size-asc']
const downloads = computed(() => Object.values(store.getters.getYtDlpDownloads).sort((a, b) => b.id - a.id))
const activeDownloads = computed(() => downloads.value.filter(download => (
  ['preparing', 'downloading', 'processing', 'pausing'].includes(download.status) ||
  (download.status === 'paused' && download.started === true)
)))
const queuedDownloads = computed(() => downloads.value
  .filter(download => download.status === 'queued' || (download.status === 'paused' && download.started !== true))
  .sort((a, b) => (a.queuePosition ?? a.id) - (b.queuePosition ?? b.id)))
const canceledDownloads = computed(() => downloads.value.filter(download => download.status === 'cancelled'))
const finishedDownloads = computed(() => downloads.value.filter(download => (
  !['queued', 'preparing', 'downloading', 'processing', 'pausing', 'paused', 'cancelled'].includes(download.status)
)))
const completedDownloads = computed(() => finishedDownloads.value.filter(download => download.status === 'completed'))
const otherFinishedDownloads = computed(() => finishedDownloads.value.filter(download => download.status !== 'completed'))
const formatValues = computed(() => ['', ...new Set(completedDownloads.value.flatMap(downloadFormats))].sort((a, b) => a.localeCompare(b)))
const formatNames = computed(() => formatValues.value.map(format => format === '' ? t('Downloads.All Formats') : format.toUpperCase()))
const dateNames = computed(() => [t('Search Filters.Time.Any Time'), t('Search Filters.Time.This Week'), t('Search Filters.Time.This Month'), t('Search Filters.Time.This Year')])
const sortNames = computed(() => [t('Subscriptions.Newest First'), t('Subscriptions.Oldest First'), t('Downloads.Largest First'), t('Downloads.Smallest First')])
const visibleCompletedDownloads = computed(() => filterCompletedDownloads(completedDownloads.value, {
  query: downloadQuery.value,
  format: formatFilter.value,
  period: dateFilter.value,
  sort: sortOrder.value
}))
const visibleFinishedDownloads = computed(() => [...visibleCompletedDownloads.value, ...otherFinishedDownloads.value])
watch(() => completedDownloads.value.length, count => {
  if (count === 0) {
    showDownloadFilters.value = false
    downloadQuery.value = ''
    formatFilter.value = ''
    dateFilter.value = ''
    sortOrder.value = 'date-desc'
  }
})
const pausableDownloads = computed(() => downloads.value.filter(download => ['queued', 'preparing', 'downloading', 'processing'].includes(download.status)))
const resumableDownloads = computed(() => downloads.value.filter(download => ['paused', 'pausing'].includes(download.status)))
const failedDownloads = computed(() => finishedDownloads.value.filter(download => download.status === 'failed'))
const clearableDownloads = computed(() => downloads.value.filter(download => (
  ['failed', 'cancelled', 'skipped'].includes(download.status) ||
  (download.status === 'completed' && download.availability === 'missing')
)))
const totalSizeBytes = computed(() => downloads.value.reduce((total, download) => total + (download.sizeBytes ?? 0), 0))
const formattedTotalSize = computed(() => formatBytes(totalSizeBytes.value))

function openDownloadOptions() {
  if (!validDownloadUrl.value) return
  selectedDownloadUrl.value = downloadUrl.value.trim()
  showUrlPrompt.value = false
  downloadUrl.value = ''
}

watch(enableDownloads, enabled => {
  if (!enabled) {
    showUrlPrompt.value = false
    selectedDownloadUrl.value = ''
  }
})

async function refreshDownloads() {
  const records = await ytDlp.ytDlpListDownloads()
  for (const download of records) store.commit('upsertYtDlpDownload', download)
  return records
}

onMounted(() => {
  refreshDownloads().catch(error => console.warn('Could not refresh download history', error))
})

watch(
  () => downloads.value
    .filter(download => download.status === 'completed' && download.sizeBytes === undefined)
    .map(download => download.id)
    .join(','),
  ids => {
    if (ids !== '') refreshDownloads().catch(error => console.warn('Could not refresh download sizes', error))
  }
)

async function clearDownload(id) {
  await ytDlp.ytDlpClearDownloads([id])
  store.commit('removeYtDlpDownload', id)
}
async function clearFailedAndMissing() {
  const ids = clearableDownloads.value.map(download => download.id)
  await ytDlp.ytDlpClearDownloads(ids)
  ids.forEach(id => store.commit('removeYtDlpDownload', id))
}
async function controlDownload(id, action, value) {
  await ytDlp.ytDlpControlDownload(id, action, value)
}
async function queueAction(action) {
  await ytDlp.ytDlpQueueAction(action)
  await refreshDownloads()
}
async function openDownload(id) {
  if (!await ytDlp.ytDlpOpenDownload(id)) {
    await refreshDownloads()
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
  }
}
async function queueDownload(download) {
  const refreshedDownload = (await refreshDownloads()).find(record => record.id === download.id)
  const videos = refreshedDownload ? downloadQueueVideos(refreshedDownload) : []
  if (videos.length === 0) {
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  for (const video of videos) store.commit('addVideoToWatchQueue', { video })
  showToast({ message: t('Video.Added to Queue'), icon: ['fas', 'list'] })
}
async function playDownload(download) {
  const refreshedDownload = (await refreshDownloads()).find(record => record.id === download.id)
  const firstFile = refreshedDownload?.files?.find(file => file.available && isPlayableDownloadFile(file))
  if (!firstFile) {
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (process.env.IS_IOS) {
    if (!await ytDlp.ytDlpPlayDownload(download.id, firstFile.path).catch(() => false)) {
      showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
    }
    return
  }

  store.dispatch('hideSettingsWindow')
  router.push(downloadWatchRoute(refreshedDownload, firstFile.videoId))
}
async function retryDownload(download) {
  if (retryingDownloadIds.value.includes(download.id)) return
  retryingDownloadIds.value = [...retryingDownloadIds.value, download.id]

  // Download records in the store are Vue proxies, which Electron IPC cannot
  // clone. Retry payloads are JSON-compatible by definition, so detach them
  // before sending them back to the main process.
  const retryPayload = download.retryPayload
    ? JSON.parse(JSON.stringify(download.retryPayload))
    : {
        videoId: download.videoId,
        playlistId: download.playlistId,
        isPlaylist: Boolean(download.playlistId),
        title: download.title,
        thumbnail: download.thumbnail,
        mode: download.mode,
        template: download.template
      }
  let result
  try {
    result = await ytDlp.ytDlpDownload(retryPayload, download.id)
  } catch (error) {
    console.error('Could not retry download', error)
  } finally {
    retryingDownloadIds.value = retryingDownloadIds.value.filter(id => id !== download.id)
  }
  if (result == null || !('id' in result)) {
    showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  if (result.id !== download.id) await clearDownload(download.id)
}
async function removeDownload(id) {
  if (await ytDlp.ytDlpRemoveDownload(id)) {
    store.commit('removeYtDlpDownload', id)
  } else {
    await refreshDownloads()
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
  }
}
async function handleRemovePrompt(option) {
  const download = pendingRemoval.value
  pendingRemoval.value = null
  if (option === 'remove' && download !== null) await removeDownload(download.id)
}
</script>

<style scoped src="./Downloads.css" />
