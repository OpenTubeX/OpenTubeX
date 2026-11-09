<template>
  <div
    class="progressBar"
    :style="{ '--progress-fraction': progressFraction }"
  >
    <div class="progressBarIndicator">
      <div
        v-show="progressFraction > 0"
        class="progressBarActive"
      />
      <div class="progressBarTrack" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  progress: {
    type: Number,
    required: true
  }
})

const progressFraction = computed(() => Math.min(100, Math.max(0, props.progress)) / 100)
</script>

<style scoped src="./FtProgressBar.css" />
