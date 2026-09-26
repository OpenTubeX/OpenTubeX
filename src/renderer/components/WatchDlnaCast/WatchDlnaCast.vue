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
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import { showToast } from '../../helpers/utils'
import { selectDlnaSource } from '../../helpers/player/dlnaSource'

const props = defineProps({
  formats: { type: Array, required: true },
  title: { type: String, required: true },
  getPlayer: { type: Function, required: true }
})

const { t } = useI18n()
const button = useTemplateRef('button')
const devices = ref([])
const loading = ref(false)
const busy = ref(false)
const castId = ref(null)
const deviceName = ref('')
let disposed = false
let resumeLocalPlayback = false

const source = computed(() => selectDlnaSource(props.formats))

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
    const results = await window.ftElectron.dlna.discover()
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
    await window.ftElectron.dlna.stop(id)
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
    const result = await window.ftElectron.dlna.start({
      deviceId: choice,
      mediaUrl: source.value.url,
      title: props.title,
      startSeconds: props.getPlayer()?.getCurrentTime?.() ?? 0
    })
    if (result.error) throw new Error(result.error)
    if (disposed) {
      await window.ftElectron.dlna.stop(result.castId)
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
