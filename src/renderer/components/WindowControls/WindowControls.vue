<template>
  <template v-if="!fullScreen">
    <div
      v-for="side in SIDES"
      v-show="buttons[side].length > 0"
      :key="side"
      class="windowControls"
      :class="[style, side, { inactive: !focused }]"
      :style="metricsStyle"
    >
      <button
        v-for="control in buttons[side]"
        :key="control"
        type="button"
        class="windowControl"
        :class="control"
        :aria-label="labels[control]"
        :title="labels[control]"
        @click="windowControls.run(control)"
      >
        <svg
          v-if="style === 'breeze'"
          viewBox="0 0 18 18"
          aria-hidden="true"
        >
          <mask :id="`${maskId}-${control}`">
            <rect
              width="18"
              height="18"
              fill="white"
            />
            <path
              class="maskGlyph"
              :d="glyphs[control]"
            />
          </mask>
          <!-- Breeze cuts the glyph out of the hover circle, except on close. -->
          <circle
            class="hoverCircle"
            cx="9"
            cy="9"
            r="9"
            :mask="control === 'close' ? undefined : `url(#${maskId}-${control})`"
          />
          <path
            class="glyph"
            :d="glyphs[control]"
          />
        </svg>
        <svg
          v-else
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            class="glyph"
            :d="glyphs[control]"
          />
        </svg>
      </button>
    </div>
  </template>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import { parseWindowButtonLayout } from '../../helpers/windowControls'

const emit = defineEmits(['insets'])

const SIDES = /** @type {const} */ (['left', 'right'])

/** Button width, spacing and distance from the window edge in CSS pixels */
const METRICS = {
  breeze: { size: 24, gap: 2, edge: 5 },
  adwaita: { size: 24, gap: 6, edge: 7 }
}

const GLYPHS = {
  breeze: {
    minimize: 'M4.5 7 9 11.5 13.5 7',
    maximize: 'M4.5 11 9 6.5 13.5 11',
    restore: 'M9 4.5 13.5 9 9 13.5 4.5 9Z',
    close: 'M5.5 5.5 12.5 12.5M12.5 5.5 5.5 12.5'
  },
  adwaita: {
    minimize: 'M4.5 11.25H11.5',
    maximize: 'M5.25 4.5H10.75Q11.5 4.5 11.5 5.25V10.75Q11.5 11.5 10.75 11.5H5.25Q4.5 11.5 4.5 10.75V5.25Q4.5 4.5 5.25 4.5Z',
    restore: 'M6.5 4.5H10.75Q11.5 4.5 11.5 5.25V9.5M5.25 6.5H8.75Q9.5 6.5 9.5 7.25V10.75Q9.5 11.5 8.75 11.5H5.25Q4.5 11.5 4.5 10.75V7.25Q4.5 6.5 5.25 6.5Z',
    close: 'M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5'
  }
}

const { t } = useI18n()

const windowControls = window.ftElectron.windowControls
const style = windowControls.style
const maskId = useId()

const layout = ref('')
const maximized = ref(false)
const fullScreen = ref(false)
const focused = ref(document.hasFocus())

const metricsStyle = {
  '--window-control-size': `${METRICS[style].size}px`,
  '--window-control-gap': `${METRICS[style].gap}px`,
  '--window-control-edge': `${METRICS[style].edge}px`
}

const buttons = computed(() => parseWindowButtonLayout(layout.value))

const glyphs = computed(() => ({
  ...GLYPHS[style],
  maximize: maximized.value ? GLYPHS[style].restore : GLYPHS[style].maximize
}))

const labels = computed(() => ({
  minimize: t('Minimize'),
  maximize: maximized.value ? t('Restore') : t('Maximize'),
  close: t('Close')
}))

/** @param {{ layout: string, maximized: boolean, fullScreen: boolean } | null} state */
function applyState(state) {
  if (!state) return
  layout.value = state.layout
  maximized.value = state.maximized
  fullScreen.value = state.fullScreen
}

// The bars beside the controls keep this much space free at each window edge.
watchEffect(() => {
  const { size, gap, edge } = METRICS[style]
  /** @param {number} count */
  const inset = count => (fullScreen.value || count === 0 ? 0 : count * size + (count - 1) * gap + 2 * edge)
  emit('insets', {
    left: inset(buttons.value.left.length),
    right: inset(buttons.value.right.length)
  })
})

/** @type {(() => void)[]} */
const cleanups = []

onMounted(async () => {
  cleanups.push(
    windowControls.onState(applyState),
    window.ftElectron.handleWindowFocusedState(value => { focused.value = value })
  )
  applyState(await windowControls.getState())
})

onBeforeUnmount(() => {
  cleanups.forEach(cleanup => cleanup())
})
</script>

<style scoped src="./WindowControls.css" />
