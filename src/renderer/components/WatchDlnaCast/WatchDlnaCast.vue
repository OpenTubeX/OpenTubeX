<template>
  <FtIconButton
    ref="button"
    class="dlnaCastControl shaka-no-propagation"
    :title="castId ? `${t('Video.Player.DLNA.Cast')} (${deviceName})` : t('Video.Player.DLNA.Cast')"
    :icon="['fas', 'cast']"
    :aria-pressed="Boolean(castId)"
    :dropdown-options="options"
    :force-dropdown="true"
    dropdown-position-x="right"
    @dropdown-open="refreshDevices"
    @click="handleChoice"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { showToast } from '../../helpers/utils'
import { dlnaCast } from '../../helpers/player/dlnaCast'
import { selectDlnaSource, selectDlnaTracks } from '../../helpers/player/dlnaSource'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { ytDlp } from '../../helpers/ytDlp'

const props = defineProps({
  formats: { type: Array, required: true },
  title: { type: String, required: true },
  videoId: { type: String, default: null },
  getPlayer: { type: Function, required: true }
})

const { t } = useI18n()
const store = useStore()
const button = useTemplateRef('button')
const devices = ref([])
const loading = ref(false)
const busy = ref(false)
const castId = ref(null)
const deviceName = ref('')
let disposed = false
let resumeLocalPlayback = false
const mergedSource = ref(null)

const source = computed(() => {
  const combined = selectDlnaSource(props.formats)
  return mergedSource.value && (!combined || mergedSource.value.height > (combined.height ?? 0))
    ? mergedSource.value
    : combined
})

const options = computed(() => {
  const items = []
  if (castId.value) {
    items.push(
      { label: t('Video.Player.DLNA.Stop'), value: 'stop', icon: ['fas', 'power-off'] },
      { type: 'divider' }
    )
  }
  if (loading.value) {
    items.push({ label: t('Theme Discovery.Loading'), disabled: true })
  } else if (devices.value.length === 0) {
    items.push({ label: t('Video.Player.DLNA.No Devices'), disabled: true })
  } else if (!source.value) {
    items.push({ label: t('Video.Player.DLNA.No MP4 Source'), disabled: true })
  } else {
    items.push(...devices.value.map(device => ({
      label: device.name,
      value: device.id,
      icon: ['fas', 'cast'],
      active: device.name === deviceName.value && Boolean(castId.value),
      disabled: busy.value || Boolean(castId.value)
    })))
  }
  items.push(
    { type: 'divider' },
    { label: t('Theme Discovery.Refresh'), value: 'refresh', icon: ['fas', 'sync'] }
  )
  return items
})

async function refreshDevices() {
  if (loading.value || disposed) return
  loading.value = true
  try {
    const [results] = await Promise.all([
      dlnaCast.discover(),
      (async () => {
        if (!props.videoId || castId.value) return
        mergedSource.value = null
        const info = await ytDlp.ytDlpGetPlaybackInfo(props.videoId, true, store.getters.getYtDlpPlaybackAlwaysUseCookies && hasConfiguredRestrictedPlaybackAuthentication(store.getters), false)
        if (!disposed && info && !info.error && !info.isLive) mergedSource.value = selectDlnaTracks(info.formats)
      })().catch(() => { /* The existing combined MP4 remains available. */ })
    ])
    if (!disposed) devices.value = results
  } catch {
    if (!disposed) showToast({ message: t('Video.Player.DLNA.Error'), icon: ['fas', 'cast'] })
  } finally {
    loading.value = false
  }
}

async function stopCasting(resumeLocal = true) {
  if (!castId.value) return
  const id = castId.value
  castId.value = null
  deviceName.value = ''
  try {
    await dlnaCast.stop(id)
  } finally {
    if (resumeLocal && resumeLocalPlayback && !disposed) {
      try { await props.getPlayer()?.play?.() } catch (error) { console.error(error) }
    }
    resumeLocalPlayback = false
  }
}

async function handleChoice(choice) {
  if (choice === 'refresh') {
    await refreshDevices()
    return
  }
  if (choice === 'stop') {
    await stopCasting()
    return
  }
  if (!source.value || busy.value || castId.value) return
  busy.value = true
  try {
    const wasPlaying = !props.getPlayer()?.isPaused?.()
    const payload = {
      deviceId: choice,
      mediaUrl: source.value.url,
      ...(source.value.audioUrl ? { audioUrl: source.value.audioUrl } : {}),
      title: props.title,
      startSeconds: props.getPlayer()?.getCurrentTime?.() ?? 0
    }
    let result = await dlnaCast.start(payload)
    if (result.muxUnavailable && payload.audioUrl && !disposed) {
      const combined = selectDlnaSource(props.formats)
      if (combined) {
        result = await dlnaCast.start({
          deviceId: choice, mediaUrl: combined.url, title: props.title, startSeconds: payload.startSeconds
        })
      }
    }
    if (result.error) throw new Error(result.error)
    if (disposed) {
      await dlnaCast.stop(result.castId)
      return
    }
    resumeLocalPlayback = wasPlaying
    castId.value = result.castId
    deviceName.value = result.deviceName
    props.getPlayer()?.pause?.()
    button.value?.hideDropdown()
  } catch (error) {
    if (!disposed) {
      console.error('DLNA casting failed', error)
      showToast({ message: t('Video.Player.DLNA.Error'), icon: ['fas', 'cast'] })
    }
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  stopCasting(false).catch(console.error)
})
</script>
