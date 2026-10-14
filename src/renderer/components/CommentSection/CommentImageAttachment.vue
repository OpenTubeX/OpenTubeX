<template>
  <div
    v-if="source || attachment.unavailableText"
    class="commentImageAttachment"
    :class="{ commentAttachmentReady: posterReady }"
  >
    <p v-if="failed || !source">
      {{ attachment.unavailableText }}
    </p>
    <template v-else>
      <canvas
        v-show="posterReady"
        ref="poster"
        :width="width"
        :height="height"
        role="img"
        :aria-label="attachment.rendererContext?.accessibilityContext?.label ?? ''"
        class="commentAttachmentImage commentAttachmentPoster"
      />
      <div class="commentAttachmentAnimation">
        <FtRetryImage
          :src="source.url"
          :alt="attachment.rendererContext?.accessibilityContext?.label ?? ''"
          :width="width"
          :height="height"
          loading="lazy"
          class="commentAttachmentImage"
          @error="failed = true"
          @load="capturePoster"
        />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, useTemplateRef, watch } from 'vue'
import FtRetryImage from '../FtRetryImage.vue'

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  }
})

const failed = ref(false)
const poster = useTemplateRef('poster')
const posterReady = ref(false)
const source = computed(() => props.attachment.image?.sources?.find(image => /^https:\/\//i.test(image.url)))
const ratio = computed(() => {
  const width = source.value?.width ?? props.attachment.width
  const height = source.value?.height ?? props.attachment.height
  return width > 0 && height > 0 ? width / height : 1
})
const width = computed(() => Math.round(128 * Math.min(ratio.value, 1)))
const height = computed(() => Math.round(128 / Math.max(ratio.value, 1)))

function capturePoster(event) {
  // Canvas draws an animated image's default frame, without requiring CORS.
  const context = poster.value?.getContext('2d')
  if (!context) return
  context.drawImage(event.target, 0, 0, width.value, height.value)
  posterReady.value = true
}

watch(source, () => {
  failed.value = false
  posterReady.value = false
})
</script>

<style scoped>
.commentImageAttachment {
  inline-size: fit-content;
  max-inline-size: calc(100% - 60px);
  margin-block: 8px;
  margin-inline-start: 60px;
}

.commentAttachmentImage {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
  object-fit: contain;
  border-radius: calc(8px * var(--ui-roundness));
}

.commentAttachmentReady > .commentAttachmentAnimation,
.commentAttachmentReady:hover > .commentAttachmentPoster {
  display: none;
}

.commentAttachmentReady:hover > .commentAttachmentAnimation {
  display: block;
}
</style>
