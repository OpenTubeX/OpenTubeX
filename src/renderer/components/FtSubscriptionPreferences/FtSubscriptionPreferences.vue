<template>
  <div class="subscriptionPreferences">
    <div
      v-for="group in feedTypeGroups"
      :key="group.key"
      role="group"
      class="preferenceSection"
      :class="{ notificationsOff: group.key === 'notificationFeedTypes' && notificationsOff }"
      :aria-labelledby="`${id}-${group.key}`"
    >
      <p
        :id="`${id}-${group.key}`"
        class="preferenceLabel"
      >
        <FtIcon
          :icon="group.icon"
          aria-hidden="true"
        />
        {{ group.label }}
      </p>
      <div class="preferenceChips">
        <button
          v-for="feedType in feedTypes"
          :key="feedType.id"
          type="button"
          class="preferenceChip"
          role="checkbox"
          :aria-checked="group.states[feedType.id]"
          :disabled="group.key === 'notificationFeedTypes' && feedTypeStates[feedType.id] === false"
          @click="emit('toggle-feed-type', feedType.id, group.key)"
        >
          <FtIcon
            :icon="chipIcon(group.states[feedType.id], feedType.icon)"
            aria-hidden="true"
          />
          {{ feedType.label }}
        </button>
      </div>
    </div>
    <div
      role="group"
      class="preferenceSection"
      :aria-labelledby="`${id}-daily-limit`"
    >
      <p
        :id="`${id}-daily-limit`"
        class="preferenceLabel"
      >
        <FtIcon
          :icon="['fas', 'calendar-day']"
          aria-hidden="true"
        />
        {{ t('Channel.Videos per day') }}
      </p>
      <div class="dailyVideoLimit">
        <button
          v-for="option in ['global', 'unlimited']"
          :key="option"
          type="button"
          class="dailyVideoLimitOption"
          :aria-pressed="dailyVideoLimitValue === option"
          @click="emit('update-daily-video-limit', option)"
        >
          {{ option === 'global' ? t('Channel.Use global setting') : t('Channel.Unlimited') }}
        </button>
        <div
          class="dailyVideoLimitStepper"
          :class="{ active: dailyVideoLimitCount !== null }"
        >
          <button
            type="button"
            :title="t('Channel.Fewer videos per day')"
            :aria-label="t('Channel.Fewer videos per day')"
            :aria-disabled="dailyVideoLimitDraft <= 1"
            @click="stepDailyVideoLimit(-1)"
          >
            <FtIcon
              :icon="['fas', 'minus']"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="dailyVideoLimitCount"
            :aria-pressed="dailyVideoLimitCount !== null"
            @click="emit('update-daily-video-limit', String(dailyVideoLimitDraft))"
          >
            {{ dailyVideoLimitDraft }}
          </button>
          <button
            type="button"
            :title="t('Channel.More videos per day')"
            :aria-label="t('Channel.More videos per day')"
            :aria-disabled="dailyVideoLimitDraft >= MAX_DAILY_VIDEO_LIMIT"
            @click="stepDailyVideoLimit(1)"
          >
            <FtIcon
              :icon="['fas', 'plus']"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="showMembersOnly !== null"
      class="membersOnlyPreference"
    >
      <FtIcon
        class="membersOnlyIcon"
        :icon="['fas', 'users']"
        aria-hidden="true"
      />
      <FtToggleSwitch
        :label="t('Channel.Show members-only videos')"
        :default-value="showMembersOnly === true"
        :indeterminate="showMembersOnly === 'mixed'"
        compact
        trailing
        controlled
        @change="value => emit('update-show-members-only', value)"
      />
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import {
  formatSubscriptionDailyVideoLimit,
  getSubscriptionFeedTypeOptions,
  MAX_SUBSCRIPTION_DAILY_VIDEO_LIMIT as MAX_DAILY_VIDEO_LIMIT
} from '../../helpers/subscription-channels'

/** @typedef {boolean | 'mixed'} CheckState */

const props = defineProps({
  /** Checked state of each feed type, keyed by feed type. */
  feedTypeStates: {
    type: Object,
    required: true
  },
  /** Checked state of each notification feed type; `null` hides the section. */
  notificationFeedTypeStates: {
    type: Object,
    default: null
  },
  notificationsOff: {
    type: Boolean,
    default: false
  },
  /** A count, `null` for unlimited, `undefined` for the global setting, or `'mixed'`. */
  dailyVideoLimit: {
    type: [Number, String],
    default: undefined
  },
  /** `null` hides the members-only switch. */
  showMembersOnly: {
    type: [Boolean, String],
    default: null
  }
})

const emit = defineEmits(['toggle-feed-type', 'update-daily-video-limit', 'update-show-members-only'])

const { t } = useI18n()
const id = useId()

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))
const feedTypeGroups = computed(() => [
  { key: 'feedTypes', label: t('Channel.Show in subscription feed'), icon: ['fas', 'subscriptions'], states: props.feedTypeStates },
  ...(props.notificationFeedTypeStates
    ? [{ key: 'notificationFeedTypes', label: t('Channel.Notify about new uploads'), icon: ['fas', 'bell'], states: props.notificationFeedTypeStates }]
    : [])
])

/**
 * @param {CheckState} state
 * @param {string[]} feedTypeIcon
 */
function chipIcon(state, feedTypeIcon) {
  if (state === true) return ['fas', 'check']
  if (state === 'mixed') return ['fas', 'minus']
  return feedTypeIcon
}

const dailyVideoLimitValue = computed(() => (
  props.dailyVideoLimit === 'mixed' ? 'mixed' : formatSubscriptionDailyVideoLimit(props.dailyVideoLimit)
))
const dailyVideoLimitCount = computed(() => (
  typeof props.dailyVideoLimit === 'number' ? props.dailyVideoLimit : null
))
// The stepper keeps the last count while Global or Unlimited is selected.
// Bind it with v-model to remember the count while this component is unmounted.
const dailyVideoLimitDraft = defineModel('dailyVideoLimitDraft', { type: Number })
watch(dailyVideoLimitCount, (count) => {
  if (count !== null || dailyVideoLimitDraft.value === undefined) dailyVideoLimitDraft.value = count ?? 1
}, { immediate: true })

/** @param {number} step */
function stepDailyVideoLimit(step) {
  const count = Math.min(MAX_DAILY_VIDEO_LIMIT, Math.max(1, dailyVideoLimitDraft.value + step))
  if (count === dailyVideoLimitDraft.value) return
  dailyVideoLimitDraft.value = count
  emit('update-daily-video-limit', String(count))
}
</script>

<style scoped src="./preferenceChips.css" />
<style scoped src="./FtSubscriptionPreferences.css" />
