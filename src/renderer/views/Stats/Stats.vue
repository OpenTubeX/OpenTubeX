<template>
  <div>
    <FtCard class="statsPage">
      <h2>
        <FontAwesomeIcon
          :icon="['fas', 'chart-line']"
          class="headingIcon"
        />
        {{ t('Stats.Stats') }}
      </h2>

      <section
        class="summaryGrid"
        :aria-label="t('Stats.Watch time summary')"
      >
        <article
          v-for="summary in summaries"
          :key="summary.label"
          class="summaryCard"
        >
          <span class="summaryLabel">{{ summary.label }}</span>
          <strong>{{ formatDuration(summary.seconds) }}</strong>
          <span class="summaryHint">{{ summary.hint }}</span>
        </article>
      </section>

      <section class="chartGrid">
        <article class="chartCard dailyChartCard">
          <div class="chartHeading">
            <div>
              <p class="eyebrow">
                {{ t('Stats.Day by day') }}
              </p>
              <h2>{{ t('Stats.Last 14 days') }}</h2>
            </div>
            <span class="chartScale">
              {{ t('Stats.Highest', { duration: formatDuration(dailyMaximum) }) }}
            </span>
          </div>

          <div
            v-if="hasData"
            class="lineChart"
            role="group"
            :aria-label="t('Stats.Daily chart aria')"
          >
            <div class="lineChartPlot">
              <svg
                viewBox="0 0 700 220"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient
                    id="watchTimeArea"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stop-color="var(--primary-color)"
                      stop-opacity="0.38"
                    />
                    <stop
                      offset="100%"
                      stop-color="var(--primary-color)"
                      stop-opacity="0"
                    />
                  </linearGradient>
                </defs>
                <line
                  v-for="gridY in [30, 83, 136, 190]"
                  :key="gridY"
                  x1="10"
                  :y1="gridY"
                  x2="690"
                  :y2="gridY"
                  class="gridLine"
                />
                <path
                  :d="dailyChart.area"
                  class="chartArea"
                />
                <polyline
                  :points="dailyChart.points"
                  class="chartLine"
                />
              </svg>
              <button
                v-for="(point, index) in dailyChart.data"
                :key="point.date"
                type="button"
                class="chartPoint"
                :class="{
                  tooltipStart: index < 2,
                  tooltipEnd: index > dailyChart.data.length - 3,
                  tooltipBelow: point.y < 70,
                }"
                :style="{
                  insetInlineStart: `${(point.x / 700) * 100}%`,
                  insetBlockStart: `${(point.y / 220) * 100}%`,
                }"
                :aria-label="formatDataLabel(point.fullLabel, point.seconds)"
              >
                <span
                  class="chartTooltip"
                  role="tooltip"
                >
                  <strong>{{ point.fullLabel }}</strong>
                  <span>{{ formatDuration(point.seconds) }}</span>
                </span>
              </button>
            </div>
            <div
              class="dailyLabels"
              aria-hidden="true"
            >
              <span
                v-for="(day, index) in dailyData"
                :key="day.date"
                :class="{ hiddenLabel: index % 2 !== 0 }"
              >
                {{ day.label }}
              </span>
            </div>
          </div>
          <p
            v-else
            class="emptyState"
          >
            {{ t('Stats.No data') }}
          </p>
        </article>

        <article class="chartCard weeklyChartCard">
          <div class="chartHeading">
            <div>
              <p class="eyebrow">
                {{ t('Stats.Week by week') }}
              </p>
              <h2>{{ t('Stats.Last 8 weeks') }}</h2>
            </div>
            <span class="chartScale">
              {{ t('Stats.Highest', { duration: formatDuration(weeklyMaximum) }) }}
            </span>
          </div>

          <div
            class="barChart"
            role="group"
            :aria-label="t('Stats.Weekly chart aria')"
          >
            <div
              v-for="(week, index) in weeklyData"
              :key="week.date"
              class="barColumn"
            >
              <button
                type="button"
                class="barTarget"
                :class="{
                  tooltipStart: index === 0,
                  tooltipEnd: index === weeklyData.length - 1,
                  tooltipBelow: week.percentage > 75,
                }"
                :style="{ '--bar-height': `${week.percentage}%` }"
                :aria-label="formatDataLabel(week.fullLabel, week.seconds)"
              >
                <span class="barTrack">
                  <span class="bar" />
                </span>
                <span
                  class="chartTooltip"
                  role="tooltip"
                >
                  <strong>{{ week.fullLabel }}</strong>
                  <span>{{ formatDuration(week.seconds) }}</span>
                </span>
              </button>
              <span>{{ week.label }}</span>
            </div>
          </div>
        </article>
      </section>

      <footer class="statsFooter">
        <div
          v-if="hasHistoricalEstimate"
          class="estimateControls"
        >
          <p class="estimateNote">
            {{ t('Stats.Estimate note') }}
          </p>
          <button
            type="button"
            class="adjustEstimateButton"
            @click="openHistoricalAdjustment"
          >
            {{ t('Stats.Adjust imported watch time') }}
          </button>
        </div>
        <button
          type="button"
          class="resetStatsButton"
          @click="showResetPrompt = true"
        >
          <FontAwesomeIcon :icon="['fas', 'trash']" />
          {{ t('Stats.Reset statistics') }}
        </button>
      </footer>
      <FtPrompt
        v-if="showResetPrompt"
        autosize
        :label="t('Stats.Reset confirmation')"
        :option-names="resetPromptNames"
        :option-values="RESET_PROMPT_VALUES"
        is-first-option-destructive
        @click="handleResetStats"
      />
      <FtPrompt
        v-if="showHistoricalAdjustment"
        :label="t('Stats.Imported watch time')"
        autosize
        @click="showHistoricalAdjustment = false"
      >
        <div class="historicalAdjustment">
          <p>{{ t('Stats.Imported watch time explanation') }}</p>
          <FtSelect
            :placeholder="t('Stats.Playback speed')"
            :value="selectedPlaybackSpeed"
            :select-names="playbackSpeedNames"
            :select-values="playbackSpeedValues"
            :icon="['fas', 'gauge-high']"
            @change="selectedPlaybackSpeed = $event"
          />
          <p class="channelSpeedNote">
            {{ t('Stats.Channel speed note') }}
          </p>
          <div class="adjustmentActions">
            <FtButton
              :label="t('Stats.Apply playback speed')"
              @click="applyHistoricalAdjustment"
            />
            <FtButton
              :label="t('Cancel')"
              background-color="var(--secondary-card-bg-color)"
              text-color="var(--primary-text-color)"
              @click="showHistoricalAdjustment = false"
            />
          </div>
        </div>
      </FtPrompt>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import store from '../../store'
import { showToast } from '../../helpers/utils'

const { locale, t } = useI18n()
const router = useRouter()

const DAY_SECONDS = 24 * 60 * 60
const RESET_PROMPT_VALUES = ['reset', 'cancel']

const watchSecondsByDate = computed(() => store.getters.getWatchSecondsByDate)
const hasData = computed(() => Object.values(watchSecondsByDate.value).some(seconds => seconds > 0))
const hasHistoricalEstimate = computed(() => store.getters.getHasHistoricalWatchTimeEstimate)
const historicalPlaybackSpeed = computed(() => store.getters.getHistoricalWatchTimePlaybackSpeed)
const defaultPlaybackSpeed = computed(() => store.getters.getDefaultPlayback)
const channelPlaybackSpeeds = computed(() => store.getters.getChannelPlaybackSpeeds)
const playbackSpeedInterval = computed(() => store.getters.getVideoPlaybackRateInterval)
const maximumPlaybackSpeed = computed(() => store.getters.getMaxVideoPlaybackRate)
const statsWeekStartsOn = computed(() => Number(store.getters.getStatsWeekStartsOn))
const watchStatsVisible = computed(() => {
  return store.getters.getRememberHistory && store.getters.getEnableWatchStats
})
const showResetPrompt = ref(false)
const showHistoricalAdjustment = ref(false)
const selectedPlaybackSpeed = ref('1')
const hasShownHistoricalAdjustment = ref(false)
const statsPageMounted = ref(false)
const resetPromptNames = computed(() => [t('Stats.Reset'), t('Cancel')])

const playbackSpeedValues = computed(() => {
  const speeds = []
  const interval = Math.max(Number(playbackSpeedInterval.value), 0.05)
  for (let speed = interval; speed <= maximumPlaybackSpeed.value; speed += interval) {
    speeds.push(Number(speed.toFixed(2)))
  }

  const selectedSpeed = Number(selectedPlaybackSpeed.value)
  if (Number.isFinite(selectedSpeed) && !speeds.includes(selectedSpeed)) {
    speeds.push(selectedSpeed)
    speeds.sort((a, b) => a - b)
  }

  return speeds.map(String)
})
const playbackSpeedNames = computed(() => playbackSpeedValues.value.map(speed => `${speed}×`))

watch(watchStatsVisible, (visible) => {
  if (!visible) {
    router.replace('/history')
  }
}, { immediate: true })

watch([hasHistoricalEstimate, historicalPlaybackSpeed], maybeOpenHistoricalAdjustment)

onMounted(() => {
  statsPageMounted.value = true
  maybeOpenHistoricalAdjustment()
})

function maybeOpenHistoricalAdjustment() {
  if (!statsPageMounted.value ||
    !hasHistoricalEstimate.value ||
    historicalPlaybackSpeed.value !== null ||
    hasShownHistoricalAdjustment.value) {
    return
  }

  hasShownHistoricalAdjustment.value = true
  openHistoricalAdjustment()
}

function openHistoricalAdjustment() {
  selectedPlaybackSpeed.value = String(historicalPlaybackSpeed.value ?? defaultPlaybackSpeed.value)
  showHistoricalAdjustment.value = true
}

async function applyHistoricalAdjustment() {
  let parsedChannelSpeeds = {}
  try {
    parsedChannelSpeeds = JSON.parse(channelPlaybackSpeeds.value || '{}')
  } catch (error) {
    console.error('Failed to parse channel playback speeds:', error)
  }

  const adjusted = await store.dispatch('adjustHistoricalWatchTime', {
    defaultSpeed: Number(selectedPlaybackSpeed.value),
    channelPlaybackSpeeds: parsedChannelSpeeds,
  })
  if (!adjusted) { return }

  showHistoricalAdjustment.value = false
  showToast({ message: t('Stats.Imported watch time adjusted'), icon: ['fas', 'chart-line'] })
}

/**
 * @param {'reset' | 'cancel' | null} option
 */
async function handleResetStats(option) {
  showResetPrompt.value = false
  if (option !== 'reset') { return }

  await store.dispatch('clearWatchStats')
  showToast({ message: t('Stats.Reset success'), icon: ['fas', 'undo'] })
}

function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function fromDateKey(date) {
  return new Date(`${date}T00:00:00`)
}

function startOfWeek(date) {
  const result = new Date(date)
  const daysSinceStart = (result.getDay() - statsWeekStartsOn.value + 7) % 7
  result.setDate(result.getDate() - daysSinceStart)
  result.setHours(0, 0, 0, 0)
  return result
}

function formatDuration(seconds) {
  if (seconds <= 0) { return t('Stats.Minutes', { minutes: 0 }) }
  if (seconds < 60) { return t('Stats.Less than a minute') }

  return formatWholeMinutes(Math.round(seconds / 60))
}

function formatWholeMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return t('Stats.Minutes', { minutes })
  }

  if (minutes === 0) {
    return t('Stats.Hours', { hours })
  }

  return t('Stats.Hours and minutes', { hours, minutes })
}

function formatDataLabel(label, seconds) {
  return `${label}: ${formatDuration(seconds)}`
}

const totalSeconds = computed(() => {
  return Object.values(watchSecondsByDate.value).reduce((total, seconds) => total + seconds, 0)
})

const todaySeconds = computed(() => watchSecondsByDate.value[toDateKey(new Date())] ?? 0)

const currentWeekSeconds = computed(() => {
  const weekStart = startOfWeek(new Date())
  return Object.entries(watchSecondsByDate.value).reduce((total, [date, seconds]) => {
    return fromDateKey(date) >= weekStart ? total + seconds : total
  }, 0)
})

const dailyAverageSeconds = computed(() => {
  const dates = Object.keys(watchSecondsByDate.value).sort()
  if (dates.length === 0) { return 0 }

  const firstDay = fromDateKey(dates[0])
  const today = startOfDay(new Date())
  const firstDayUtc = Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate())
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const elapsedDays = Math.round((todayUtc - firstDayUtc) / (DAY_SECONDS * 1000)) + 1
  return totalSeconds.value / Math.max(elapsedDays, 1)
})

function startOfDay(date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

const summaries = computed(() => [
  { label: t('Stats.Today'), seconds: todaySeconds.value, hint: t('Stats.So far today') },
  {
    label: t('Stats.This week'),
    seconds: currentWeekSeconds.value,
    hint: t('Stats.Since', {
      day: new Intl.DateTimeFormat(locale.value, { weekday: 'long' }).format(startOfWeek(new Date())),
    }),
  },
  { label: t('Stats.Total watch time'), seconds: totalSeconds.value, hint: t('Stats.All recorded time') },
  { label: t('Stats.Daily average'), seconds: dailyAverageSeconds.value, hint: t('Stats.Per calendar day') },
])

const dailyData = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  const fullFormatter = new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' })
  const today = startOfDay(new Date())

  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - 13 + index)
    const dateKey = toDateKey(date)

    return {
      date: dateKey,
      label: formatter.format(date).slice(0, 2),
      fullLabel: fullFormatter.format(date),
      seconds: watchSecondsByDate.value[dateKey] ?? 0,
    }
  })
})

const dailyMaximum = computed(() => Math.max(...dailyData.value.map(day => day.seconds), 0))

const dailyChart = computed(() => {
  const maximum = dailyMaximum.value || 1
  const data = dailyData.value.map((day, index) => ({
    ...day,
    x: 10 + index * (680 / 13),
    y: 190 - (day.seconds / maximum) * 160,
  }))
  const points = data.map(point => `${point.x},${point.y}`).join(' ')
  const area = `M 10 190 L ${points.replaceAll(' ', ' L ')} L 690 190 Z`

  return { area, data, points }
})

const weeklyTotals = computed(() => {
  const labelFormatter = new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' })
  const fullFormatter = new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' })
  const currentWeek = startOfWeek(new Date())
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(currentWeek)
    date.setDate(date.getDate() - (7 - index) * 7)
    return {
      date: toDateKey(date),
      label: labelFormatter.format(date),
      fullLabel: fullFormatter.format(date),
      seconds: 0,
    }
  })

  Object.entries(watchSecondsByDate.value).forEach(([date, seconds]) => {
    const weekKey = toDateKey(startOfWeek(fromDateKey(date)))
    const week = weeks.find(item => item.date === weekKey)
    if (week) { week.seconds += seconds }
  })

  return weeks
})

const weeklyMaximum = computed(() => Math.max(...weeklyTotals.value.map(week => week.seconds), 0))

const weeklyData = computed(() => weeklyTotals.value.map(week => ({
  ...week,
  percentage: weeklyMaximum.value === 0 ? 0 : Math.max((week.seconds / weeklyMaximum.value) * 100, week.seconds > 0 ? 3 : 0),
})))
</script>

<style scoped src="./Stats.css" />
