<template>
  <div
    v-if="activeAnnotations.length > 0"
    ref="annotationRoot"
    class="videoAnnotations"
  >
    <button
      type="button"
      class="annotationToggle"
      :title="toggleLabel"
      :aria-label="toggleLabel"
      :aria-pressed="annotationsHidden"
      @click.stop="annotationsHidden = !annotationsHidden"
    >
      <FontAwesomeIcon :icon="['fas', annotationsHidden ? 'eye' : 'eye-slash']" />
      <span>{{ buttonLabel }}</span>
    </button>

    <div
      class="annotationSurface"
      :style="annotationSurfaceStyle"
    >
      <template
        v-for="annotation in annotationsHidden ? [] : activeAnnotations"
        :key="annotation.id"
      >
        <div
          v-if="annotation.type === 'CHANNEL'"
          class="channelAnnotation"
          :class="{ channelAnnotationAlignStart: annotation.left < 0.5 }"
          :style="getAnnotationStyle(annotation)"
        >
          <RouterLink
            class="channelAvatarLink"
            :to="annotation.route"
            :title="annotation.title"
            :aria-label="annotation.title"
          >
            <img
              :src="annotation.thumbnail"
              class="annotationThumbnail"
              alt=""
            >
          </RouterLink>
          <div class="channelHovercard">
            <div class="channelHovercardInfo">
              <RouterLink
                class="channelHovercardTitle"
                :to="annotation.route"
                dir="auto"
              >
                {{ annotation.title }}
              </RouterLink>
              <FtSubscribeButton
                v-if="annotation.channelId"
                class="annotationSubscribeButton"
                :channel-id="annotation.channelId"
                :channel-name="annotation.title"
                :channel-thumbnail="annotation.thumbnail"
                :hide-profile-dropdown-toggle="true"
                :open-dropdown-on-subscribe="false"
              />
              <p
                v-if="annotation.description"
                class="channelHovercardDescription"
                dir="auto"
              >
                {{ annotation.description }}
              </p>
            </div>
          </div>
        </div>

        <RouterLink
          v-else
          class="annotation"
          :class="`annotation-${annotation.type.toLowerCase()}`"
          :style="getAnnotationStyle(annotation)"
          :to="annotation.route"
          :title="annotation.title"
          :aria-label="annotation.title"
        >
          <img
            :src="annotation.thumbnail"
            class="annotationThumbnail"
            alt=""
          >
          <span
            class="annotationTitle"
            dir="auto"
          >
            <span class="annotationTitleText">{{ annotation.title }}</span>
          </span>
          <span
            v-if="annotation.badge"
            class="annotationBadge"
          >{{ annotation.badge }}</span>
        </RouterLink>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import { getVideoRect } from './annotationSurface'

const props = defineProps({
  annotations: {
    type: Array,
    default: () => []
  },
  currentTime: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  },
  videoAspectRatio: {
    type: Number,
    default: null
  },
  videoFit: {
    type: String,
    default: 'contain',
    validator: (value) => ['contain', 'cover'].includes(value)
  }
})

const { t } = useI18n()
const annotationsHidden = ref(false)
const annotationRoot = useTemplateRef('annotationRoot')
const containerWidth = ref(0)
const containerHeight = ref(0)

function measureAnnotationRoot() {
  if (!annotationRoot.value) {
    return
  }

  const { width, height } = annotationRoot.value.getBoundingClientRect()
  containerWidth.value = width
  containerHeight.value = height
}

const resizeObserver = new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect
  containerWidth.value = width
  containerHeight.value = height
})

const annotationSurfaceStyle = computed(() => {
  const rect = getVideoRect(containerWidth.value, containerHeight.value, props.videoAspectRatio, props.videoFit)

  if (!rect) {
    return undefined
  }

  return {
    insetInlineStart: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
})

watch(annotationRoot, (newRoot, oldRoot) => {
  if (oldRoot) {
    resizeObserver.unobserve(oldRoot)
  }
  if (newRoot) {
    resizeObserver.observe(newRoot)
    measureAnnotationRoot()
  }
}, { flush: 'post' })

watch(() => props.active, (active) => {
  if (active) {
    measureAnnotationRoot()
  }
}, { flush: 'post' })

onBeforeUnmount(() => resizeObserver.disconnect())

const activeAnnotations = computed(() => props.annotations.filter((annotation) => {
  return props.currentTime >= annotation.startTime && props.currentTime <= annotation.endTime
}))

const toggleLabel = computed(() => {
  return annotationsHidden.value
    ? t('Video.Player.Show Annotations')
    : t('Video.Player.Hide Annotations')
})

const buttonLabel = computed(() => {
  return annotationsHidden.value
    ? t('Video.Player.Show')
    : t('Video.Player.Hide')
})

function getAnnotationStyle(annotation) {
  return {
    insetInlineStart: `${annotation.left * 100}%`,
    top: `${annotation.top * 100}%`,
    width: `${annotation.width * 100}%`,
    aspectRatio: annotation.aspectRatio,
    '--channel-avatar-size': `${annotation.width * 100}cqw`
  }
}
</script>

<style scoped src="./FtVideoAnnotations.css" />
