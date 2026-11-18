<template>
  <div
    v-if="floating"
    class="capacitorTabSelectionFloating"
  >
    <div
      ref="toolbar"
      class="capacitorTabSelectionToolbar"
      role="toolbar"
    >
      <button
        v-for="action in actions"
        :key="action.name"
        type="button"
        class="capacitorTabSelectionToolbarButton"
        :disabled="busy"
        :aria-label="action.label"
        :title="action.label"
        @click="runToolbarAction($event, action.name)"
      >
        <FtIcon
          :icon="['fas', action.icon]"
          aria-hidden="true"
        />
      </button>
    </div>
    <button
      type="button"
      class="capacitorTabSelectionFab"
      :disabled="busy || count === 0"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click="emit('close')"
    >
      <FtIcon
        :icon="['fas', 'rectangle-xmark']"
        aria-hidden="true"
      />
    </button>
  </div>
  <div
    v-else
    ref="controlsRoot"
    class="capacitorTabSelectionControls"
    tabindex="-1"
    @keydown.esc="onEscape"
  >
    <button
      ref="moreButton"
      type="button"
      :disabled="busy || count === 0"
      :aria-expanded="showActions"
      @click="showActions ? closeActions() : showActions = true"
    >
      <FtIcon
        :icon="['fas', 'ellipsis-h']"
        aria-hidden="true"
      />
      {{ t('More') }}
    </button>
    <button
      type="button"
      :disabled="busy || count === 0"
      @click="$emit('close')"
    >
      <FtIcon
        :icon="['fas', 'rectangle-xmark']"
        aria-hidden="true"
      />
      {{ closeLabel }}
    </button>
    <button
      type="button"
      :disabled="busy"
      @click="$emit('cancel')"
    >
      <FtIcon
        :icon="['fas', 'xmark']"
        aria-hidden="true"
      />
      {{ t('Cancel') }}
    </button>
    <div
      v-if="showActions"
      v-overlay-scrollbars
      class="capacitorTabSelectionMenu"
      role="group"
      :aria-label="t('More')"
    >
      <button
        v-for="action in actions"
        :key="action.name"
        type="button"
        :disabled="busy"
        @click="run(action.name)"
      >
        <FtIcon
          :icon="['fas', action.icon]"
          aria-hidden="true"
        />
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  count: { type: Number, required: true },
  busy: { type: Boolean, default: false },
  canPin: { type: Boolean, default: false },
  canUnpin: { type: Boolean, default: false },
  canLoad: { type: Boolean, default: false },
  canUnload: { type: Boolean, default: false },
  // Phones show every action in a floating toolbar; the tablet tab strip keeps the compact row.
  floating: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'cancel', 'action'])
const { t } = useI18n()
const showActions = ref(false)
const moreButton = useTemplateRef('moreButton')
const controlsRoot = useTemplateRef('controlsRoot')
const actions = computed(() => [
  { name: 'pin', label: t('Context Menu.Pin Tabs'), icon: 'thumbtack', enabled: props.canPin },
  { name: 'unpin', label: t('Context Menu.Unpin Tabs'), icon: 'thumbtack-slash', enabled: props.canUnpin },
  { name: 'load', label: t('Context Menu.Load Tabs'), icon: 'download', enabled: props.canLoad },
  { name: 'unload', label: t('Context Menu.Unload Tabs'), icon: 'right-from-bracket', enabled: props.canUnload },
  { name: 'reload', label: t('Context Menu.Reload Tabs'), icon: 'sync', enabled: props.count > 0 },
].filter(action => action.enabled))
const toolbar = useTemplateRef('toolbar')
let refocusToolbar = false

function runToolbarAction(event, action) {
  refocusToolbar = event.currentTarget.matches(':focus')
  emit('action', action)
}

// The running action disables the focused button, and pinning or loading then swaps it
// for its opposite, so return focus to the toolbar once the buttons settle.
watch(() => [actions.value, props.busy], async () => {
  await nextTick()
  if (!refocusToolbar || props.busy) return
  refocusToolbar = false
  if (document.activeElement === document.body) {
    toolbar.value?.querySelector('button:enabled')?.focus({ preventScroll: true })
  }
})

const closeLabel = computed(() => props.count === 1 ? t('Close Tab') : t('Context Menu.Close Multiple Tabs', { count: props.count }, props.count))

async function closeActions() {
  showActions.value = false
  await nextTick()
  const target = moreButton.value?.disabled ? controlsRoot.value : moreButton.value
  target?.focus({ preventScroll: true })
}

function onEscape(event) {
  if (!showActions.value) return
  event.stopPropagation()
  event.preventDefault()
  closeActions()
}

async function run(action) {
  emit('action', action)
  await closeActions()
}
</script>

<style scoped>
.capacitorTabSelectionControls {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-inline: 8px;
  background-color: var(--card-bg-color);
}

.capacitorTabSelectionMenu {
  position: absolute;
  z-index: 10;
  inset-block-start: 100%;
  inset-inline-start: 8px;
  display: flex;
  flex-direction: column;
  inline-size: min(280px, calc(100vw - 16px));
  max-block-size: min(360px, 60vh);
  overflow-y: auto;
  padding: 8px;
  border-radius: var(--shape-corner-large);
  background-color: var(--card-bg-color);
  box-shadow: 0 4px 16px var(--primary-shadow-color);
}

.capacitorTabSelectionMenu button {
  justify-content: flex-start;
  flex: 0 0 auto;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-block-size: 48px;
  padding-inline: 8px;
  border: 0;
  border-radius: var(--shape-corner-small);
  color: var(--primary-text-color);
  background-color: transparent;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--motion-fast-effects), border-radius var(--motion-fast-spatial);
}

button:not(:disabled):is(:hover, :active, :focus-visible) {
  background-color: var(--side-nav-hover-color);
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

button:not(:disabled):active {
  border-radius: var(--shape-corner-extra-small);
}

.capacitorTabSelectionFloating {
  position: absolute;
  inset-block-end: max(16px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
  inset-inline: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  pointer-events: none;
  animation: capacitor-tab-selection-enter var(--motion-default-spatial) both;
}

.capacitorTabSelectionToolbar,
.capacitorTabSelectionFab {
  box-shadow: 0 3px 8px rgb(0 0 0 / 45%);
  pointer-events: auto;
}

.capacitorTabSelectionToolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-inline-size: 0;
  padding: 8px;
  border-radius: var(--shape-corner-full);
  color: var(--on-selected-container-color);
  background-color: var(--selected-container-color);
}

.capacitorTabSelectionToolbar .capacitorTabSelectionToolbarButton {
  flex: 0 1 48px;
  min-inline-size: 32px;
  block-size: 48px;
  padding: 0;
  border-radius: var(--shape-corner-full);
  color: inherit;
  font-size: 20px;
}

.capacitorTabSelectionToolbar .capacitorTabSelectionToolbarButton:not(:disabled):is(:hover, :active, :focus-visible) {
  background-color: var(--selected-container-hover-color);
}

.capacitorTabSelectionToolbar .capacitorTabSelectionToolbarButton:not(:disabled):active {
  border-radius: var(--shape-corner-medium);
}

.capacitorTabSelectionFloating .capacitorTabSelectionFab {
  flex: 0 0 auto;
  inline-size: 56px;
  block-size: 56px;
  padding: 0;
  border-radius: var(--shape-corner-large);
  color: var(--text-with-main-color);
  background-color: var(--primary-color);
  font-size: 22px;
}

.capacitorTabSelectionFloating .capacitorTabSelectionFab:not(:disabled):is(:hover, :active, :focus-visible) {
  background-color: var(--primary-color-hover);
}

.capacitorTabSelectionFloating .capacitorTabSelectionFab:not(:disabled):active {
  border-radius: var(--shape-corner-medium);
}

.capacitorTabSelectionFloating button:focus-visible {
  outline: 2px solid var(--focus-ring-contrast-color);
  outline-offset: -4px;
}

@keyframes capacitor-tab-selection-enter {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.9);
  }
}

:root[data-reduced-motion='reduce'] .capacitorTabSelectionFloating {
  animation: none;
}
</style>
