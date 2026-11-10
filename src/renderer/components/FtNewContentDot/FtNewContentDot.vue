<template>
  <span
    class="newContentDot"
    role="img"
    :aria-label="t('Subscriptions.New Since Last Refresh')"
    :title="t('Subscriptions.New Since Last Refresh')"
  />
</template>

<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped src="./FtNewContentDot.css" />
