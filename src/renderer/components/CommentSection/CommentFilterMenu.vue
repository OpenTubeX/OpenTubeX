<template>
  <div
    class="commentFilterMenuAnchor"
    :class="{ commentHeaderIconActionAligned: aligned }"
    @focusout="handleFocusout"
    @keydown.esc.stop.prevent="closeAndFocusTrigger"
  >
    <button
      ref="trigger"
      type="button"
      :class="[
        fullscreen ? 'fullscreenCommentAction' : 'commentHeaderIconAction',
        { active: hasActiveFilters }
      ]"
      :aria-label="$t('Comments.Filter loaded comments')"
      :title="$t('Comments.Filter loaded comments')"
      aria-haspopup="dialog"
      :aria-expanded="String(open)"
      @click="emit('update:open', !open)"
    >
      <FtIcon :icon="['fas', 'filter']" />
    </button>
    <div
      v-if="open"
      ref="menu"
      class="commentFilterMenu"
      :class="{ fullscreenCommentFilterMenu: fullscreen }"
      role="dialog"
      :aria-label="$t('Comments.Comment filters')"
    >
      <button
        type="button"
        role="checkbox"
        :aria-checked="searchOpen"
        @click="emit('toggle-search')"
      >
        <span
          class="commentFilterMenuIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="['fas', 'magnifying-glass']" />
        </span>
        <span>{{ $t('Comments.Search loaded comments') }}</span>
        <FtIcon
          v-if="searchOpen"
          :icon="['fas', 'check']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        role="checkbox"
        :aria-checked="creatorCommentsOnly"
        @click="emit('toggle-creator')"
      >
        <span
          class="commentFilterMenuIcon"
          aria-hidden="true"
        >
          <FtRetryImage
            v-if="channelThumbnail"
            :src="channelThumbnail"
            class="commentCreatorFilterAvatar"
          />
          <FtIcon
            v-else
            :icon="['fas', 'circle-user']"
          />
        </span>
        <span>{{ $t('Comments.From creator') }}</span>
        <FtIcon
          v-if="creatorCommentsOnly"
          :icon="['fas', 'check']"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        role="checkbox"
        :aria-checked="timestampCommentsOnly"
        @click="emit('toggle-timestamps')"
      >
        <span
          class="commentFilterMenuIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="['fas', 'clock']" />
        </span>
        <span>{{ $t('Comments.Contains timestamps') }}</span>
        <FtIcon
          v-if="timestampCommentsOnly"
          :icon="['fas', 'check']"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, useTemplateRef, watch } from 'vue'

import FtRetryImage from '../FtRetryImage.vue'

const props = defineProps({
  open: {
    type: Boolean,
    required: true
  },
  fullscreen: {
    type: Boolean,
    default: false
  },
  aligned: {
    type: Boolean,
    default: false
  },
  channelThumbnail: {
    type: String,
    default: ''
  },
  creatorCommentsOnly: {
    type: Boolean,
    required: true
  },
  timestampCommentsOnly: {
    type: Boolean,
    required: true
  },
  searchOpen: {
    type: Boolean,
    required: true
  }
})

const trigger = useTemplateRef('trigger')
const menu = useTemplateRef('menu')
const hasActiveFilters = computed(() => {
  return props.searchOpen || props.creatorCommentsOnly || props.timestampCommentsOnly
})
const emit = defineEmits([
  'update:open',
  'toggle-search',
  'toggle-creator',
  'toggle-timestamps'
])

watch(() => props.open, (open) => {
  if (open) {
    nextTick(() => menu.value?.querySelector('button')?.focus())
  }
})

function handleFocusout(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    emit('update:open', false)
  }
}

function closeAndFocusTrigger() {
  emit('update:open', false)
  nextTick(() => trigger.value?.focus())
}

function focusTrigger() {
  trigger.value?.focus()
}

defineExpose({ focusTrigger })
</script>

<style scoped src="./CommentSection.css" />
