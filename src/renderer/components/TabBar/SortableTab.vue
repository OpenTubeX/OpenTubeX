<template>
  <div
    ref="elementRef"
    class="tab"
    :class="{ active: tab.isActive, dragging: isDragging }"
    :title="displayTitle"
    role="button"
    tabindex="0"
    @click="handleClick"
    @keydown.enter.prevent="handleClick"
    @keydown.space.prevent="handleClick"
    @auxclick.prevent="handleAuxClick"
    @pointerdown="handleDragStart"
  >
    <span class="tabTitle">{{ displayTitle }}</span>
    <button
      class="closeButton"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click.stop="$emit('close', tab.id)"
      @pointerdown.stop
    >
      <FontAwesomeIcon
        :icon="['fas', 'times']"
        class="closeIcon"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useDraggable } from '@vue-dnd-kit/core'
import packageDetails from '@root/package.json'

const props = defineProps({
  tab: {
    type: Object,
    required: true
  },
  closeLabel: {
    type: String,
    default: 'Close Tab'
  },
  index: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['activate', 'close', 'middleClick'])

const {
  elementRef,
  isDragging,
  handleDragStart
} = useDraggable({
  id: props.tab.id,
  data: {
    index: props.index,
    tabId: props.tab.id
  }
})

const displayTitle = computed(() => {
  const title = props.tab.title
  if (!title) return title
  const suffix = ` - ${packageDetails.productName}`
  if (title.endsWith(suffix)) {
    return title.slice(0, -suffix.length)
  }
  return title
})

/**
 * Handle click to activate tab
 */
function handleClick() {
  // Don't activate if we just finished dragging
  if (!isDragging.value) {
    emit('activate', props.tab.id)
  }
}

/**
 * Handle middle click to close tab
 * @param {MouseEvent} event
 */
function handleAuxClick(event) {
  if (event.button === 1) {
    emit('middleClick', event, props.tab.id)
  }
}
</script>

<style scoped>
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: 10px;
  padding-block: 6px;
  background-color: var(--bg-color);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  min-inline-size: 100px;
  max-inline-size: 200px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-block-end: 0;
  transition: background-color 0.15s ease;
  position: relative;
  user-select: none;
}

.tab::after {
  content: '';
  position: absolute;
  inset-block-end: -1px;
  inset-inline: 0;
  block-size: 1px;
  background-color: var(--bg-color);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tab:hover {
  background-color: var(--card-bg-color);
}

.tab.active {
  background-color: var(--card-bg-color);
  border-color: var(--tertiary-text-color);
}

.tab.active::after {
  opacity: 1;
}

.tab.dragging {
  opacity: 0.5;
  z-index: 10;
}

.tabTitle {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--primary-text-color);
}

.closeButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  color: var(--tertiary-text-color);
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.closeButton:hover {
  background-color: var(--destructive-text-color);
  color: var(--text-with-main-color);
}

.tab:hover .closeButton,
.tab.active .closeButton {
  opacity: 1;
}

.closeIcon {
  font-size: 10px;
}
</style>
