<template>
  <FtIconButton
    ref="button"
    class="dlnaCastControl shaka-no-propagation"
    :title="castId ? `${t('Video.Player.DLNA.Cast')} (${deviceName})` : t('Video.Player.DLNA.Cast')"
    :icon="['fas', 'cast']"
    :aria-pressed="Boolean(castId)"
    :dropdown-options="options"
    :force-dropdown="true"
    :disabled="disabled"
    dropdown-position-x="right"
    @dropdown-open="refreshDevices"
    @click="handleChoice"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { showToast } from '../../helpers/utils'
import { dlnaCast, retainIosMediaSources } from '../../helpers/player/dlnaCast'
import { selectDlnaSource, selectDlnaTracks } from '../../helpers/player/dlnaSource'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { ytDlp } from '../../helpers/ytDlp'

const props = defineProps({
  formats: { type: Array, required: true },
  title: { type: String, required: true },
  videoId: { type: String, default: null },
  disabled: { type: Boolean, default: false },
  getPlayer: { type: Function, required: true }
})
const emit = defineEmits(['casting-change'])

const { t } = useI18n()
const store = useStore()
const mobileAuthorization = () => process.env.IS_CAPACITOR && store.getters.getCurrentInvidiousInstanceAuthorization
  ? { authorization: { url: store.getters.getCurrentInvidiousInstanceUrl, value: store.getters.getCurrentInvidiousInstanceAuthorization } }
  : {}
const button = useTemplateRef('button')
const devices = ref([])
const loading = ref(false)
const busy = ref(false)
const castId = ref(null)
watch(() => busy.value || Boolean(castId.value), active => emit('casting-change', active), { flush: 'sync' })
watch(() => props.disabled, disabled => { if (disabled) button.value?.hideDropdown() })
const deviceName = ref('')
let disposed = false
let resumeLocalPlayback = false
let castPayload = null
let sourceLoading = false
const mergedSource = ref(null)
retainIosMediaSources(() => [mergedSource.value?.url, mergedSource.value?.audioUrl])

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
      { label: t('Video.Player.DLNA.Stop'), value: 'stop', icon: ['fas', 'power-off'], disabled: busy.value },
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

async function refreshSource() {
  if (!props.videoId || castId.value || sourceLoading || disposed) return
  sourceLoading = true
  mergedSource.value = null
  try {
    const info = await ytDlp.ytDlpGetPlaybackInfo(props.videoId, true, store.getters.getYtDlpPlaybackAlwaysUseCookies && hasConfiguredRestrictedPlaybackAuthentication(store.getters), false)
    if (!disposed && !castId.value && info && !info.error && !info.isLive) mergedSource.value = selectDlnaTracks(info.formats)
  } catch { /* The existing combined MP4 remains available. */ } finally {
    sourceLoading = false
  }
}

async function refreshDevices() {
  if (loading.value || disposed) return
  loading.value = true
  refreshSource()
  try {
    const results = await dlnaCast.discover()
    if (!disposed) devices.value = results
  } catch {
    if (!disposed) showToast({ message: t('Video.Player.DLNA.Error'), icon: ['fas', 'cast'] })
  } finally {
    loading.value = false
  }
}

async function stopCasting(resumeLocal = true) {
  if (!castId.value) return
  const wasBusy = busy.value
  busy.value = true
  const id = castId.value
  castId.value = null
  deviceName.value = ''
  try {
    await dlnaCast.stop(id)
  } finally {
    try {
      if (resumeLocal && resumeLocalPlayback && !disposed) {
        try { await props.getPlayer()?.play?.() } catch (error) { console.error(error) }
      }
    } finally {
      resumeLocalPlayback = false
      castPayload = null
      busy.value = wasBusy
    }
  }
}

async function handleChoice(choice) {
  if (disposed || props.disabled) return
  if (choice === 'refresh') {
    await refreshDevices()
    return
  }
  if (choice === 'stop') {
    if (busy.value) return
    await stopCasting()
    return
  }
  if (!source.value || busy.value || castId.value) return
  busy.value = true
  try {
    const wasPlaying = !props.getPlayer()?.isPaused?.()
    const combined = selectDlnaSource(props.formats)
    const payload = {
      ...mobileAuthorization(),
      deviceId: choice,
      mediaUrl: source.value.url,
      ...(source.value.audioUrl ? { audioUrl: source.value.audioUrl } : {}),
      ...(source.value.audioUrl && combined ? { fallbackMediaUrl: combined.url } : {}),
      title: props.title,
      startSeconds: props.getPlayer()?.getCurrentTime?.() ?? 0
    }
    const result = await dlnaCast.start(payload)
    if (result.error) throw new Error(result.error)
    if (disposed) {
      await dlnaCast.stop(result.castId)
      return
    }
    castPayload = result.usedFallback ? null : payload
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

// Relay failures happen when the TV fetches media, after Play has returned.
const failureCheck = setInterval(async () => {
  if (disposed || busy.value || !castId.value) return
  const id = castId.value
  let stopped
  try {
    stopped = process.env.IS_CAPACITOR && await dlnaCast.hasStopped(id)
    if ((!stopped && !await dlnaCast.hasFailed(id)) || disposed || castId.value !== id || busy.value) return
  } catch { return }
  busy.value = true
  const wasPlaying = resumeLocalPlayback
  const payload = castPayload
  try {
    if (disposed) return
    if (stopped) { await stopCasting(false); return }
    if (!payload?.audioUrl) throw new Error('The native cast relay stopped')
    const combined = selectDlnaSource(props.formats)
    if (!combined) throw new Error('No complete MP4 fallback is available')
    const result = await dlnaCast.recover(id, {
      ...mobileAuthorization(),
      deviceId: payload.deviceId,
      mediaUrl: combined.url,
      title: props.title,
      startSeconds: payload.startSeconds
    })
    if (result.error) throw new Error(result.error)
    if (disposed) { await dlnaCast.stop(result.castId); return }
    castId.value = result.castId
    castPayload = null
    deviceName.value = result.deviceName
    resumeLocalPlayback = wasPlaying
  } catch (error) {
    if (!disposed) {
      await stopCasting(false).catch(console.error)
      console.error('DLNA stream failed', error)
      showToast({ message: t('Video.Player.DLNA.Error'), icon: ['fas', 'cast'] })
      if (wasPlaying) {
        try { await props.getPlayer()?.play?.() } catch (error) { console.error(error) }
      }
    }
  } finally { busy.value = false }
}, 1000)

onBeforeUnmount(() => {
  disposed = true
  clearInterval(failureCheck)
  stopCasting(false).catch(console.error)
  emit('casting-change', false)
})
</script>
