<template>
  <main class="storageError">
    <section role="alert">
      <h1>{{ t('Storage Startup Error.Title') }}</h1>
      <p>{{ t('Storage Startup Error.Message') }}</p>
      <button
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
// A fresh renderer also retries NeDB's failed autoload/executor queues.
function retry() { window.location.reload() }
</script>

<style scoped src="./StorageStartupError.css" />
