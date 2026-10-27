<template>
  <Translation
    keypath="Downloads.Download Failure Hint"
    tag="p"
    class="downloadFailureHint"
  >
    <template #issuesLink>
      <a
        :href="YT_DLP_YOUTUBE_ISSUES_URL"
        @click.prevent.stop="openIssues"
      >
        {{ t('Downloads.yt-dlp YouTube Issues') }}
      </a>
    </template>
  </Translation>
</template>

<script setup>
import { inject } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

const YT_DLP_YOUTUBE_ISSUES_URL = 'https://github.com/yt-dlp/yt-dlp/issues?q=is%3Aissue%20sort%3Acreated-desc%20YouTube'
const { t } = useI18n()

// Prompts stop clicks before the document link handler, so handle them here.
// Middle clicks still reach that handler. Both keep the external-link setting.
const handleExternalLink = inject('handleExternalLink')

function openIssues() {
  handleExternalLink(YT_DLP_YOUTUBE_ISSUES_URL)
}
</script>

<style scoped>
.downloadFailureHint {
  color: var(--secondary-text-color);
  font-size: 0.9rem;
  margin-block: 4px;
  overflow-wrap: anywhere;
}
</style>
