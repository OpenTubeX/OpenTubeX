<template>
  <details
    class="videoSummary"
    :class="{ 'phoneVideoSummary phonePanelCard': phone }"
    :open="expanded"
  >
    <summary
      @keydown.enter.space.stop
      @keyup.enter.space.stop
    >
      <ft-icon
        v-if="phone"
        class="summaryIcon"
        :icon="['fas', 'robot']"
        aria-hidden="true"
      />
      <FtInlineMetadata class="summaryHeading">
        <span class="summaryTitle">{{ $t('Video.AI-generated video summary') }}</span>
        <span class="summaryDisclaimer">
          {{ $t('Video.Quality and accuracy may vary') }}
        </span>
      </FtInlineMetadata>
      <ft-icon
        class="summaryChevron"
        :icon="['fas', 'angle-down']"
        aria-hidden="true"
      />
      <!-- Closed details render only their summary. -->
      <FtFixedBackground v-if="!phone" />
    </summary>
    <p
      v-for="(paragraph, index) in paragraphs"
      :key="index"
      class="summaryParagraph"
      dir="auto"
    >
      {{ paragraph }}
    </p>
  </details>
</template>

<script setup>
import FtFixedBackground from '../FtFixedBackground/FtFixedBackground.vue'
import FtInlineMetadata from '../FtInlineMetadata/FtInlineMetadata.vue'

defineProps({
  paragraphs: { type: Array, required: true },
  expanded: { type: Boolean, default: false },
  // Matches the phone watch page's Comments and Description cards
  phone: { type: Boolean, default: false }
})
</script>

<style scoped src="./WatchVideoSummary.css" />
<style scoped src="../phonePanelCard.css" />
