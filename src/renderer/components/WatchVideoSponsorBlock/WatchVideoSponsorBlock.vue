<template>
  <section class="sponsorBlockPanel">
    <header class="sponsorBlockHeader">
      <div class="sponsorBlockHeading">
        <span
          class="sponsorBlockShield"
          aria-hidden="true"
        >
          <ft-icon :icon="['fas', 'shield-halved']" />
        </span>
        <h3>{{ $t('Video.Player.SponsorBlock.InfoPanelTitle') }}</h3>
      </div>
      <div class="sponsorBlockHeaderActions">
        <button
          type="button"
          :disabled="loading || contributionStatsLoading"
          :aria-label="$t('Video.Player.SponsorBlock.RefreshInfo')"
          :title="$t('Video.Player.SponsorBlock.RefreshInfo')"
          @click="$emit('refresh')"
        >
          <ft-icon
            :icon="['fas', 'sync']"
            :spin="loading || contributionStatsLoading"
          />
        </button>
        <button
          type="button"
          :aria-label="$t('Close')"
          :title="$t('Close')"
          @click="$emit('close')"
        >
          <ft-icon :icon="['fas', 'xmark']" />
        </button>
      </div>
    </header>
    <div
      ref="contentScroller"
      v-overlay-scrollbars
      class="sponsorBlockContent"
    >
      <div
        class="sponsorBlockSubtitle"
      >
        {{ loading
          ? $t('Video.Player.SponsorBlock.InfoPanelLoading')
          : segments.length > 0
            ? $t('Video.Player.SponsorBlock.InfoPanelHasSegments')
            : $t('Video.Player.SponsorBlock.InfoPanelNoSegments') }}
      </div>
      <section
        class="sponsorBlockContributionStats"
        :aria-busy="String(contributionStatsLoading || !contributionStatsLoaded)"
      >
        <h4>{{ $t('Video.Player.SponsorBlock.ContributionStatsTitle') }}</h4>
        <div
          v-if="contributionStatsLoading || !contributionStatsLoaded"
          class="sponsorBlockContributionStatsStatus"
          role="status"
        >
          <ft-icon
            :icon="['fas', 'sync']"
            spin
            aria-hidden="true"
          />
          {{ $t('Video.Player.SponsorBlock.ContributionStatsLoading') }}
        </div>
        <div
          v-else-if="contributionStatsError"
          class="sponsorBlockContributionStatsStatus"
          role="status"
        >
          {{ $t('Video.Player.SponsorBlock.ContributionStatsError') }}
        </div>
        <div
          v-else-if="contributionStats === null"
          class="sponsorBlockContributionStatsStatus"
        >
          {{ $t('Video.Player.SponsorBlock.ContributionStatsNoUserId') }}
        </div>
        <dl
          v-else
          class="sponsorBlockContributionStatsGrid"
        >
          <div class="sponsorBlockContributionMetric">
            <dt>{{ $t('Video.Player.SponsorBlock.Submissions') }}</dt>
            <dd>{{ formatNumber(contributionStats.segmentCount) }}</dd>
          </div>
          <div class="sponsorBlockContributionMetric">
            <dt>{{ $t('Video.Player.SponsorBlock.Segments') }}</dt>
            <dd>{{ formatNumber(contributionStats.viewCount) }}</dd>
          </div>
          <div class="sponsorBlockContributionMetric">
            <dt>{{ $t('Video.Player.SponsorBlock.TimeSaved') }}</dt>
            <dd>{{ formatMinutesSaved(contributionStats.minutesSaved) }}</dd>
          </div>
        </dl>
      </section>
      <div
        v-if="loading && segments.length === 0"
        class="sponsorBlockLoading"
        role="status"
      >
        <ft-icon
          :icon="['fas', 'sync']"
          spin
        />
      </div>
      <div
        v-else
        class="sponsorBlockSegments"
      >
        <div
          v-for="segment in segments"
          :key="segment.uuid"
          class="sponsorBlockSegment"
          :class="{
            passed: isSegmentPassed(segment),
            selected: selectedUuid === segment.uuid
          }"
        >
          <button
            type="button"
            class="sponsorBlockSegmentSummary"
            :aria-expanded="String(selectedUuid === segment.uuid)"
            @click="selectSegment(segment.uuid)"
          >
            <span
              class="sponsorBlockDot"
              :style="{ backgroundColor: segment.color }"
            />
            <span class="sponsorBlockCategory">
              {{ segment.description || segment.translatedCategory }}
              <ft-icon
                v-if="segment.locked"
                class="sponsorBlockLocked"
                :icon="['fas', 'lock']"
                :title="$t('Video.Player.SponsorBlock.LockedSegment')"
              />
            </span>
            <span class="sponsorBlockTime">{{ segment.timeLabel }}</span>
          </button>
          <div
            v-if="selectedUuid === segment.uuid"
            class="sponsorBlockVoteActions"
          >
            <button
              type="button"
              class="sponsorBlockCollapseActions"
              :aria-label="$t('Video.Player.SponsorBlock.CloseSegmentActions')"
              :title="$t('Video.Player.SponsorBlock.CloseSegmentActions')"
              @click="selectSegment(segment.uuid)"
            />
            <button
              v-if="submissionEnabled"
              type="button"
              class="sponsorBlockVoteButton"
              :class="{ active: segment.userVote === 1 }"
              :disabled="pendingUuid !== null"
              :aria-label="$t('Video.Player.SponsorBlock.UpvoteSegment')"
              :title="$t('Video.Player.SponsorBlock.UpvoteSegment')"
              @click="$emit('vote', segment.uuid, 1)"
            >
              <ft-icon :icon="['fas', 'thumbs-up']" />
            </button>
            <button
              v-if="submissionEnabled"
              type="button"
              class="sponsorBlockVoteButton"
              :class="{ active: segment.userVote === 0 }"
              :disabled="pendingUuid !== null"
              :aria-label="$t('Video.Player.SponsorBlock.DownvoteSegment')"
              :title="$t('Video.Player.SponsorBlock.DownvoteSegment')"
              @click="$emit('vote', segment.uuid, 0)"
            >
              <ft-icon :icon="['fas', 'thumbs-down']" />
            </button>
            <button
              v-if="!isSponsorBlockFullVideoSegment(segment)"
              type="button"
              class="sponsorBlockVoteButton sponsorBlockSkipButton"
              :aria-label="segment.actionType === 'mute'
                ? $t('Video.Player.SponsorBlock.MuteSegment')
                : $t('Video.Player.SponsorBlock.SkipSegment')"
              :title="segment.actionType === 'mute'
                ? $t('Video.Player.SponsorBlock.MuteSegment')
                : $t('Video.Player.SponsorBlock.SkipSegment')"
              @click="$emit('skip', segment.uuid)"
            >
              <ft-icon :icon="['fas', segment.actionType === 'mute' ? 'volume-xmark' : 'forward-fast']" />
            </button>
          </div>
        </div>
      </div>
      <footer
        ref="contentEnd"
        class="sponsorBlockFooter"
      >
        <div class="sponsorBlockFooterOptions">
          <div class="sponsorBlockOption">
            <label
              class="sponsorBlockToggle"
              :class="{ disabled: channelWhitelisted }"
            >
              <input
                id="sponsorBlockAutoSkip"
                class="sponsorBlockToggleInput"
                type="checkbox"
                :checked="!autoSkipDisabled"
                :disabled="channelWhitelisted"
                :aria-label="$t('Video.Player.SponsorBlock.AutoSkipEnabled')"
                @change="$emit('auto-skip-change', $event.target.checked)"
              >
              <span
                class="sponsorBlockToggleTrack"
                aria-hidden="true"
              >
                <span class="sponsorBlockToggleThumb">
                  <ft-icon :icon="['fas', autoSkipDisabled ? 'pause' : 'forward-fast']" />
                </span>
              </span>
            </label>
            <label
              for="sponsorBlockAutoSkip"
              class="sponsorBlockOptionLabel"
              :class="{ muted: channelWhitelisted }"
            >
              {{ $t('Video.Player.SponsorBlock.AutoSkipEnabled') }}
              <span class="sponsorBlockOptionState">
                {{ autoSkipDisabled
                  ? $t('Video.Player.SponsorBlock.AutoSkipOff')
                  : $t('Video.Player.SponsorBlock.AutoSkipOn') }}
              </span>
            </label>
          </div>
          <div class="sponsorBlockOption">
            <button
              type="button"
              class="sponsorBlockWhitelistButton"
              :class="{ active: channelWhitelisted }"
              :disabled="!canWhitelistChannel"
              :aria-pressed="String(channelWhitelisted)"
              :aria-label="channelWhitelisted
                ? $t('Video.Player.SponsorBlock.RemoveChannelFromWhitelist')
                : $t('Video.Player.SponsorBlock.WhitelistChannel')"
              :title="channelWhitelisted
                ? $t('Video.Player.SponsorBlock.RemoveChannelFromWhitelist')
                : $t('Video.Player.SponsorBlock.WhitelistChannel')"
              @click="$emit('channel-whitelist-change', !channelWhitelisted)"
            >
              <span
                class="sponsorBlockWhitelistBadge"
                aria-hidden="true"
              >
                <ft-icon :icon="['fas', channelWhitelisted ? 'check' : 'plus']" />
              </span>
              <span class="sponsorBlockWhitelistLabel">
                {{ channelWhitelisted
                  ? $t('Video.Player.SponsorBlock.ChannelWhitelisted')
                  : $t('Video.Player.SponsorBlock.WhitelistChannel') }}
              </span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  </section>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isSponsorBlockFullVideoSegment } from '../../helpers/player/sponsorBlockFullVideo'
import { formatNumber } from '../../helpers/utils'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  autoSkipDisabled: Boolean,
  canWhitelistChannel: Boolean,
  channelWhitelisted: Boolean,
  contributionStats: {
    type: Object,
    default: null
  },
  contributionStatsError: Boolean,
  contributionStatsLoaded: Boolean,
  contributionStatsLoading: Boolean,
  currentTime: {
    type: Number,
    default: 0
  },
  loading: Boolean,
  pendingUuid: {
    type: String,
    default: null
  },
  segments: {
    type: Array,
    default: () => []
  },
  submissionEnabled: Boolean
})

defineEmits(['auto-skip-change', 'channel-whitelist-change', 'close', 'refresh', 'skip', 'vote'])

const selectedUuid = ref(null)
const { t } = useI18n()
const contentScroller = useTemplateRef('contentScroller')
const contentEnd = useTemplateRef('contentEnd')
let clampFrame = null
let contentResizeObserver = null

function scheduleScrollClamp() {
  nextTick(() => {
    clampFrame ??= requestAnimationFrame(() => {
      clampFrame = null
      if (contentScroller.value && contentEnd.value) {
        clampOverlayScrollTop(contentScroller.value, contentEnd.value)
      }
    })
  })
}

onMounted(() => {
  scheduleScrollClamp()
  if (contentScroller.value) {
    contentResizeObserver = new ResizeObserver(scheduleScrollClamp)
    contentResizeObserver.observe(contentScroller.value)
  }
})

watch(
  () => [
    props.loading,
    props.segments.length,
    props.contributionStats,
    props.contributionStatsError,
    props.contributionStatsLoaded,
    props.contributionStatsLoading,
    selectedUuid.value,
  ],
  scheduleScrollClamp
)

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
  if (clampFrame !== null) {
    cancelAnimationFrame(clampFrame)
  }
})

function formatMinutesSaved(minutes) {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(minutes, 0) : 0
  const totalMinutes = Math.round(safeMinutes)
  if (safeMinutes > 0 && totalMinutes === 0) {
    return t('Stats.Less than a minute')
  }

  const hours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60
  if (hours === 0) {
    return t('Stats.Minutes', { minutes: remainingMinutes })
  }
  if (remainingMinutes === 0) {
    return t('Stats.Hours', { hours })
  }

  return t('Stats.Hours and minutes', { hours, minutes: remainingMinutes })
}

function selectSegment(uuid) {
  selectedUuid.value = selectedUuid.value === uuid ? null : uuid
}

function isSegmentPassed(segment) {
  if (isSponsorBlockFullVideoSegment(segment)) {
    return false
  }

  const endTime = segment.actionType === 'poi' ? segment.startTime : segment.endTime
  return Number.isFinite(endTime) && props.currentTime >= endTime
}
</script>

<style scoped>
.sponsorBlockPanel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-inline-size: 0;
  max-inline-size: 100%;
  max-block-size: 500px;
  overflow: hidden;
  color: var(--primary-text-color);
  background-color: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  border-radius: calc(8px * var(--ui-roundness));
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}

.sponsorBlockHeader {
  display: flex;
  flex: 0 0 52px;
  align-items: center;
  justify-content: space-between;
  padding-inline: 14px 8px;
  border-block-end: 1px solid var(--side-nav-hover-color);
}

.sponsorBlockHeading,
.sponsorBlockHeaderActions {
  display: flex;
  align-items: center;
}

.sponsorBlockHeading {
  gap: 9px;
}

.sponsorBlockHeading h3 {
  margin: 0;
  font-size: 18px;
}

.sponsorBlockShield {
  color: #ff3636;
  font-size: 20px;
}

.sponsorBlockHeaderActions button {
  display: grid;
  place-items: center;
  inline-size: 36px;
  block-size: 36px;
  padding-block: 0;
  padding-inline: 0;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
}

.sponsorBlockHeaderActions button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.sponsorBlockHeaderActions button:hover:not(:disabled),
.sponsorBlockHeaderActions button:focus-visible:not(:disabled) {
  background-color: var(--side-nav-hover-color);
}

.sponsorBlockSubtitle {
  margin: 0;
  padding-block: 11px 8px;
  padding-inline: 16px;
  color: var(--secondary-text-color);
  font-size: 13px;
}

.sponsorBlockLoading {
  display: grid;
  min-block-size: 110px;
  place-items: center;
  color: var(--secondary-text-color);
  font-size: 22px;
}

.sponsorBlockContent {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
}

.sponsorBlockContributionStats {
  margin-block: 2px 8px;
  margin-inline: 8px;
  padding-block: 10px;
  padding-inline: 10px;
  background-color: var(--secondary-card-bg-color);
  backdrop-filter: var(--secondary-card-bg-blur, none);
  border-radius: calc(6px * var(--ui-roundness));
}

.sponsorBlockContributionStats h4 {
  margin-block: 0 12px;
  font-size: 13px;
}

.sponsorBlockContributionStatsStatus {
  display: flex;
  align-items: center;
  gap: 7px;
  min-block-size: 42px;
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.4;
}

.sponsorBlockContributionStatsGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.sponsorBlockContributionMetric {
  display: grid;
  grid-row: span 2;
  grid-template-rows: subgrid;
  row-gap: 4px;
  min-inline-size: 0;
  padding-inline: 8px;
  text-align: center;
}

.sponsorBlockContributionMetric + .sponsorBlockContributionMetric {
  border-inline-start: 1px solid var(--side-nav-hover-color);
}

.sponsorBlockContributionMetric dt {
  color: var(--secondary-text-color);
  font-size: 12px;
  line-height: 1.25;
}

.sponsorBlockContributionMetric dd {
  align-self: center;
  min-inline-size: 0;
  margin: 0;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.sponsorBlockSegments {
  padding-block: 4px 10px;
  padding-inline: 8px;
}

.sponsorBlockSegment {
  border-radius: calc(6px * var(--ui-roundness));
}

.sponsorBlockSegment:hover,
.sponsorBlockSegment.selected {
  background-color: var(--side-nav-hover-color);
}

.sponsorBlockSegment.passed {
  opacity: 0.58;
}

.sponsorBlockSegment.passed:hover {
  opacity: 0.78;
}

.sponsorBlockSegmentSummary {
  display: grid;
  grid-template-columns: 9px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  inline-size: 100%;
  min-block-size: 39px;
  padding-block: 7px;
  padding-inline: 8px;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: inherit;
  cursor: pointer;
  font: inherit;
  text-align: start;
}

.sponsorBlockDot {
  inline-size: 9px;
  block-size: 9px;
  border-radius: 50%;
}

.sponsorBlockCategory {
  min-inline-size: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sponsorBlockLocked {
  margin-inline-start: 4px;
  color: var(--secondary-text-color);
  font-size: 10px;
}

.sponsorBlockTime {
  color: var(--secondary-text-color);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.sponsorBlockVoteActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding-block: 0 8px;
  padding-inline: 26px 8px;
}

.sponsorBlockCollapseActions {
  align-self: stretch;
  flex: 1;
  min-inline-size: 24px;
  padding-block: 0;
  padding-inline: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.sponsorBlockVoteButton {
  display: grid;
  place-items: center;
  inline-size: 32px;
  block-size: 28px;
  padding-block: 0;
  padding-inline: 0;
  color: inherit;
  background-color: var(--secondary-card-bg-color);
  backdrop-filter: var(--secondary-card-bg-blur, none);
  border: 0;
  border-radius: calc(6px * var(--ui-roundness));
  cursor: pointer;
}

.sponsorBlockVoteButton:disabled {
  cursor: wait;
  opacity: 0.55;
}

.sponsorBlockVoteButton:hover:not(:disabled),
.sponsorBlockVoteButton:focus-visible:not(:disabled) {
  color: var(--accent-color);
  background-color: color-mix(in srgb, var(--accent-color) 24%, var(--card-bg-color));
}

.sponsorBlockVoteButton.active {
  color: var(--accent-color);
  background-color: color-mix(in srgb, var(--accent-color) 38%, var(--card-bg-color));
}

.sponsorBlockVoteButton.active:hover:not(:disabled),
.sponsorBlockVoteButton.active:focus-visible:not(:disabled) {
  background-color: color-mix(in srgb, var(--accent-color) 50%, var(--card-bg-color));
}

.sponsorBlockSkipButton {
  color: var(--accent-color);
}

.sponsorBlockFooter {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding-block: 9px;
  padding-inline: 14px;
}

.sponsorBlockFooterOptions {
  display: flex;
  inline-size: 100%;
}

.sponsorBlockOption {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-inline-size: 0;
  padding-inline: 8px;
}

.sponsorBlockToggle {
  position: relative;
  display: block;
  inline-size: 44px;
  block-size: 24px;
  cursor: pointer;
}

.sponsorBlockToggle.disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.sponsorBlockOptionLabel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}

.sponsorBlockOptionLabel.muted {
  cursor: not-allowed;
  opacity: 0.4;
}

.sponsorBlockOptionState {
  color: var(--secondary-text-color);
  font-size: 11px;
  font-weight: 600;
}

.sponsorBlockWhitelistButton {
  display: flex;
  align-items: center;
  gap: 10px;
  inline-size: 100%;
  min-block-size: 48px;
  padding-block: 8px;
  padding-inline: 10px 12px;
  color: var(--primary-text-color);
  background-color: var(--secondary-card-bg-color);
  backdrop-filter: var(--secondary-card-bg-blur, none);
  border: 1px solid transparent;
  border-radius: calc(10px * var(--ui-roundness));
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: start;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.sponsorBlockWhitelistButton:hover:not(:disabled),
.sponsorBlockWhitelistButton:focus-visible:not(:disabled) {
  border-color: var(--accent-color);
}

.sponsorBlockWhitelistButton:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.sponsorBlockWhitelistButton.active {
  background-color: color-mix(in srgb, #00a846 14%, var(--card-bg-color));
  border-color: #00a846;
}

.sponsorBlockWhitelistButton:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.sponsorBlockWhitelistBadge {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  inline-size: 30px;
  block-size: 30px;
  color: var(--secondary-text-color);
  background-color: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  border-radius: calc(8px * var(--ui-roundness));
  font-size: 13px;
  transition: background-color 160ms ease, color 160ms ease;
}

.sponsorBlockWhitelistButton.active .sponsorBlockWhitelistBadge {
  color: #fff;
  background-color: #00a846;
}

.sponsorBlockWhitelistLabel {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-inline-size: 0;
  min-block-size: 2.5em;
  overflow-wrap: break-word;
  line-height: 1.25;
  text-align: center;
}

.sponsorBlockToggleInput {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}

.sponsorBlockToggleTrack {
  position: relative;
  display: block;
  inline-size: 44px;
  block-size: 24px;
  background-color: var(--secondary-card-bg-color);
  backdrop-filter: var(--secondary-card-bg-blur, none);
  border: 1px solid var(--side-nav-hover-color);
  border-radius: calc(999px * var(--ui-roundness));
  transition: background-color 160ms ease, border-color 160ms ease;
}

.sponsorBlockToggleThumb {
  position: absolute;
  inset-block-start: 2px;
  inset-inline-start: 2px;
  display: grid;
  place-items: center;
  inline-size: 18px;
  block-size: 18px;
  color: #555;
  background-color: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
  font-size: 8px;
  transition: transform 160ms ease;
}

.sponsorBlockToggleInput:checked + .sponsorBlockToggleTrack {
  background-color: #00a846;
  border-color: #00c853;
}

.sponsorBlockToggleInput:checked + .sponsorBlockToggleTrack .sponsorBlockToggleThumb {
  color: #007732;
  transform: translateX(calc(20px * var(--horizontal-directionality-coefficient)));
}

.sponsorBlockToggleInput:focus-visible + .sponsorBlockToggleTrack {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
</style>
