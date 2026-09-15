<template>
  <details
    class="videoSummary"
  >
    <summary>
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
    >
      {{ paragraph }}
    </p>
  </details>
</template>

<script setup>
defineProps({
  paragraphs: { type: Array, required: true }
})
</script>

<style scoped src="./WatchVideoSummary.css" />
