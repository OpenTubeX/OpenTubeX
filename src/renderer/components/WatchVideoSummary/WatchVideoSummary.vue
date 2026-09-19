<template>
  <details
    class="videoSummary"
    :open="expanded"
  >
    <summary
      @keydown.enter.space.stop
      @keyup.enter.space.stop
    >
      <span class="summaryHeading">
        <span class="summaryTitle">{{ $t('Video.AI-generated video summary') }}</span>
        <span class="summaryDisclaimer">
          {{ $t('Video.Quality and accuracy may vary') }}
        </span>
      </span>
      <ft-icon
        class="summaryChevron"
        :icon="['fas', 'angle-down']"
        aria-hidden="true"
      />
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
defineProps({
  paragraphs: { type: Array, required: true },
  expanded: { type: Boolean, default: false }
})
</script>

<style scoped src="./WatchVideoSummary.css" />
