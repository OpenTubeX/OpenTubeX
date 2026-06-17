<template>
  <div
    ref="container"
    class="ftVideoPlayer shaka-video-container"
    :class="{
      fullWindow: fullWindowEnabled,
      sixteenByNine: forceAspectRatio && !fullWindowEnabled
    }"
  >
    <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
    <video
      ref="video"
      class="player"
      preload="auto"
      crossorigin="anonymous"
      playsinline
      :autoplay="autoplayVideos ? true : null"
      :poster="thumbnail"
      @play="handlePlay"
      @pause="handlePause"
      @ended="handleEnded"
      @canplay="handleCanPlay"
      @volumechange="updateVolume"
      @timeupdate="handleTimeupdate"
      @enterpictureinpicture="handleEnterPictureInPicture"
      @leavepictureinpicture="handleLeavePictureInPicture"
    />
    <!--
      VR playback is only possible for VR videos with "EQUIRECTANGULAR" projection
      This intentionally doesn't use the "useVrMode" computed prop,
      as that changes depending on the active format,
      but as we initialize the shaka-player UI once per watch page,
      the canvas has to exist even in audio-only mode, because the user may switch to DASH later.
    -->
    <canvas
      v-if="vrProjection === 'EQUIRECTANGULAR'"
      ref="vrCanvas"
      class="vrCanvas"
    />
    <div
      v-if="showStats"
      class="stats"
    >
      <span>{{ $t('Video.Player.Stats.Video ID', { videoId }) }}</span>
      <br>
      <span>{{ $t('Video.Player.Stats.Media Formats', { formats: format }) }}</span>
      <br>
      <span>{{ $t('Video.Player.Stats.Bitrate', { bitrate: stats.bitrate }) }}</span>
      <br>
      <span>{{ $t('Video.Player.Stats.Volume', { volumePercentage: stats.volume }) }}</span>
      <br>
      <template
        v-if="format !== 'legacy'"
      >
        <span>{{ $t('Video.Player.Stats.Bandwidth', { bandwidth: stats.bandwidth }) }}</span>
        <br>
      </template>
      <span>{{ $t('Video.Player.Stats.Buffered', { bufferedPercentage: stats.buffered }) }}</span>
      <br>
      <span
        v-if="format === 'audio'"
      >{{ $t('Video.Player.Stats.CodecAudio', stats.codecs) }}</span>
      <span
        v-else-if="stats.codecs.audioItag && stats.codecs.videoItag"
      >{{ $t('Video.Player.Stats.CodecsVideoAudio', stats.codecs) }}</span>
      <span
        v-else
      >{{ $t('Video.Player.Stats.CodecsVideoAudioNoItags', stats.codecs) }}</span>
      <br>
      <span>{{ $t('Video.Player.Stats.Player Dimensions', playerDimensions) }}</span>
      <br>
      <template
        v-if="format !== 'audio'"
      >
        <span>{{ $t('Video.Player.Stats.Resolution', stats.resolution) }}</span>
        <br>
        <span>{{ $t('Video.Player.Stats.Dropped Frames / Total Frames', stats.frames) }}</span>
      </template>
    </div>
    <Transition name="fade">
      <div
        v-if="showValueChangePopup"
        class="valueChangePopup"
        :class="{ 'invert-content-order': invertValueChangeContentOrder }"
      >
        <font-awesome-icon
          v-if="valueChangeIcon"
          :icon="['fas', valueChangeIcon]"
        />
        <span>{{ valueChangeMessage }}</span>
      </div>
    </Transition>
    <div
      v-if="showOfflineMessage"
      class="offlineWrapper"
    >
      <font-awesome-layers
        class="offlineIcon"
        aria-hidden="true"
      >
        <font-awesome-icon :icon="['fas', 'wifi']" />
        <font-awesome-icon :icon="['fas', 'slash']" />
      </font-awesome-layers>
      <p class="offlineMessage">
        <span>
          {{ $t('Video.Player.You appear to be offline') }}
        </span>
        <br>
        <span class="offlineMessageSubtitle">
          {{ $t('Video.Player.Playback will resume automatically when your connection comes back') }}
        </span>
      </p>
    </div>
    <Transition name="fade">
      <div
        v-if="showSabrBackoffOverlay"
        class="sabrBackoffOverlay"
        role="status"
        aria-live="polite"
        :aria-label="sabrBackoffAriaLabel"
      >
        <div
          class="sabrBackoffProgress"
          :style="{ '--sabr-backoff-progress': sabrBackoffProgress }"
        >
          <span class="sabrBackoffTime">
            {{ sabrBackoffTimeLabel }}
          </span>
        </div>
      </div>
    </Transition>
    <div
      v-if="sponsorBlockShowSkippedToast && (promptSponsorBlockSegments.length > 0 || skippedSponsorBlockSegments.length > 0)"
      class="skippedSegmentsWrapper"
    >
      <div
        v-for="{ uuid, translatedCategory, color } in promptSponsorBlockSegments"
        :key="uuid"
        class="skippedSegment"
      >
        <div class="skippedSegmentHeader">
          <div class="skippedSegmentTitle">
            <font-awesome-icon
              class="skippedSegmentShield"
              :icon="['fas', 'shield-halved']"
              :style="{ color }"
            />
            <span class="skippedSegmentText">
              {{ getSponsorBlockPromptLabel(translatedCategory) }}
            </span>
          </div>
          <div class="skippedSegmentHeaderActions">
            <span class="skippedSegmentTimer">
              {{ getSponsorBlockPromptTimeLabel(uuid) }}
            </span>
            <button
              class="closeSkippedSegmentButton"
              :title="$t('Close')"
              @click.stop.prevent="dismissPromptSponsorBlockSegment(uuid)"
            >
              <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
          </div>
        </div>
        <div class="skippedSegmentActions">
          <button
            class="unskipButton"
            :title="getSponsorBlockPromptActionLabel()"
            @click.stop.prevent="skipPromptSponsorBlockSegment(uuid)"
          >
            {{ getSponsorBlockPromptActionLabel() }}
          </button>
        </div>
      </div>
      <div
        v-for="{ uuid, translatedCategory, color, unskipped } in skippedSponsorBlockSegments"
        :key="uuid"
        class="skippedSegment"
        @mouseenter="pauseSponsorBlockToastCountdown(uuid)"
        @mouseleave="resumeSponsorBlockToastCountdown(uuid)"
        @focusin="pauseSponsorBlockToastCountdown(uuid)"
        @focusout="resumeSponsorBlockToastCountdown(uuid)"
      >
        <div class="skippedSegmentHeader">
          <div class="skippedSegmentTitle">
            <font-awesome-icon
              class="skippedSegmentShield"
              :icon="['fas', 'shield-halved']"
              :style="{ color }"
            />
            <span class="skippedSegmentText">
              {{ $t('Video.Player.Skipped segment', { segmentCategory: translatedCategory }) }}
            </span>
          </div>
          <div class="skippedSegmentHeaderActions">
            <span class="skippedSegmentTimer">
              <font-awesome-icon
                v-if="isSponsorBlockToastCountdownPaused(uuid)"
                :icon="['fas', 'pause']"
              />
              <template v-else>
                {{ getSponsorBlockToastTimeLabel(uuid) }}
              </template>
            </span>
            <button
              class="closeSkippedSegmentButton"
              :title="$t('Close')"
              @click.stop.prevent="removeSponsorBlockToast(uuid)"
            >
              <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
          </div>
        </div>
        <div class="skippedSegmentActions">
          <button
            v-if="unskipped"
            class="unskipButton"
            :title="getSponsorBlockToastActionLabel(true)"
            @click.stop.prevent="redoSkipSponsorBlockSegment(uuid)"
          >
            {{ getSponsorBlockToastActionLabel(true) }}
          </button>
          <button
            v-else
            class="unskipButton"
            :title="getSponsorBlockToastActionLabel(false)"
            @click.stop.prevent="unskipSponsorBlockSegment(uuid)"
          >
            {{ getSponsorBlockToastActionLabel(false) }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="sponsorBlockSubmissionMenuOpen"
      class="sponsorBlockSubmissionWrapper"
    >
      <div class="sponsorBlockSubmissionMenu">
        <div class="sponsorBlockSubmissionHeader">
          <div class="sponsorBlockSubmissionTitle">
            <font-awesome-icon
              class="sponsorBlockSubmissionShield"
              :icon="['fas', 'shield-halved']"
            />
            <span>{{ $t('Video.Player.SponsorBlock.SubmitSegment') }}</span>
          </div>
          <button
            class="sponsorBlockSubmissionClose"
            :title="$t('Close')"
            @click="closeSponsorBlockSubmissionMenu"
          >
            <font-awesome-icon :icon="['fas', 'xmark']" />
          </button>
        </div>
        <p
          v-if="sponsorBlockSubmissionError !== ''"
          class="sponsorBlockSubmissionError"
        >
          {{ sponsorBlockSubmissionError }}
        </p>
        <div class="sponsorBlockSubmissionSegments">
          <div
            v-for="segment in sponsorBlockDraftSegments"
            :key="segment.id"
            class="sponsorBlockDraftSegment"
          >
            <div
              class="sponsorBlockDraftTimes"
              :class="{
                editing: isSponsorBlockDraftEditing(segment.id),
                viewing: !isSponsorBlockDraftEditing(segment.id)
              }"
            >
              <template v-if="isSponsorBlockDraftEditing(segment.id)">
                <button
                  class="sponsorBlockDraftTimeAction"
                  @click="setSponsorBlockDraftTime(segment.id, 'startTime', 0)"
                >
                  {{ $t('Video.Player.SponsorBlock.StartAction') }}
                </button>
                <button
                  class="sponsorBlockDraftTimeAction"
                  @click="setSponsorBlockDraftTime(segment.id, 'startTime', video?.currentTime ?? 0)"
                >
                  {{ $t('Video.Player.SponsorBlock.NowAction') }}
                </button>
                <input
                  class="sponsorBlockDraftTimeInput"
                  :value="sponsorBlockDraftEditValues[segment.id]?.startTime ?? ''"
                  :aria-label="$t('Video.Player.SponsorBlock.StartTimeLabel')"
                  @input="updateSponsorBlockDraftEditField(segment.id, 'startTime', $event.target.value)"
                >
              </template>
              <span
                v-else
                class="sponsorBlockDraftTimeText"
              >
                {{ sponsorBlockDraftEditValues[segment.id]?.startTime ?? '' }}
              </span>
              <span class="sponsorBlockDraftTimeDivider">{{ $t('Video.Player.SponsorBlock.TimeDivider') }}</span>
              <template v-if="isSponsorBlockDraftEditing(segment.id)">
                <input
                  class="sponsorBlockDraftTimeInput"
                  :value="sponsorBlockDraftEditValues[segment.id]?.endTime ?? ''"
                  :aria-label="$t('Video.Player.SponsorBlock.EndTimeLabel')"
                  @input="updateSponsorBlockDraftEditField(segment.id, 'endTime', $event.target.value)"
                >
                <button
                  class="sponsorBlockDraftTimeAction"
                  @click="setSponsorBlockDraftTime(segment.id, 'endTime', video?.currentTime ?? 0)"
                >
                  {{ $t('Video.Player.SponsorBlock.NowAction') }}
                </button>
                <button
                  class="sponsorBlockDraftTimeAction"
                  @click="setSponsorBlockDraftTime(segment.id, 'endTime', video?.duration ?? 0)"
                >
                  {{ $t('Video.Player.SponsorBlock.EndAction') }}
                </button>
              </template>
              <span
                v-else
                class="sponsorBlockDraftTimeText"
              >
                {{ sponsorBlockDraftEditValues[segment.id]?.endTime ?? '' }}
              </span>
            </div>
            <select
              class="sponsorBlockDraftCategory"
              :value="sponsorBlockDraftEditValues[segment.id]?.category ?? segment.category"
              :aria-label="$t('Video.Player.SponsorBlock.CategoryLabel')"
              @change="updateSponsorBlockDraftCategory(segment.id, $event.target.value)"
            >
              <option
                v-for="category in sponsorBlockSubmissionCategories"
                :key="category"
                :value="category"
              >
                {{ translateSponsorBlockCategory(category) }}
              </option>
            </select>
            <div class="sponsorBlockDraftActions">
              <button
                class="sponsorBlockDraftActionButton"
                @click="deleteSponsorBlockDraft(segment.id)"
              >
                {{ $t('Video.Player.SponsorBlock.DeleteSegment') }}
              </button>
              <button
                class="sponsorBlockDraftActionButton"
                :disabled="segment.endTime == null"
                @click="previewSponsorBlockDraft(segment.id, 'preview')"
              >
                {{ $t('Video.Player.SponsorBlock.PreviewSegment') }}
              </button>
              <button
                class="sponsorBlockDraftActionButton"
                @click="previewSponsorBlockDraft(segment.id, 'inspect')"
              >
                {{ $t('Video.Player.SponsorBlock.InspectSegment') }}
              </button>
              <button
                class="sponsorBlockDraftActionButton"
                :disabled="segment.endTime == null"
                @click="previewSponsorBlockDraft(segment.id, 'end')"
              >
                {{ $t('Video.Player.SponsorBlock.EndActionLabel') }}
              </button>
              <button
                class="sponsorBlockDraftActionButton"
                @click="toggleSponsorBlockDraftEditing(segment.id)"
              >
                {{
                  isSponsorBlockDraftEditing(segment.id)
                    ? $t('Video.Player.SponsorBlock.SaveSegment')
                    : $t('Video.Player.SponsorBlock.EditSegment')
                }}
              </button>
            </div>
          </div>
        </div>
        <div class="sponsorBlockSubmissionFooter">
          <button
            class="sponsorBlockSubmissionGuidelines"
            @click="openSponsorBlockGuidelines"
          >
            {{ $t('Video.Player.SponsorBlock.Guidelines') }}
          </button>
          <button
            class="sponsorBlockSubmissionButton"
            :disabled="sponsorBlockSubmissionPending"
            @click="submitSponsorBlockDrafts"
          >
            {{ $t('Video.Player.SponsorBlock.SubmitSegments') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script src="./ft-shaka-video-player.js" />

<style src="shaka-player/dist/controls.css" />
<style scoped src="./ft-shaka-video-player.css" />
