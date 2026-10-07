<template>
  <FtPrompt
    v-if="!showDownloadPrompt"
    card-class="sharedLinkPrompt"
    autosize
    fixed-layout
    :label="t('Share.Shared YouTube Link')"
    @click="emit('close')"
  >
    <p
      class="sharedUrl"
      dir="auto"
    >
      {{ url }}
    </p>
    <div
      class="sharedLinkActions"
      :aria-busy="loading"
    >
      <FtButton
        :label="videoId ? t('Share.Open in Player') : t('Share.Open Link')"
        :icon="['fas', 'play']"
        size="medium"
        :disabled="loading"
        @click="emit('open')"
      />
      <template v-if="videoId">
        <FtButton
          :label="t('User Playlists.Add to Playlist')"
          :icon="['fas', 'playlist-add']"
          size="medium"
          :disabled="loading"
          @click="addVideo('playlist')"
        />
        <FtButton
          :label="t('Video.Add to Queue')"
          :icon="['fas', 'add-to-queue']"
          size="medium"
          :disabled="loading"
          @click="addVideo('queue')"
        />
        <FtButton
          v-if="enableDownloads"
          :label="t('Downloads.Download')"
          :icon="['fas', 'download']"
          size="medium"
          :disabled="loading"
          @click="showDownloadPrompt = true"
        />
      </template>
    </div>
    <p
      v-if="loading"
      role="status"
    >
      {{ t('Share.Loading Video Information') }}
    </p>
    <p
      v-if="failed"
      role="alert"
    >
      {{ t('Share.Video Information Failed') }}
    </p>
    <template #footer>
      <FtButton
        class="sharedLinkCancel"
        :label="t('Cancel')"
        :icon="['fas', 'xmark']"
        :text-color="null"
        :background-color="null"
        size="medium"
        @click="emit('close')"
      />
    </template>
  </FtPrompt>
  <WatchVideoDownloadPrompt
    v-else-if="enableDownloads"
    :video-id="videoId"
    :title="url"
    @close="emit('close')"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from '../FtButton/FtButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import store from '../../store'
import { getLocalHistoryMetadata } from '../../helpers/api/local'
import { getInvidiousHistoryMetadata } from '../../helpers/api/invidious'
import { parseHistoryRepairPlayer } from '../../../historyRepair'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  url: { type: String, required: true },
  videoId: { type: String, default: '' }
})
const emit = defineEmits(['close', 'open'])
const { t } = useI18n()
const loading = ref(false)
const failed = ref(false)
const showDownloadPrompt = ref(false)
const enableDownloads = computed(() => store.getters.getEnableDownloads)
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
watch(enableDownloads, enabled => { if (!enabled) showDownloadPrompt.value = false })

async function loadVideo(signal) {
  const loadMetadata = async loader => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    const metadata = await loader(props.videoId, requestSignal)
    requestSignal.throwIfAborted()
    return metadata
  }
  const loadInvidious = async () => {
    const info = await loadMetadata(getInvidiousHistoryMetadata)
    if (info?.error || info?.videoId !== props.videoId) throw new Error('Video metadata unavailable')
    return { ...info, published: info.published * 1000, isLive: info.liveNow }
  }
  const loadLocal = async () => parseHistoryRepairPlayer(await loadMetadata(getLocalHistoryMetadata), props.videoId)
  const prefersInvidious = store.getters.getBackendPreference === 'invidious'
  let info
  try {
    info = await (prefersInvidious ? loadInvidious() : loadLocal())
  } catch (error) {
    if (signal.aborted || !store.getters.getBackendFallback) throw error
    info = await (prefersInvidious ? loadLocal() : loadInvidious())
  }
  if (typeof info.title !== 'string' || !info.title.trim()) throw new Error('Video title unavailable')
  return { ...info, videoId: props.videoId, type: 'video', lengthSeconds: Number(info.lengthSeconds) || 0 }
}

async function addVideo(action) {
  if (loading.value) return
  loading.value = true
  failed.value = false
  try {
    const video = await loadVideo(controller.signal)
    controller.signal.throwIfAborted()
    if (action === 'playlist') {
      await store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: [video] })
    } else {
      store.commit('addVideoToWatchQueue', { video })
      showToast({ message: t('Video.Added to Queue'), icon: ['fas', 'list'] })
    }
    emit('close')
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('Unable to load shared video information', error)
      failed.value = true
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped src="./SharedYoutubeLinkPrompt.css" />
