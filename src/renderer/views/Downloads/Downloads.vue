<template>
  <div class="downloadsPage">
    <div
      v-if="downloads.length > 0"
      class="downloadsHeader"
    >
      <p>
        {{ t('Downloads.Total Size', { size: formattedTotalSize }) }}
      </p>
      <FtButton
        v-if="clearableDownloads.length > 0"
        :label="t('Downloads.Clear Failed Canceled Skipped And Missing')"
        :icon="['fas', 'trash']"
        :text-color="null"
        :background-color="null"
        @click="clearFailedAndMissing"
      />
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
      />
    </section>

    <section
      v-if="finishedDownloads.length > 0"
      class="downloadSection"
    >
      <h2>{{ t('Downloads.Downloaded') }}</h2>
      <DownloadRow
        v-for="download in finishedDownloads"
        :key="download.id"
        :download="download"
        :retrying="retryingDownloadIds.includes(download.id)"
        @clear="clearDownload(download.id)"
        @open="openDownload(download.id)"
        @play="playDownload(download)"
        @remove="pendingRemoval = download"
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
      v-if="pendingRemoval !== null"
      autosize
      :label="t('Downloads.Remove File Confirmation')"
      :extra-labels="[t('Downloads.Remove File Warning', { title: pendingRemoval.title })]"
      :option-names="[t('Downloads.Remove File'), t('Cancel')]"
      :option-values="['remove', 'cancel']"
      is-first-option-destructive
      @click="handleRemovePrompt"
    />
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import DownloadRow from './DownloadRow.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import store from '../../store/index'
import { formatBytes } from '../../helpers/fileSize'
import { showToast } from '../../helpers/utils'

const { t } = useI18n()
const router = useRouter()
const pendingRemoval = ref(null)
const retryingDownloadIds = ref([])
const downloads = computed(() => Object.values(store.getters.getYtDlpDownloads).sort((a, b) => b.id - a.id))
const activeDownloads = computed(() => downloads.value.filter(download => ['downloading', 'processing'].includes(download.status)))
const finishedDownloads = computed(() => downloads.value.filter(download => !['downloading', 'processing'].includes(download.status)))
const clearableDownloads = computed(() => finishedDownloads.value.filter(download => (
  ['failed', 'cancelled', 'skipped'].includes(download.status) ||
  (download.status === 'completed' && download.availability === 'missing')
)))
const totalSizeBytes = computed(() => downloads.value.reduce((total, download) => total + (download.sizeBytes ?? 0), 0))
const formattedTotalSize = computed(() => formatBytes(totalSizeBytes.value))

async function refreshDownloads() {
  const records = await window.ftElectron.ytDlpListDownloads()
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
  await window.ftElectron.ytDlpClearDownloads([id])
  store.commit('removeYtDlpDownload', id)
}
async function clearFailedAndMissing() {
  const ids = clearableDownloads.value.map(download => download.id)
  await window.ftElectron.ytDlpClearDownloads(ids)
  ids.forEach(id => store.commit('removeYtDlpDownload', id))
}
async function openDownload(id) {
  if (!await window.ftElectron.ytDlpOpenDownload(id)) {
    await refreshDownloads()
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
  }
}
async function playDownload(download) {
  const refreshedDownload = (await refreshDownloads()).find(record => record.id === download.id)
  const firstFile = refreshedDownload?.files?.find(file => file.available)
  if (!firstFile) {
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  const query = { downloadId: String(download.id) }
  if (refreshedDownload.playlistId) {
    query.playlistId = refreshedDownload.playlistId
  } else if (refreshedDownload.playlistKey) {
    query.playlistId = refreshedDownload.playlistKey
    query.playlistType = 'user'
  }

  store.dispatch('hideSettingsWindow')
  router.push({ path: `/watch/${firstFile.videoId}`, query })
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
    result = await window.ftElectron.ytDlpDownload(retryPayload, download.id)
  } catch (error) {
    console.error('Could not retry download', error)
  } finally {
    retryingDownloadIds.value = retryingDownloadIds.value.filter(id => id !== download.id)
  }
  if (result == null || !('id' in result)) {
    showToast({ message: t('Downloads.Download Failed'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  await clearDownload(download.id)
}
async function removeDownload(id) {
  if (await window.ftElectron.ytDlpRemoveDownload(id)) {
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
