<template>
  <FtCard class="downloadsPage">
    <div class="downloadsHeader">
      <h2>
        <FtIcon
          :icon="['fas', 'download']"
          class="headingIcon"
        />
        {{ t('Downloads.Downloads') }}
      </h2>
      <FtButton
        v-if="finishedDownloads.length > 0"
        :label="t('Downloads.Clear Finished')"
        :icon="['fas', 'trash']"
        :text-color="null"
        :background-color="null"
        @click="clearFinished"
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
        @clear="clearDownload(download.id)"
        @open="openDownload(download.id)"
        @remove="pendingRemoval = download"
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
  </FtCard>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DownloadRow from './DownloadRow.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import store from '../../store/index'
import { showToast } from '../../helpers/utils'

const { t } = useI18n()
const pendingRemoval = ref(null)
const downloads = computed(() => Object.values(store.getters.getYtDlpDownloads).sort((a, b) => b.id - a.id))
const activeDownloads = computed(() => downloads.value.filter(download => ['downloading', 'processing'].includes(download.status)))
const finishedDownloads = computed(() => downloads.value.filter(download => !['downloading', 'processing'].includes(download.status)))

async function clearDownload(id) {
  await window.ftElectron.ytDlpClearDownloads([id])
  store.commit('removeYtDlpDownload', id)
}
async function clearFinished() {
  await window.ftElectron.ytDlpClearDownloads(finishedDownloads.value.map(download => download.id))
  store.commit('clearFinishedYtDlpDownloads')
}
async function openDownload(id) {
  if (!await window.ftElectron.ytDlpOpenDownload(id)) {
    showToast({ message: t('Downloads.File Not Found'), icon: ['fas', 'circle-exclamation'] })
  }
}
async function removeDownload(id) {
  if (await window.ftElectron.ytDlpRemoveDownload(id)) {
    store.commit('removeYtDlpDownload', id)
  } else {
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
