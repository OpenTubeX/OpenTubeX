<template>
  <main class="storageError">
    <section role="alert">
      <h1>{{ t('Storage Startup Error.Title') }}</h1>
      <p v-if="isCapacitor">
        {{ t('Storage Startup Error.Message') }}
      </p>
      <p v-else-if="insecureWeb">
        {{ t('Storage Startup Error.Insecure Web Message') }}
      </p>
      <p v-else>
        {{ t('Storage Startup Error.Web Message') }}
      </p>
      <button
        v-if="!insecureWeb"
        type="button"
        class="retry"
        @click="retry"
      >
        <FtIcon
          :icon="['fas', 'sync']"
          aria-hidden="true"
        />
        {{ t('Storage Startup Error.Retry') }}
      </button>
    </section>
  </main>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

const { t } = useI18n()

// Browsers provide no storage the library can use on plain http:// addresses,
// so retrying there cannot help.
const isCapacitor = process.env.IS_CAPACITOR
const insecureWeb = !isCapacitor && !window.isSecureContext

// A fresh renderer also retries NeDB's failed autoload/executor queues.
function retry() { window.location.reload() }
</script>

<style scoped src="./StorageStartupError.css" />
