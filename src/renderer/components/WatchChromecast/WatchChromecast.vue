<template>
  <slot />
  <Teleport
    v-if="progressTarget"
    :to="progressTarget"
  >
    <div
      class="castProgress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        class="castProgressSpinner"
        aria-hidden="true"
      />
      <span>{{ progressMessage }}</span>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import { useRoute } from 'vue-router'
import { showToast, formatDurationAsTimestamp } from '../../helpers/utils'
import { selectCastSource } from '../../helpers/player/castSource'
import { getSubtitleRequestUrl, shouldUseSubtitleCookies } from '../../helpers/player/subtitleCookies'

const props = defineProps({
  formats: { type: Array, required: true },
  manifestUrl: { type: String, default: null },
  manifestType: { type: String, default: null },
  captions: { type: Array, default: () => [] },
  subtitlesEnabled: { type: Boolean, default: false },
  isLive: { type: Boolean, default: false },
  title: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  getPlayer: { type: Function, required: true },
  getSource: { type: Function, required: true }
})
const emit = defineEmits(['casting-change', 'busy-change', 'playback-state', 'ended', 'close-menu'])
const { t } = useI18n()
const store = useStore()
const route = useRoute()
let watchPath = route.path
const devices = ref([])
const loading = ref(false)
const busy = ref(false)
watch(busy, value => emit('busy-change', value), { flush: 'sync' })
watch(() => props.disabled, disabled => { if (disabled) emit('close-menu') })
const castId = ref(null)
const deviceName = ref('')
const startupStage = ref(null)
const menuTitle = computed(() => castId.value ? t('Video.Player.Google Cast.Connected', { device: deviceName.value }) : t('Video.Player.Google Cast.Cast'))
const status = ref({ currentTime: 0, duration: 0, paused: false, volume: 1, muted: false, activeTrackIds: [] })
const progressMessage = computed(() => {
  if (startupStage.value) {
    const labels = {
      preparing: t('Video.Player.Google Cast.Preparing Video'),
      connecting: t('Video.Player.Google Cast.Connecting', { device: deviceName.value }),
      launching: t('Video.Player.Google Cast.Starting Receiver'),
      loading: t('Video.Player.Google Cast.Loading Video')
    }
    return labels[startupStage.value]
  }
  return castId.value && status.value.buffering ? t('Video.Player.Google Cast.Buffering', { device: deviceName.value }) : ''
})
const progressTarget = computed(() => progressMessage.value ? props.getPlayer()?.$el?.querySelector('.ftVideoPlayer') : null)
const castCaptions = ref([])
let disposed = false
let disposedPlayer = null
let pollTimer
const resolvedSource = shallowRef(null)
const source = computed(() => resolvedSource.value ?? selectCastSource(props.formats, props.manifestUrl, props.manifestType))
watch(() => [props.formats, props.manifestUrl, props.manifestType], () => { resolvedSource.value = null })
const options = computed(() => {
  if (castId.value) {
    const items = [
      { label: `${formatDurationAsTimestamp(status.value.currentTime)} / ${formatDurationAsTimestamp(status.value.duration)}`, disabled: true },
      { label: status.value.paused ? t('Video.Player.Scroll Mini Player.Play') : t('Video.Player.Scroll Mini Player.Pause'), value: status.value.paused ? 'play' : 'pause', icon: ['fas', status.value.paused ? 'play' : 'pause'], disabled: busy.value },
      { label: t('Video.Player.Google Cast.Rewind'), value: 'rewind', icon: ['fas', 'undo'], disabled: busy.value || props.isLive },
      { label: t('Video.Player.Google Cast.Forward'), value: 'forward', icon: ['fas', 'forward'], disabled: busy.value || props.isLive },
      { label: t('KeyboardShortcutPrompt.Volume Down'), value: 'volume-down', icon: ['fas', 'volume-low'], disabled: busy.value },
      { label: t('KeyboardShortcutPrompt.Volume Up'), value: 'volume-up', icon: ['fas', 'volume-high'], disabled: busy.value },
      { label: status.value.muted ? t('Video.Player.SponsorBlock.MuteToastUnmute') : t('Video.Player.SponsorBlock.MuteActionType'), value: 'mute', icon: ['fas', status.value.muted ? 'volume-high' : 'volume-mute'], disabled: busy.value }
    ]
    if (castCaptions.value.length) {
      items.push({ type: 'divider' },
        { label: t('Video.Player.Google Cast.Subtitles Off'), value: 'caption-0', icon: ['fas', 'closed-captioning'], active: status.value.activeTrackIds.length === 0, disabled: busy.value },
        ...castCaptions.value.map((caption, index) => ({
          label: caption.label,
          value: `caption-${index + 1}`,
          icon: ['fas', 'closed-captioning'],
          active: status.value.activeTrackIds.includes(index + 1),
          disabled: busy.value
        })))
    }
    items.push({ type: 'divider' }, { label: t('Video.Player.Google Cast.Return'), value: 'stop', icon: ['fas', 'display'], disabled: busy.value })
    return items
  }
  const items = loading.value
    ? [{ label: t('Theme Discovery.Loading'), disabled: true }]
    : !source.value
        ? [{ label: t('Video.Player.Google Cast.No Source'), disabled: true }]
        : devices.value.length === 0
          ? [{ label: t('Video.Player.Google Cast.No Devices'), disabled: true }]
          : devices.value.map(device => ({ label: device.name, value: `device-${device.id}`, icon: ['fas', 'cast'], disabled: busy.value }))
  items.push({ type: 'divider' }, { label: t('Theme Discovery.Refresh'), value: 'refresh', icon: ['fas', 'sync'], disabled: loading.value || busy.value })
  return items
})

function reportError(error) {
  if (disposed) return
  let reason = typeof error?.message === 'string'
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : ''
  reason = {
    CAST_UNTRUSTED_CERTIFICATE: t('Video.Player.Google Cast.Untrusted Receiver'),
    CAST_INVALID_AUTHENTICATION: t('Video.Player.Google Cast.Invalid Authentication'),
    CAST_AUTHENTICATION_DECLINED: t('Video.Player.Google Cast.Authentication Declined'),
    CAST_AUDIO_ONLY: t('Video.Player.Google Cast.Audio Only Receiver'),
    CAST_DISCONNECTED: t('Video.Player.Google Cast.Disconnected'),
    CAST_TIMEOUT: t('Video.Player.Google Cast.Timeout'),
    CAST_BUSY: t('Video.Player.Google Cast.Busy'),
    CAST_NOT_AUTHORIZED: t('Video.Player.Google Cast.Not Authorized'),
    CAST_INVALID_REQUEST: t('Video.Player.Google Cast.Invalid Request'),
    CAST_IPV4_REQUIRED: t('Video.Player.Google Cast.IPv4 Required'),
    CAST_LAUNCH_FAILED: t('Video.Player.Google Cast.Launch Failed'),
    CAST_LOAD_FAILED: t('Video.Player.Google Cast.Load Failed'),
    CAST_CANCELLED: t('Video.Player.Google Cast.Cancelled'),
    CAST_PRIVATE_NOT_AUTHORIZED: t('Video.Player.Google Cast.Private Not Authorized'),
    CAST_INVALID_SUBTITLES: t('Video.Player.Google Cast.Invalid Subtitles'),
    CAST_DISCOVERY_FAILED: t('Video.Player.Google Cast.Discovery Failed')
  }[error?.code] ?? reason
  showToast({
    message: reason ? t('Video.Player.Google Cast.Error With Details', { error: reason }) : t('Video.Player.Google Cast.Error'),
    icon: ['fas', 'cast']
  })
}

async function refreshDevices() {
  if (loading.value || disposed || castId.value) return
  loading.value = true
  try {
    refreshSource().catch(reportError)
    const result = await window.ftElectron.chromecast.discover()
    if (disposed) return
    if (!Array.isArray(result)) throw Object.assign(new Error(result?.error ?? 'Cast discovery failed'), { code: result?.errorCode ?? (result?.error ? undefined : 'CAST_DISCOVERY_FAILED') })
    devices.value = result
  } catch (error) { reportError(error) } finally { loading.value = false }
}

let sourceLookup = 0
async function refreshSource() {
  const lookup = ++sourceLookup
  if (disposed || castId.value) return
  while (true) {
    const inputs = { formats: props.formats, url: props.manifestUrl, type: props.manifestType }
    const [selected] = await Promise.allSettled([props.getSource()])
    if (disposed || castId.value || lookup !== sourceLookup) return
    if (inputs.formats !== props.formats || inputs.url !== props.manifestUrl || inputs.type !== props.manifestType) continue
    if (selected.status === 'fulfilled') resolvedSource.value = selected.value
    else if (!source.value) throw selected.reason
    return
  }
}

function releaseLocalPlayer(position, resume) {
  const player = props.getPlayer()
  if (disposed && (!disposedPlayer || player !== disposedPlayer || route.path !== watchPath)) return
  if (Number.isFinite(position)) player?.setCurrentTime(position)
  if (!disposed) emit('casting-change', false)
  if (resume) player?.play()?.catch(reportError)
}

async function poll() {
  const id = castId.value
  if (!id || disposed || stopPromise) return
  try {
    const result = await window.ftElectron.chromecast.status(id)
    if (disposed || id !== castId.value || stopPromise) return
    if (!result.connected) {
      castId.value = null
      releaseLocalPlayer(result.currentTime ?? status.value.currentTime, false)
      reportError(Object.assign(new Error('Cast device disconnected'), { code: 'CAST_DISCONNECTED' }))
      return
    }
    status.value = result
    emit('playback-state', result)
    if (result.ended) {
      await stopCasting(false)
      if (!disposed) emit('ended')
      return
    }
  } catch (error) {
    if (disposed || id !== castId.value || stopPromise) return
    // Stop the remote session and release local controls after a failed poll.
    // stopCasting's finally block also handles a failed stop request.
    await stopCasting(false).catch(() => {})
    reportError(error)
    return
  }
  if (castId.value && !disposed) pollTimer = setTimeout(poll, 1000)
}

let stopPromise = null
async function stopCasting(resume = true) {
  if (stopPromise) return stopPromise
  const id = castId.value
  if (!id) return
  clearTimeout(pollTimer)
  const previous = status.value
  stopPromise = (async () => {
    try {
      const result = await window.ftElectron.chromecast.stop(id)
      status.value = { ...previous, ...result }
      if (!disposed) emit('playback-state', status.value)
    } finally {
      castId.value = null
      releaseLocalPlayer(status.value.currentTime, resume && !status.value.paused && !previous.ended)
    }
  })()
  try { await stopPromise } finally { stopPromise = null }
}

async function handleChoice(choice) {
  if (disposed || busy.value || props.disabled) return
  if (choice === 'refresh') return refreshDevices()
  busy.value = true
  let resumePlayer = null
  try {
    if (choice === 'stop') {
      await stopCasting()
      emit('close-menu')
      return
    }
    if (castId.value) {
      let action = choice
      let value
      if (choice === 'rewind' || choice === 'forward') {
        action = 'seek'
        value = Math.max(0, status.value.currentTime + (choice === 'forward' ? 10 : -10))
        if (status.value.duration) value = Math.min(value, status.value.duration)
      } else if (choice.startsWith('volume-')) {
        action = 'volume'
        value = Math.min(1, Math.max(0, status.value.volume + (choice === 'volume-up' ? 0.1 : -0.1)))
      } else if (choice === 'mute') value = !status.value.muted
      else if (choice.startsWith('caption-')) { action = 'caption'; value = Number(choice.slice(8)) }
      const result = await window.ftElectron.chromecast.control(castId.value, action, value)
      if (result.error) throw Object.assign(new Error(result.error), { code: result.errorCode })
      status.value = result
      emit('playback-state', result)
      return
    }
    if (!choice.startsWith('device-') || !source.value) return
    deviceName.value = devices.value.find(device => device.id === choice.slice(7))?.name ?? ''
    startupStage.value = 'preparing'
    let captions = props.captions.filter(caption => caption.mimeType === 'text/vtt' && /^https?:\/\//i.test(caption.url))
      .map(({ url, label, language }) => ({ url, label, language }))
    const caption = props.subtitlesEnabled ? props.getPlayer()?.getActiveCaption() : null
    if (caption?.mimeType === 'text/vtt' && /^https?:\/\//i.test(caption.url) && !captions.some(item => item.url === caption.url)) {
      captions.push({ url: caption.url, label: caption.label, language: caption.language })
    }
    let player
    const result = await window.ftElectron.chromecast.start(async () => {
      // Optional authenticated tracks would each launch an unused yt-dlp process.
      captions = captions.filter(item => item.url === caption?.url || !shouldUseSubtitleCookies(item.url, store.getters))
      const captionIndex = caption ? captions.findIndex(item => item.url === caption.url) : null
      if (captionIndex !== null && captionIndex >= 0) {
        const selected = captions[captionIndex]
        captions[captionIndex] = { ...selected, url: await getSubtitleRequestUrl(selected.url, store.getters) }
      }
      if (disposed) return null
      player = props.getPlayer()
      watchPath = route.path
      const paused = player?.isPaused() ?? true
      const playbackRate = player?.getCurrentPlaybackRate() ?? 1
      if (!paused) {
        resumePlayer = player
        player.pause()
      }
      return {
        deviceId: choice.slice(7),
        source: source.value,
        title: props.title,
        startSeconds: player?.getCurrentTime() ?? 0,
        playbackRate,
        paused,
        captions,
        captionIndex,
        isLive: props.isLive
      }
    }, stage => {
      if (!disposed && ['connecting', 'launching', 'loading'].includes(stage)) startupStage.value = stage
    })
    if (result.error) throw Object.assign(new Error(result.error), { code: result.errorCode })
    if (disposed || route.path !== watchPath || props.getPlayer() !== player) {
      await window.ftElectron.chromecast.stop(result.castId)
      return
    }
    resumePlayer = null
    castId.value = result.castId
    deviceName.value = result.deviceName
    status.value = result.status
    castCaptions.value = captions
    emit('casting-change', true)
    emit('playback-state', status.value)
    props.getPlayer()?.pause()
    emit('close-menu')
    pollTimer = setTimeout(poll, 1000)
  } catch (error) {
    reportError(error)
  } finally {
    // A removed control can still own a pending handoff. Restore only its
    // surviving player after startup or cancellation cleanup has settled.
    if (resumePlayer && props.getPlayer() === resumePlayer && route.path === watchPath) releaseLocalPlayer(undefined, true)
    startupStage.value = null
    busy.value = false
  }
}

defineExpose({ stopCasting, options, castId, menuTitle, refreshDevices, handleChoice })

onBeforeUnmount(() => {
  // Capture the original player before Vue clears refs; navigation never resumes it.
  disposedPlayer = props.getPlayer()
  stopCasting().catch(console.error)
  disposed = true
  emit('busy-change', false)
  emit('casting-change', false)
  clearTimeout(pollTimer)
})
</script>

<style scoped src="./WatchChromecast.css" />
