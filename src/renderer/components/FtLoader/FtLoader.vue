<template>
  <div
    class="loadingIndicator"
    :class="{ fullscreen, compact, inline }"
    :role="label ? 'status' : undefined"
    :aria-label="label || undefined"
    :style="size ? { '--loading-indicator-size': size } : undefined"
    :data-tab-loading-indicator="tabLoadingIndicator ? '' : undefined"
  >
    <span
      class="indicatorContainer"
      aria-hidden="true"
    >
      <span class="activeIndicator" />
    </span>
  </div>
</template>

<script setup>
defineProps({
  fullscreen: {
    type: Boolean,
    default: false
  },
  /** Pads the indicator lightly instead of centering it in a large area. */
  compact: {
    type: Boolean,
    default: false
  },
  /** Flows with surrounding content and drops the tonal container. */
  inline: {
    type: Boolean,
    default: false
  },
  /** Overrides the indicator size; callers can also set `--loading-indicator-size`. */
  size: {
    type: String,
    default: null
  },
  /** Announces the indicator as a status with this name. */
  label: {
    type: String,
    default: null
  },
  tabLoadingIndicator: {
    type: Boolean,
    default: true
  }
})
</script>

<style scoped src="./FtLoader.css" />
