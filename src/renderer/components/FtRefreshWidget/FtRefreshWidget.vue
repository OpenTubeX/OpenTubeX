<template>
  <div
    class="floatingRefreshSection"
    :class="{ embedded: props.embedded }"
  >
    <p
      v-if="lastRefreshTimestamp"
      class="lastRefreshTimestamp"
    >
      {{ t('Feed.Feed Last Updated', { feedName: title, date: lastRefreshTimestamp }) }}
    </p>
    <div class="refreshActions">
      <div
        v-if="nextAutoRefreshTimestamp"
        class="nextAutoRefreshTimestamp"
        :title="nextAutoRefreshTooltip"
      >
        <span
          v-if="nextAutoRefreshAt && autoRefreshInterval"
          :key="countdownSpinKey"
          class="nextAutoRefreshCountdown"
          :class="{ finalMinute: isFinalMinute }"
          :style="countdownStyle"
          aria-hidden="true"
        >
          <svg viewBox="0 0 18 18">
            <circle
              class="countdownTrack"
              cx="9"
              cy="9"
              r="7"
            />
            <circle
              class="countdownProgress"
              cx="9"
              cy="9"
              r="7"
            />
            <g class="countdownHourglass">
              <path
                class="countdownHourglassOutline"
                d="M7 5h4M7 13h4M7.5 5c0 2 .5 2.75 1.5 4-1 1.25-1.5 2-1.5 4M10.5 5c0 2-.5 2.75-1.5 4 1 1.25 1.5 2 1.5 4"
              />
              <path
                class="countdownHourglassUpper"
                d="m7.75 6.5 1.25 2.25 1.25-2.25Z"
              />
              <path
                class="countdownHourglassLower"
                d="m9 9.25-1.25 2.25h2.5Z"
              />
            </g>
          </svg>
        </span>
        <p class="lastRefreshTimestamp">
          {{ t('Feed.Next Auto Refresh', { date: nextAutoRefreshTimestamp }) }}
        </p>
      </div>
      <FtIconButton
        :disabled="disableRefresh"
        :icon="['fas', 'sync']"
        class="refreshButton"
        :title="refreshFeedButtonTitle"
        :size="12"
        theme="primary"
        @click="click"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'

import { KeyboardShortcuts } from '../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../helpers/utils'

const props = defineProps({
  disableRefresh: {
    type: Boolean,
    default: false
  },
  lastRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTooltip: {
    type: String,
    default: ''
  },
  nextAutoRefreshAt: {
    type: Number,
    default: 0
  },
  autoRefreshInterval: {
    type: Number,
    default: 0
  },
  embedded: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * 7
const FINAL_MINUTE_MS = 60 * 1000
const now = ref(Date.now())
let countdownTicker = null

const remaining = computed(() => {
  return Math.max(props.nextAutoRefreshAt - now.value, 0)
})

const countdownSpinKey = computed(() => {
  const remainingMinutes = Math.ceil(remaining.value / FINAL_MINUTE_MS)
  return `${props.nextAutoRefreshAt}-${props.autoRefreshInterval}-${remainingMinutes}`
})

const isFinalMinute = computed(() => {
  return remaining.value <= FINAL_MINUTE_MS
})

const countdownStyle = computed(() => {
  const progress = Math.min(remaining.value / props.autoRefreshInterval, 1)

  return {
    '--countdown-offset': COUNTDOWN_CIRCUMFERENCE * (1 - progress)
  }
})

function updateCountdown() {
  now.value = Date.now()
}

onMounted(() => {
  countdownTicker = setInterval(updateCountdown, 1000)
  document.addEventListener('visibilitychange', updateCountdown)
})

onBeforeUnmount(() => {
  clearInterval(countdownTicker)
  document.removeEventListener('visibilitychange', updateCountdown)
})

const refreshFeedButtonTitle = computed(() => {
  return addKeyboardShortcutToActionTitle(
    t('Feed.Refresh Feed', { subscriptionName: props.title }),
    KeyboardShortcuts.APP.SITUATIONAL.REFRESH
  )
})

const emit = defineEmits(['click'])

function click() {
  emit('click')
}
</script>

<style scoped lang="scss" src="./FtRefreshWidget.scss" />
