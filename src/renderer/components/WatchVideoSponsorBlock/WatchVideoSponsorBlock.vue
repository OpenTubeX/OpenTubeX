<template>
  <section class="sponsorBlockPanel">
    <header class="sponsorBlockHeader">
      <div class="sponsorBlockHeading">
        <span
          class="sponsorBlockShield"
          aria-hidden="true"
        >
          <font-awesome-icon :icon="['fas', 'shield-halved']" />
        </span>
        <h3>{{ $t('Video.Player.SponsorBlock.InfoPanelTitle') }}</h3>
      </div>
      <div class="sponsorBlockHeaderActions">
        <button
          type="button"
          :disabled="loading"
          :aria-label="$t('Video.Player.SponsorBlock.RefreshSegments')"
          :title="$t('Video.Player.SponsorBlock.RefreshSegments')"
          @click="$emit('refresh')"
        >
          <font-awesome-icon
            :icon="['fas', 'sync']"
            :spin="loading"
          />
        </button>
        <button
          type="button"
          :aria-label="$t('Close')"
          :title="$t('Close')"
          @click="$emit('close')"
        >
          <font-awesome-icon :icon="['fas', 'xmark']" />
        </button>
      </div>
    </header>
    <p class="sponsorBlockSubtitle">
      {{ loading
        ? $t('Video.Player.SponsorBlock.InfoPanelLoading')
        : segments.length > 0
          ? $t('Video.Player.SponsorBlock.InfoPanelHasSegments')
          : $t('Video.Player.SponsorBlock.InfoPanelNoSegments') }}
    </p>
    <div
      v-if="loading && segments.length === 0"
      class="sponsorBlockLoading"
      role="status"
    >
      <font-awesome-icon
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
            <font-awesome-icon
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
            <font-awesome-icon :icon="['fas', 'thumbs-up']" />
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
            <font-awesome-icon :icon="['fas', 'thumbs-down']" />
          </button>
          <button
            type="button"
            class="sponsorBlockVoteButton sponsorBlockSkipButton"
            :aria-label="$t('Video.Player.SponsorBlock.SkipSegment')"
            :title="$t('Video.Player.SponsorBlock.SkipSegment')"
            @click="$emit('skip', segment.uuid)"
          >
            <font-awesome-icon :icon="['fas', 'forward-fast']" />
          </button>
        </div>
      </div>
    </div>
    <footer class="sponsorBlockFooter">
      <label class="sponsorBlockAutoSkip">
        <input
          class="sponsorBlockAutoSkipInput"
          type="checkbox"
          :checked="!autoSkipDisabled"
          :aria-label="$t('Video.Player.SponsorBlock.AutoSkipEnabled')"
          @change="$emit('auto-skip-change', $event.target.checked)"
        >
        <span
          class="sponsorBlockAutoSkipTrack"
          aria-hidden="true"
        >
          <span class="sponsorBlockAutoSkipThumb">
            <font-awesome-icon :icon="['fas', autoSkipDisabled ? 'pause' : 'forward-fast']" />
          </span>
        </span>
      </label>
      <span class="sponsorBlockAutoSkipLabel">
        {{ $t('Video.Player.SponsorBlock.AutoSkipEnabled') }}
        <span class="sponsorBlockAutoSkipState">
          {{ autoSkipDisabled
            ? $t('Video.Player.SponsorBlock.AutoSkipOff')
            : $t('Video.Player.SponsorBlock.AutoSkipOn') }}
        </span>
      </span>
    </footer>
  </section>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  autoSkipDisabled: Boolean,
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

defineEmits(['auto-skip-change', 'close', 'refresh', 'skip', 'vote'])

const selectedUuid = ref(null)

function selectSegment(uuid) {
  selectedUuid.value = selectedUuid.value === uuid ? null : uuid
}

function isSegmentPassed(segment) {
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
  border-radius: 5px;
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
  font-size: 29px;
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

.sponsorBlockSegments {
  min-block-size: 0;
  padding-block: 4px 10px;
  padding-inline: 8px;
  overflow-y: auto;
}

.sponsorBlockSegment {
  border-radius: 6px;
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
  border: 0;
  border-radius: 6px;
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

.sponsorBlockAutoSkip {
  position: relative;
  display: block;
  inline-size: 44px;
  block-size: 24px;
  cursor: pointer;
}

.sponsorBlockAutoSkipLabel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
}

.sponsorBlockAutoSkipState {
  color: var(--secondary-text-color);
  font-size: 11px;
  font-weight: 600;
}

.sponsorBlockAutoSkipState::before {
  content: '·';
  margin-inline-end: 5px;
}

.sponsorBlockAutoSkipInput {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}

.sponsorBlockAutoSkipTrack {
  position: relative;
  display: block;
  inline-size: 44px;
  block-size: 24px;
  background-color: var(--secondary-card-bg-color);
  border: 1px solid var(--side-nav-hover-color);
  border-radius: 999px;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.sponsorBlockAutoSkipThumb {
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

.sponsorBlockAutoSkipInput:checked + .sponsorBlockAutoSkipTrack {
  background-color: #00a846;
  border-color: #00c853;
}

.sponsorBlockAutoSkipInput:checked + .sponsorBlockAutoSkipTrack .sponsorBlockAutoSkipThumb {
  color: #007732;
  transform: translateX(calc(20px * var(--horizontal-directionality-coefficient)));
}

.sponsorBlockAutoSkipInput:focus-visible + .sponsorBlockAutoSkipTrack {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
</style>
