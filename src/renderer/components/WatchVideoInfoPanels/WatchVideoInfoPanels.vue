<template>
  <FtCard class="infoPanels">
    <div
      v-for="(panel, index) in panels"
      :key="index"
      class="infoPanel"
    >
      <FtIcon
        class="infoPanelIcon"
        :icon="['fas', 'circle-info']"
        aria-hidden="true"
      />
      <div class="infoPanelContent">
        <h3
          v-if="panel.title"
          class="infoPanelTitle"
          dir="auto"
        >
          {{ panel.title }}
        </h3>
        <p
          v-for="(paragraph, paragraphIndex) in panel.paragraphs"
          :key="paragraphIndex"
          class="infoPanelParagraph"
          dir="auto"
        >
          {{ paragraph }}
        </p>
        <p
          v-if="panel.source && panel.disclaimer"
          class="infoPanelParagraph"
          dir="auto"
        >
          {{ panel.disclaimer }}
        </p>
        <a
          v-if="panel.url"
          class="infoPanelSource"
          :href="panel.url"
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
        >
          {{ panel.source ? $t('Video.Info panel source', { source: panel.source }) : panel.disclaimer }}
          <FtIcon
            class="infoPanelSourceIcon"
            :icon="['fas', 'arrow-up-right-from-square']"
            aria-hidden="true"
          />
        </a>
        <span
          v-else-if="panel.source || panel.disclaimer"
          class="infoPanelSource"
          dir="auto"
        >
          {{ panel.source ? $t('Video.Info panel source', { source: panel.source }) : panel.disclaimer }}
        </span>
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import FtCard from '../ft-card/ft-card.vue'

defineProps({
  /** @type {import('vue').PropType<import('../../helpers/api/local').LocalInfoPanel[]>} */
  panels: { type: Array, required: true }
})
</script>

<style scoped src="./WatchVideoInfoPanels.css" />
