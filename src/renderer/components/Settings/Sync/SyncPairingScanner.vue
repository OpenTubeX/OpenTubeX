<template>
  <p>{{ hint }}</p>
  <div class="scannerFrame">
    <FtIcon
      class="scannerPlaceholderIcon"
      :icon="['fas', 'camera']"
    />
    <!-- Android WebView draws a stretched play icon as the default poster until
    the first camera frame, so a transparent poster shows the placeholder. -->
    <video
      ref="scannerVideo"
      class="scannerVideo"
      :poster="TRANSPARENT_POSTER"
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

defineProps({
  hint: {
    type: String,
    required: true,
  },
})

const TRANSPARENT_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

const emit = defineEmits(['scan', 'unavailable'])
const { t } = useI18n()
const scannerVideo = useTemplateRef('scannerVideo')

let scanner = null
let active = true

function stopScanner() {
  scanner?.destroy()
  scanner = null
}

onMounted(async () => {
  try {
    // Android WebView advertises QR support in BarcodeDetector but never finds a
    // code. qr-scanner sets this flag itself only when the detector reports that
    // it is unavailable, so the mobile apps set it to decode with its worker.
    if (process.env.IS_CAPACITOR) QrScanner._disableBarcodeDetector = true
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
