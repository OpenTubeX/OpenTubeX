<template>
  <div
    class="progressBar"
  >
    <div
      v-show="progressBarPercentage > 0"
      class="progressBarFill"
      :style="{ inlineSize: progressBarPercentage + '%' }"
    />
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

const progressBarPercentage = computed(() => props.progress)
</script>

<style scoped src="./FtProgressBar.css" />
