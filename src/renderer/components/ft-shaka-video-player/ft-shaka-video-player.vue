<template>
  <div
    class="ftVideoPlayerHost"
    :class="{ ambientWideLayout: theatrePossible && !useTheatreMode }"
  >
    <canvas
      v-show="ambientModeVisible"
      ref="ambientLayoutCanvas"
      class="ambientLayoutCanvas"
      aria-hidden="true"
    />
    <canvas
      v-show="ambientModeVisible"
      ref="ambientCanvas"
      class="ambientCanvas"
      aria-hidden="true"
    />
    <!-- Keep the ambient surface outside the element measured by the scroll mini player. -->
    <div
      ref="scrollMiniAnchor"
      class="scrollMiniAnchor"
      aria-hidden="true"
    />
    <div
      v-if="fullWindowEnabled"
      class="fullWindowPlaceholder"
      :style="{ height: `${fullWindowPlaceholderHeight}px` }"
      aria-hidden="true"
    />
    <div
      v-if="scrollMiniPlayerActive"
      ref="scrollMiniPlaceholder"
      class="scrollMiniPlaceholder"
      :style="{ height: `${scrollMiniPlaceholderHeight}px` }"
      aria-hidden="true"
    />
    <!-- The capture listener dismisses the focused dialog; its keyboard equivalent is Escape on the dialog. -->
    <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
    <div
      ref="container"
      class="ftVideoPlayer shaka-video-container"
      :class="{
        fullWindow: fullWindowEnabled,
        sixteenByNine: forceAspectRatio && !fullWindowEnabled && !scrollMiniPlayerActive,
        scrollMiniPlayer: scrollMiniPlayerActive
      }"
      :style="[captionCssVariables, scrollMiniPlayerActive ? scrollMiniPlayerStyle : undefined]"
      @mouseenter="handleScrollMiniPlayerEnter"
      @mouseleave="handleScrollMiniPlayerLeave"
      @focusin="handleScrollMiniPlayerEnter"
      @focusout="handleScrollMiniPlayerLeave"
      @click.capture="handleChaptersOverlayOutsideClick"
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
        @seeking="syncPlayPauseControlIcons"
        @canplay="handleCanPlay"
        @volumechange="updateVolume"
        @timeupdate="handleTimeupdate"
        @enterpictureinpicture="handleEnterPictureInPicture"
        @leavepictureinpicture="handleLeavePictureInPicture"
      />
      <button
        v-if="commentsAvailable"
        type="button"
        class="fullscreenCommentsToggle shaka-no-propagation"
        :class="{ open: showFullscreenComments }"
        :aria-label="$t('Comments.Comments')"
        :title="$t('Comments.Comments')"
        :aria-expanded="String(showFullscreenComments)"
        @click.stop="setFullscreenComments(!showFullscreenComments)"
        @dblclick.stop
      >
        <FontAwesomeIcon :icon="['fas', 'comment']" />
      </button>
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
      <FtVideoAnnotations
        :annotations="annotations"
        :current-time="annotationCurrentTime"
      />
      <div
        v-if="showCaptionAppearanceSample"
        class="captionAppearanceSample"
        :style="{ bottom: captionAppearanceSampleBottom }"
        aria-live="polite"
      >
        <span>{{ $t('Video.Player.Caption Appearance.Sample') }}</span>
      </div>
      <Transition name="chapter-slide">
        <aside
          v-if="showChaptersOverlay && chapters.length > 0"
          ref="chapterOverlay"
          class="chapterOverlay shaka-no-propagation"
          role="dialog"
          tabindex="-1"
          :aria-label="$t('Chapters.Chapters')"
          @click.stop
          @dblclick.stop
          @pointerdown.stop
          @wheel.stop
          @keydown.esc.stop.prevent="closeChaptersOverlay"
        >
          <header class="chapterOverlayHeader">
            <h2 class="chapterOverlayTitle">
              {{ chaptersKind === 'keyMoments' ? $t('Chapters.Key Moments') : $t('Chapters.Chapters') }}
            </h2>
            <button
              type="button"
              class="chapterOverlayClose"
              :aria-label="$t('Chapters.Close Chapters')"
              :title="$t('Chapters.Close Chapters')"
              @click="closeChaptersOverlay"
            >
              <FontAwesomeIcon :icon="['fas', 'xmark']" />
            </button>
          </header>
          <WatchVideoChapters
            :chapters="chapters"
            :chapter-thumbnails="chapterThumbnails"
            :current-chapter-index="currentChapterIndex"
            :fallback-thumbnail="thumbnail"
            @copy-timestamp="copyChapterTimestamp"
            @timestamp-event="selectOverlayChapter"
          />
        </aside>
      </Transition>
      <aside
        ref="fullscreenCommentsOverlay"
        class="fullscreenCommentsOverlay shaka-no-propagation"
        :class="{ open: showFullscreenComments }"
        role="dialog"
        :aria-label="$t('Comments.Comments')"
        :aria-hidden="String(!showFullscreenComments)"
        :inert="!showFullscreenComments"
        @click.stop
        @dblclick.stop
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenComments"
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
          v-if="showTemporaryPlaybackRateIndicator || silenceSkippingActive || showValueChangePopup"
          class="valueChangePopup"
          :class="{
            'invert-content-order':
              showTemporaryPlaybackRateIndicator || silenceSkippingActive || invertValueChangeContentOrder
          }"
        >
          <font-awesome-icon
            v-if="showTemporaryPlaybackRateIndicator || silenceSkippingActive || valueChangeIcon"
            :icon="[
              'fas',
              showTemporaryPlaybackRateIndicator
                ? 'forward'
                : silenceSkippingActive
                  ? 'forward-fast'
                  : valueChangeIcon
            ]"
          />
          <span>{{
            showTemporaryPlaybackRateIndicator
              ? temporaryPlaybackRateIndicatorMessage
              : silenceSkippingActive
                ? silenceSkippingIndicatorMessage
                : valueChangeMessage
          }}</span>
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
          v-if="showCountdownOverlay"
          class="countdownOverlay"
          role="status"
          aria-live="polite"
          :aria-label="countdownAriaLabel"
        >
          <div class="countdownProgress">
            <svg
              class="countdownRing"
              viewBox="0 0 92 92"
              aria-hidden="true"
            >
              <circle
                class="countdownRingTrack"
                cx="46"
                cy="46"
                :r="38"
                fill="none"
              />
              <circle
                class="countdownRingProgress"
                cx="46"
                cy="46"
                :r="38"
                fill="none"
                :stroke-dasharray="countdownRingCircumference"
                :stroke-dashoffset="countdownRingDashoffset"
              />
            </svg>
            <span class="countdownTime">
              {{ countdownTimeLabel }}
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
          v-for="{ uuid, translatedCategory, color, unskipped, isHighlight } in skippedSponsorBlockSegments"
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
                {{ isHighlight
                  ? $t('Video.Player.SponsorBlock.SkippedToHighlight')
                  : $t('Video.Player.Skipped segment', { segmentCategory: translatedCategory }) }}
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
                <span
                  v-if="!isSponsorBlockPointSegment(segment)"
                  class="sponsorBlockDraftTimeDivider"
                >{{ $t('Video.Player.SponsorBlock.TimeDivider') }}</span>
                <template v-if="isSponsorBlockDraftEditing(segment.id) && !isSponsorBlockPointSegment(segment)">
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
                  v-else-if="!isSponsorBlockPointSegment(segment)"
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
                  :disabled="segment.endTime == null && !isSponsorBlockPointSegment(segment)"
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
                  v-if="!isSponsorBlockPointSegment(segment)"
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
      <div
        v-if="scrollMiniPlayerActive"
        class="scrollMiniPlayerControls"
      >
        <div
          class="scrollMiniPointerLayer"
          @pointermove="handleScrollMiniControlsPointerMove"
          @wheel.passive="suppressScrollMiniPlayPausePointerReveal"
        />
        <button
          type="button"
          tabindex="-1"
          class="scrollMiniScrollTop"
          :title="$t('Video.Player.Scroll Mini Player.Back to Top')"
          @click.stop.prevent="scrollMiniScrollToTop"
          @mousedown.stop.prevent
        >
          <font-awesome-icon :icon="['fas', 'angle-up']" />
        </button>
        <button
          type="button"
          tabindex="-1"
          class="scrollMiniPlayPause"
          :class="{ isHidden: !scrollMiniPlayPauseVisible }"
          :title="scrollMiniIsPaused ? $t('Video.Player.Scroll Mini Player.Play') : $t('Video.Player.Scroll Mini Player.Pause')"
          @click.stop.prevent="scrollMiniTogglePlayPause"
          @mouseenter="handleScrollMiniPlayPauseMouseEnter"
          @focusin="handleScrollMiniPlayPauseMouseEnter"
          @pointerdown.stop
          @mousedown.stop.prevent
        >
          <font-awesome-icon :icon="['fas', scrollMiniIsPaused ? 'play' : 'pause']" />
        </button>
        <div
          class="scrollMiniVolume"
          :class="{ isExpanded: scrollMiniVolumeExpanded }"
          @mouseenter="handleScrollMiniVolumeMouseEnter"
          @mouseleave="handleScrollMiniVolumeMouseLeave"
          @focusin="handleScrollMiniVolumeMouseEnter"
          @focusout="handleScrollMiniVolumeMouseLeave"
        >
          <font-awesome-icon
            class="scrollMiniVolumeIcon"
            :icon="scrollMiniVolumeIcon"
          />
          <div
            ref="scrollMiniVolumeTrack"
            class="shaka-range-container scrollMiniVolumeTrack"
          >
            <input
              type="range"
              tabindex="-1"
              class="shaka-range-element scrollMiniVolumeBar"
              min="0"
              max="100"
              step="any"
              :value="scrollMiniVolumePercent"
              :aria-label="$t('Video.Player.Scroll Mini Player.Volume')"
              @input.stop="updateScrollMiniVolume"
              @pointerdown.stop="handleScrollMiniVolumePointerDown"
            >
          </div>
        </div>
        <div
          class="scrollMiniDragHandle"
          :class="{ 'scrollMiniDragHandle-onLightBg': scrollMiniDragHandleOnLightBg }"
          :title="$t('Video.Player.Scroll Mini Player.Drag Handle')"
          @pointerdown.stop="handleScrollMiniDragPointerDown"
          @mousedown.stop.prevent
        />
        <div
          class="scrollMiniResizeHandle"
          :class="[
            `scrollMiniResizeHandle-${scrollMiniResizeCorner}`,
            { 'scrollMiniResizeHandle-onLightBg': scrollMiniResizeHandleOnLightBg }
          ]"
          @pointerdown.stop="handleScrollMiniResizePointerDown"
          @mousedown.stop.prevent
        />
      </div>
    </div>
  </div>
</template>

<script src="./ft-shaka-video-player.js" />

<style src="shaka-player/dist/controls.css" />
<style scoped src="./ft-shaka-video-player.css" />
<style>
/* Unscoped: pseudo-elements on range inputs do not work reliably with Vue scoped CSS. */
.ftVideoPlayer.scrollMiniPlayer .scrollMiniVolumeBar {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.ftVideoPlayer.scrollMiniPlayer .scrollMiniVolumeBar::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  background: transparent;
  border: 0;
  color: transparent;
  cursor: pointer;
}

.ftVideoPlayer.scrollMiniPlayer .scrollMiniVolumeBar::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  border: 0;
  border-radius: 50%;
  width: 12px;
  height: 12px;
  background: #fff;
  margin-top: -4px;
  cursor: pointer;
}

.ftVideoPlayer.scrollMiniPlayer .scrollMiniVolumeBar::-moz-range-track {
  width: 100%;
  height: 4px;
  background: transparent;
  border: 0;
  color: transparent;
  cursor: pointer;
}

.ftVideoPlayer.scrollMiniPlayer .scrollMiniVolumeBar::-moz-range-thumb {
  appearance: none;
  border: 0;
  border-radius: 50%;
  width: 12px;
  height: 12px;
  background: #fff;
  cursor: pointer;
}
</style>
