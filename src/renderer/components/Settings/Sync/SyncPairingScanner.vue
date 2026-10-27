<template>
  <p>{{ hint }}</p>
  <FtLoader v-if="usingNativeScanner" />
  <div
    v-else
    class="scannerFrame"
  >
    <video
      ref="scannerVideo"
      class="scannerVideo"
      autoplay
      muted
      playsinline
    />
  </div>
  <p
    class="pairingSecondary"
    aria-live="polite"
  >
    {{ t('Settings.Sync Settings.Waiting For Pairing Code') }}
  </p>
</template>

<script setup>
import QrScanner from 'qr-scanner'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtLoader from '../../FtLoader/FtLoader.vue'

const props = defineProps({
  hint: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['scan', 'cancel', 'unavailable'])
const { t } = useI18n()
const usingNativeScanner = Boolean(process.env.IS_CAPACITOR)
const scannerVideo = useTemplateRef('scannerVideo')

let scanner = null
let active = true

function stopScanner() {
  scanner?.destroy()
  scanner = null
}

onMounted(async () => {
  try {
    // Keep the build flag here so Webpack excludes native scanner chunks on desktop/web.
    if (process.env.IS_CAPACITOR) {
      const { scanNativePairingCode } = await import('../../../helpers/nativePairingScanner')
      if (!active) return
      const code = await scanNativePairingCode({
        instructions: props.hint,
        cancelLabel: t('Cancel'),
        torchOnLabel: t('Settings.Sync Settings.Turn Flashlight Off'),
        torchOffLabel: t('Settings.Sync Settings.Turn Flashlight On'),
      })
      if (!active) return
      if (code === null) {
        emit('cancel')
      } else {
        emit('scan', code)
      }
      return
    }
    scanner = new QrScanner(scannerVideo.value, (result) => {
      if (!active || !scanner) return
      stopScanner()
      emit('scan', result.data)
    }, {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 10,
      preferredCamera: 'environment',
      returnDetailedScanResult: true,
    })
    await scanner.start()
  } catch {
    if (!active) return
    stopScanner()
    emit('unavailable')
  }
})

onBeforeUnmount(() => {
  active = false
  stopScanner()
})
</script>

<style scoped src="./SyncPairing.css" />
