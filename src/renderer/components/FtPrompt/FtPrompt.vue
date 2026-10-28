<template>
  <Teleport
    v-if="settingsOverlayActive"
    :to="teleportTarget"
  >
    <div
      ref="prompt"
      class="prompt"
      :class="{ lockScroll }"
      tabindex="-1"
      :inert="inert"
      @vue:before-mount="preparePrompt"
      @vue:mounted="activatePrompt"
      @vue:before-unmount="deactivatePrompt"
      @pointerdown.stop
      @touchstart.stop
      @touchend.stop
      @dblclick.stop
      @click.stop="handleClick"
      @keydown.enter.stop="($event.target === $event.currentTarget) && hide()"
      @keydown.space.stop
      @keydown.left.right.capture="handleArrowKeys"
    >
      <FtCard
        ref="promptCard"
        v-overlay-scrollbars="!fixedLayout"
        class="promptCard"
        :class="{ autosize, fixedLayout, [theme]: true, [cardClass]: cardClass !== '' }"
        :inert="busy"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="id"
      >
        <slot
          name="label"
          :label-id="id"
        >
          <h2
            :id="id"
            class="center"
          >
            {{ label }}
          </h2>
        </slot>

        <template v-if="fixedLayout">
          <div
            ref="promptContentScroller"
            v-overlay-scrollbars="contentScrollable"
            :class="contentScrollable ? 'promptContentScroller' : 'promptManagedContent'"
          >
            <div class="promptContent">
              <slot />
            </div>
          </div>
          <div class="promptFixedFooter">
            <slot name="footer" />
          </div>
        </template>
        <slot v-else>
          <p
            v-for="extraLabel in extraLabels"
            :key="extraLabel"
            class="center"
          >
            <strong>
              {{ extraLabel }}
            </strong>
          </p>
          <FtFlexBox>
            <FtButton
              v-for="(option, index) in optionNames"
              :key="index"
              :label="option"
              :text-color="optionButtonTextColor(index)"
              :background-color="optionButtonBackgroundColor(index)"
              :theme="index === 0 && isFirstOptionDestructive ? 'destructive' : ''"
              :icon="optionIcons[index] ?? (index === 0 && isFirstOptionDestructive ? ['fas', 'trash'] : null)"
              @click="click(optionValues[index])"
            />
          </FtFlexBox>
        </slot>
      </FtCard>
    </div>
  </Teleport>
</template>

<script setup>
import { inject, nextTick, useId, useTemplateRef } from 'vue'

import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useFullscreenTeleportTarget } from '../../composables/useFullscreenTeleportTarget'
import { useSettingsOverlay } from '../../composables/useSettingsOverlay'
import store from '../../store/index'

import FtCard from '../ft-card/ft-card.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import { lockBodyScroll, unlockBodyScroll } from './scrollLock'

const props = defineProps({
  label: {
    type: String,
    default: ''
  },
  extraLabels: {
    type: Array,
    default: () => []
  },
  optionNames: {
    type: Array,
    default: () => []
  },
  optionValues: {
    type: Array,
    default: () => []
  },
  optionIcons: {
    type: Array,
    default: () => []
  },
  autosize: {
    type: Boolean,
    default: false
  },
  isFirstOptionDestructive: {
    type: Boolean,
    default: false
  },
  theme: {
    type: String,
    default: 'base'
  },
  cardClass: {
    type: String,
    default: ''
  },
  inert: {
    type: Boolean,
    default: false
  },
  busy: {
    type: Boolean,
    default: false
  },
  lockScroll: {
    type: Boolean,
    default: true
  },
  contentScrollable: { type: Boolean, default: true },
  fixedLayout: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click'])
const settingsOverlayActive = useSettingsOverlay(() => emit('click', null))

const id = useId()
const teleportTarget = useFullscreenTeleportTarget(() => emit('click', null), () => props.busy || !isTopmostPrompt())

const promptCard = useTemplateRef('promptCard')
const promptContentScroller = useTemplateRef('promptContentScroller')
const prompt = useTemplateRef('prompt')

let promptButtons = []
let lastActiveElement = null
let promptContentResizeObserver = null
let scrollLocked = false
let registered = false

function preparePrompt() {
  if (props.lockScroll && settingsOverlayActive.value) {
    lockBodyScroll()
    scrollLocked = true
  }
}

function activatePrompt() {
  if (!settingsOverlayActive.value || !prompt.value?.isConnected) return
  lastActiveElement = document.activeElement
  document.addEventListener('keydown', handleEscape, true)
  store.commit('addOpenPrompt', id)
  registered = true

  nextTick(() => {
    if (!settingsOverlayActive.value || !promptCard.value) return
    promptButtons = Array.from(promptCard.value.$el.querySelectorAll('.btn.ripple, .iconButton'))
    focusItem(0)

    const scroller = promptContentScroller.value
    const content = scroller?.firstElementChild
    if (scroller && content && typeof ResizeObserver === 'function') {
      const clampScroll = () => clampOverlayScrollTop(scroller, content)
      promptContentResizeObserver = new ResizeObserver(clampScroll)
      promptContentResizeObserver.observe(scroller)
      promptContentResizeObserver.observe(content)
      clampScroll()
    }
  })
}

function deactivatePrompt() {
  promptContentResizeObserver?.disconnect()
  promptContentResizeObserver = null
  document.removeEventListener('keydown', handleEscape, true)
  if (registered) {
    store.commit('removeOpenPrompt', id)
    registered = false
    nextTick(() => {
      if (settingsOverlayActive.value) lastActiveElement?.focus()
    })
  }
  if (scrollLocked) {
    unlockBodyScroll()
    scrollLocked = false
  }
}

/**
 * @param {number} index
 */
function optionButtonTextColor(index) {
  if (index === 0 && props.isFirstOptionDestructive) {
    return 'var(--destructive-text-color)'
  } else if (index < props.optionNames.length - 1) {
    return 'var(--text-with-accent-color)'
  } else {
    return null
  }
}

/**
 * @param {number} index
 */
function optionButtonBackgroundColor(index) {
  if (index === 0 && props.isFirstOptionDestructive) {
    return 'var(--destructive-color)'
  } else if (index < props.optionNames.length - 1) {
    return 'var(--accent-color)'
  } else {
    return null
  }
}

/**
 * @param {any} value
 */
function click(value) {
  if (props.busy) return
  emit('click', value)
}

function hide() {
  click(null)
}

// Clicks stop at the prompt so handlers outside it ignore them, which also
// hides them from the document link handler. Run that handler here instead.
const handleDocumentClick = inject('handleDocumentClick')

/**
 * @param {MouseEvent} event
 */
function handleClick(event) {
  if (event.target === event.currentTarget) hide()
  else handleDocumentClick(event)
}

/**
 * @param {number} index
 */
function focusItem(index) {
  if (promptButtons.length === 0) return

  if (index < 0) {
    index = promptButtons.length - 1
  } else if (index >= promptButtons.length) {
    index = 0
  }

  promptButtons[index]?.focus()
  store.dispatch('showOutlines')
}

function isTopmostPrompt() {
  return [...document.querySelectorAll('.prompt:not([inert])')].at(-1) === prompt.value
}

/**
 * @param {KeyboardEvent} event
 */
function handleEscape(event) {
  if (event.target instanceof Element && event.target.closest('dialog[open]')) return
  if (event.key === 'Escape' && !props.inert && !event.defaultPrevented && isTopmostPrompt()) {
    event.preventDefault()
    hide()
  }
}

/**
 * @param {KeyboardEvent} event
 */
function handleArrowKeys(event) {
  const currentIndex = promptButtons.indexOf(event.target)

  // Only react if a button was focused when the arrow key was pressed
  if (currentIndex === -1) {
    return
  }

  event.preventDefault()

  const direction = (event.key === 'ArrowLeft') ? -1 : 1
  focusItem(currentIndex + direction)
}
</script>

<style scoped src="./FtPrompt.css" />
