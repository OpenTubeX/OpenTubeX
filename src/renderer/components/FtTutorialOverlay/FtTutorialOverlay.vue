<template>
  <Teleport to=".app">
    <div
      class="tutorialOverlay"
      :class="{ centered: targetRect === null }"
      role="presentation"
      @keydown.capture="handleKeydown"
    >
      <div
        v-if="targetRect"
        class="tutorialHighlight"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <FtCard
        ref="cardRef"
        class="tutorialCard"
        :style="cardStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
      >
        <div
          v-if="steps.length > 1"
          class="tutorialProgress"
          aria-hidden="true"
        >
          <span
            v-for="(_, index) in steps"
            :key="index"
            :class="{ active: index === stepIndex }"
          />
        </div>
        <div
          class="tutorialIcon"
          aria-hidden="true"
        >
          <FontAwesomeIcon :icon="step.icon" />
        </div>
        <h2
          :id="titleId"
          ref="titleRef"
          tabindex="-1"
        >
          {{ step.title }}
        </h2>
        <p :id="descriptionId">
          {{ step.description }}
        </p>
        <div class="tutorialActions">
          <FtButton
            v-if="steps.length > 1"
            :label="t('Tutorial.Skip')"
            :text-color="null"
            :background-color="null"
            @click="finishTutorial"
          />
          <FtButton
            ref="primaryButtonRef"
            :label="primaryButtonLabel"
            :icon="isLastStep ? ['fas', 'check'] : ['fas', 'arrow-right']"
            @click="advanceTutorial"
          />
        </div>
      </FtCard>
    </div>
  </Teleport>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'

import FtButton from '../FtButton/FtButton.vue'
import FtCard from '../ft-card/ft-card.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  newInstallation: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const titleId = useId()
const descriptionId = useId()
const promptId = useId()
const cardRef = useTemplateRef('cardRef')
const primaryButtonRef = useTemplateRef('primaryButtonRef')
const titleRef = useTemplateRef('titleRef')
const stepIndex = ref(0)
const targetRect = ref(null)
const cardStyle = ref({})
let updateFrame = null
let lastActiveElement = null

const newUserSteps = computed(() => [
  {
    icon: ['fas', 'play'],
    title: t('Tutorial.Welcome.Title'),
    description: t('Tutorial.Welcome.Description'),
    target: null
  },
  {
    icon: ['fas', 'rss'],
    title: t('Tutorial.Navigation.Title'),
    description: t('Tutorial.Navigation.Description'),
    target: '[data-tutorial="navigation"]'
  },
  {
    icon: ['fas', 'search'],
    title: t('Tutorial.Search.Title'),
    description: t('Tutorial.Search.Description'),
    target: '[data-tutorial="search"]'
  },
  ...(process.env.IS_ELECTRON
    ? [{
        icon: ['fas', 'clone'],
        title: t('Tutorial.Tabs.Title'),
        description: t('Tutorial.Tabs.Description'),
        target: '[data-tutorial="tabs"]'
      }]
    : []),
  {
    icon: ['fas', 'sliders-h'],
    title: t('Tutorial.Quick Settings.Title'),
    description: t('Tutorial.Quick Settings.Description'),
    target: '[data-tutorial="quick-settings"]'
  }
])

const returningUserSteps = computed(() => [{
  icon: ['fas', 'sliders-h'],
  title: t('Tutorial.Settings Moved.Title'),
  description: t('Tutorial.Settings Moved.Description'),
  target: '[data-tutorial="quick-settings"]'
}])

const steps = computed(() => props.newInstallation ? newUserSteps.value : returningUserSteps.value)
const step = computed(() => steps.value[stepIndex.value])
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1)
const primaryButtonLabel = computed(() => {
  if (!props.newInstallation) return t('Tutorial.Got It')
  return isLastStep.value ? t('Tutorial.Finish') : t('Tutorial.Next')
})

const highlightStyle = computed(() => {
  if (targetRect.value === null) return {}

  return {
    insetBlockStart: `${targetRect.value.top}px`,
    left: `${targetRect.value.left}px`,
    inlineSize: `${targetRect.value.width}px`,
    blockSize: `${targetRect.value.height}px`,
    borderRadius: targetRect.value.borderRadius
  }
})

onMounted(() => {
  lastActiveElement = document.activeElement
  lockBodyScroll()
  store.commit('addOpenPrompt', promptId)
  window.addEventListener('resize', schedulePositionUpdate)
  window.addEventListener('scroll', schedulePositionUpdate, true)
  document.addEventListener('keydown', handleDocumentKeydown, true)
  updatePosition()
  nextTick(() => primaryButtonRef.value?.$el.focus())
})

onBeforeUnmount(() => {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  window.removeEventListener('resize', schedulePositionUpdate)
  window.removeEventListener('scroll', schedulePositionUpdate, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  nextTick(() => lastActiveElement?.focus())
})

function schedulePositionUpdate() {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(() => {
    updateFrame = null
    updatePosition()
  })
}

async function updatePosition() {
  const target = step.value.target === null
    ? null
    : Array.from(document.querySelectorAll(step.value.target)).find(element => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
  const rect = target?.getBoundingClientRect()
  targetRect.value = rect && rect.width > 0 && rect.height > 0
    ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: getComputedStyle(target).borderRadius
      }
    : null

  cardStyle.value = {}
  await nextTick()

  if (targetRect.value === null) return

  const card = cardRef.value?.$el
  if (!card) return

  const cardRect = card.getBoundingClientRect()
  const gap = 14
  const cardViewportPadding = 12
  const availableBelow = window.innerHeight - targetRect.value.top - targetRect.value.height
  const top = availableBelow >= cardRect.height + gap
    ? targetRect.value.top + targetRect.value.height + gap
    : Math.max(cardViewportPadding, targetRect.value.top - cardRect.height - gap)
  const idealLeft = targetRect.value.left + targetRect.value.width / 2 - cardRect.width / 2
  const left = Math.min(
    window.innerWidth - cardRect.width - cardViewportPadding,
    Math.max(cardViewportPadding, idealLeft)
  )

  cardStyle.value = {
    insetBlockStart: `${top}px`,
    left: `${left}px`
  }
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
  }
}

function handleKeydown(event) {
  event.stopPropagation()

  if (event.key !== 'Tab') return

  const buttons = Array.from(cardRef.value?.$el.querySelectorAll('.btn') ?? [])
  if (buttons.length === 0) return

  const currentIndex = buttons.indexOf(document.activeElement)
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
    : (currentIndex === -1 || currentIndex === buttons.length - 1 ? 0 : currentIndex + 1)

  event.preventDefault()
  buttons[nextIndex].focus()
  store.dispatch('showOutlines')
}

function advanceTutorial() {
  if (isLastStep.value) {
    finishTutorial()
    return
  }

  stepIndex.value++
  updatePosition()
  nextTick(() => titleRef.value?.focus())
}

function finishTutorial() {
  emit('close')
}
</script>

<style scoped src="./FtTutorialOverlay.css" />
