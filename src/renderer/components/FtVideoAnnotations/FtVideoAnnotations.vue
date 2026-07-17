<template>
  <div
    v-if="activeAnnotations.length > 0"
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
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'

const props = defineProps({
  annotations: {
    type: Array,
    default: () => []
  },
  currentTime: {
    type: Number,
    default: 0
  }
})

const { t } = useI18n()
const annotationsHidden = ref(false)

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
