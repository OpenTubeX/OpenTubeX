<template>
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
  <div
    class="tab"
    :data-tab-id="tab.id"
    :class="{
      active: tab.isActive,
      loading: tab.isLoading,
      unloaded: tab.isUnloaded,
      playing: tab.isPlaying,
      dragging: isDragging,
      settling: isSettling,
      noTransition: suppressTransition
    }"
    :style="tabStyle"
    :title="displayTitle"
    role="button"
    tabindex="-1"
    @click="handleClick"
    @auxclick.prevent="handleAuxClick"
  >
    <span class="tabTitle">
      <span
        v-if="tab.isLoading"
        class="loadingDot"
        aria-hidden="true"
      />
      <FontAwesomeIcon
        v-else-if="tab.isPlaying"
        :icon="['fas', 'play']"
        class="playingIcon"
        aria-hidden="true"
      />
      {{ displayTitle }}
    </span>
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
  },
  offset: {
    type: Number,
    default: 0
  },
  isDragging: {
    type: Boolean,
    default: false
  },
  isSettling: {
    type: Boolean,
    default: false
  },
  suppressTransition: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['activate', 'close', 'middleClick'])

const tabStyle = computed(() => {
  const transform = props.offset !== 0 ? `translate3d(${props.offset}px, 0, 0)` : ''
  return {
    transform: transform || undefined
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

function handleClick() {
  emit('activate', props.tab.id)
}

/**
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
  transition: background-color 0.15s ease, transform 0.2s ease;
  position: relative;
  user-select: none;
  touch-action: none;
  will-change: transform;
}

.tab.noTransition {
  transition: background-color 0.15s ease;
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

.tab.loading {
  opacity: 0.8;
}

.tab.unloaded .tabTitle {
  color: var(--secondary-text-color);
  opacity: 0.72;
}

.tab.unloaded:hover .tabTitle,
.tab.unloaded.active .tabTitle,
.tab.unloaded.loading .tabTitle {
  opacity: 1;
}

.tab.active::after {
  opacity: 1;
}

.tab.dragging {
  z-index: 10;
  cursor: grabbing;
  transition: background-color 0.15s ease;
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
}

.tab.settling {
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

.loadingDot {
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  border-radius: 50%;
  margin-inline-end: 6px;
  background-color: var(--accent-color, var(--primary-text-color));
  animation: tab-loading-pulse 0.9s ease-in-out infinite;
  vertical-align: middle;
}

@keyframes tab-loading-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.5;
  }

  50% {
    transform: scale(1);
    opacity: 1;
  }

  100% {
    transform: scale(0.7);
    opacity: 0.5;
  }
}

.playingIcon {
  font-size: 8px;
  margin-inline-end: 6px;
  color: var(--accent-color, var(--primary-text-color));
  flex-shrink: 0;
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
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab:hover .closeButton,
.tab.active .closeButton {
  opacity: 1;
}

.closeIcon {
  font-size: 10px;
}
</style>
