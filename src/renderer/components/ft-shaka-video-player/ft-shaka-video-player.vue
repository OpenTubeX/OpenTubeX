<template>
  <div
    class="ftVideoPlayerHost"
    :class="{
      ambientWideLayout: theatrePossible && !useTheatreMode,
      theatreUnavailable: !theatrePossible,
      shortsPlayer
    }"
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
    <div
      ref="container"
      class="ftVideoPlayer shaka-video-container"
      :class="{
        fullWindow: fullWindowEnabled,
        shortsPlayer,
        shortsPaused: shortsPaused && hasLoaded,
        sixteenByNine: forceAspectRatio && !fullWindowEnabled && !scrollMiniPlayerActive,
        scrollMiniPlayer: scrollMiniPlayerActive,
        fullscreenMetadataOpen: showFullscreenMetadata,
        fullscreenTranscriptOpen: showFullscreenTranscript,
        fullscreenSponsorBlockOpen: showFullscreenSponsorBlock,
        fullscreenCommentsOpen: showFullscreenComments,
        fullscreenPlaylistOpen: showFullscreenPlaylist,
        chaptersOverlayOpen: showChaptersOverlay && chapters.length > 0,
        fullscreenDockResizing,
        fullscreenDockReordering,
        presentationModeChanging
      }"
      :style="[
        captionCssVariables,
        scrollMiniPlayerActive ? scrollMiniPlayerStyle : undefined,
        shortsPlayer ? { '--shorts-aspect-ratio': shortsAspectRatio } : undefined
      ]"
      @mouseenter="handleScrollMiniPlayerEnter"
      @mouseleave="handleScrollMiniPlayerLeave"
      @focusin="handleScrollMiniPlayerEnter"
      @focusout="handleScrollMiniPlayerLeave"
      @dblclick.capture="handlePlayerControlDoubleClick"
    >
      <!-- Ambient glow surface for fullscreen, where the host-level canvases are not rendered. -->
      <canvas
        v-show="ambientModeVisible"
        ref="ambientFullscreenCanvas"
        class="ambientFullscreenCanvas"
        aria-hidden="true"
      />
      <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
      <video
        ref="video"
        class="player"
        preload="auto"
        crossorigin="anonymous"
        playsinline
        :autoplay="autoplayVideos || shortsPlayer ? true : null"
        :loop="shortsPlayer"
        :poster="showPoster ? thumbnail : null"
        @play="handlePlay"
        @playing="handlePlaying"
        @pause="handlePause"
        @ended="handleEnded"
        @seeking="handleSeeking"
        @canplay="handleCanPlay"
        @volumechange="updateVolume"
        @timeupdate="handleTimeupdate"
        @enterpictureinpicture="handleEnterPictureInPicture"
        @leavepictureinpicture="handleLeavePictureInPicture"
      />
      <div
        v-if="shortsPlayer"
        class="shortsTopControls shaka-no-propagation"
        @dblclick.stop.prevent
      >
        <div class="shortsTopControlsGroup">
          <button
            type="button"
            class="shortsTopControl"
            :aria-label="shortsPaused
              ? $t('Video.Player.Scroll Mini Player.Play')
              : $t('Video.Player.Scroll Mini Player.Pause')"
            @click.stop="toggleShortsPlayback"
          >
            <font-awesome-icon :icon="['fas', shortsPaused ? 'play' : 'pause']" />
          </button>
          <div class="shortsVolumeControl">
            <button
              type="button"
              class="shortsTopControl"
              :aria-label="$t('KeyboardShortcutPrompt.Mute')"
              @click.stop="toggleShortsMuted"
            >
              <font-awesome-icon :icon="['fas', shortsMuted ? 'volume-mute' : 'volume-high']" />
            </button>
            <input
              type="range"
              class="shortsVolumeSlider"
              min="0"
              max="100"
              step="any"
              :value="scrollMiniVolumePercent"
              :aria-label="$t('Video.Player.Scroll Mini Player.Volume')"
              @input.stop="updateScrollMiniVolume"
              @click.stop
            >
          </div>
        </div>
        <div class="shortsTopControlsGroup">
          <button
            v-if="shortsCaptionsAvailable"
            type="button"
            class="shortsTopControl shortsCaptionsControl"
            :class="{ active: shortsCaptionsEnabled }"
            :aria-label="$t('KeyboardShortcutPrompt.Captions')"
            @click.stop="toggleShortsCaptions"
          >
            <font-awesome-icon :icon="['fas', 'closed-captioning']" />
          </button>
          <button
            type="button"
            class="shortsTopControl"
            :aria-label="$t('Video.More Options')"
            @click.stop="openShortsOverflowMenu($event)"
          >
            <font-awesome-icon :icon="['fas', 'ellipsis-v']" />
          </button>
          <button
            type="button"
            class="shortsTopControl"
            :aria-label="$t('KeyboardShortcutPrompt.Fullscreen')"
            :aria-pressed="String(isFullscreen)"
            @click.stop="toggleShortsFullscreen"
          >
            <font-awesome-icon :icon="['fas', isFullscreen ? 'compress' : 'expand']" />
          </button>
        </div>
      </div>
      <Transition name="fade">
        <div
          v-if="autoplayCountdown"
          v-overlay-scrollbars
          class="autoplayCountdownOverlay shaka-no-propagation"
          role="dialog"
          :aria-label="$t('Up Next')"
          @click.stop
          @dblclick.stop
          @pointerdown.stop
        >
          <div
            class="autoplayCountdownCard"
            :class="{
              compact: compactAutoplayLayout,
              tiny: tinyAutoplayLayout
            }"
          >
            <p
              class="autoplayCountdownHeading"
              aria-live="polite"
            >
              {{ $t('Video.Player.Up next in {seconds}', { seconds: autoplayCountdown.remainingSeconds }) }}
            </p>
            <div class="autoplayThumbnailWrapper">
              <img
                class="autoplayThumbnail"
                :src="autoplayThumbnail"
                alt=""
              >
              <span
                v-if="autoplayDuration"
                class="autoplayDuration"
              >
                {{ autoplayDuration }}
              </span>
            </div>
            <div
              class="autoplayTitle"
              dir="auto"
            >
              {{ autoplayNextVideo?.title }}
            </div>
            <div
              v-if="autoplayNextVideo?.author"
              class="autoplayAuthor"
              dir="auto"
            >
              {{ autoplayNextVideo.author }}
            </div>
            <div class="autoplayActions">
              <button
                type="button"
                class="autoplayButton autoplayCancel"
                @click="cancelAutoplayCountdown"
              >
                {{ $t('Cancel') }}
              </button>
              <button
                type="button"
                class="autoplayButton autoplayPlayNow"
                @click="playAutoplayVideoNow"
              >
                {{ $t('Video.Player.Play now') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
      <div
        v-if="watchingPlaylist || commentsAvailable || useSponsorBlock || !isLive || showFullscreenShareAction || showFullscreenPlaylistAction || quickBookmarkEnabled"
        class="fullscreenActions shaka-no-propagation"
        @click.stop
        @dblclick.stop
      >
        <button
          v-if="watchingPlaylist"
          type="button"
          class="fullscreenAction fullscreenPlaylistToggle"
          :class="{ open: showFullscreenPlaylist }"
          :aria-label="$t('Playlist.Playlist')"
          :title="$t('Playlist.Playlist')"
          :aria-expanded="String(showFullscreenPlaylist)"
          @click="setFullscreenPlaylist(!showFullscreenPlaylist)"
        >
          <FontAwesomeIcon :icon="['fas', 'list']" />
        </button>
        <button
          v-if="commentsAvailable"
          type="button"
          class="fullscreenAction fullscreenCommentsToggle"
          :class="{ open: showFullscreenComments }"
          :aria-label="$t('Comments.Comments')"
          :title="$t('Comments.Comments')"
          :aria-expanded="String(showFullscreenComments)"
          @click="setFullscreenComments(!showFullscreenComments)"
        >
          <FontAwesomeIcon :icon="['fas', 'comment']" />
        </button>
        <button
          v-if="useSponsorBlock && !isUpcoming"
          type="button"
          class="fullscreenAction fullscreenSponsorBlockToggle"
          :class="{ open: showFullscreenSponsorBlock }"
          :aria-label="showFullscreenSponsorBlock
            ? $t('Video.Player.SponsorBlock.CloseInfoPanel')
            : $t('Video.Player.SponsorBlock.OpenInfoPanel')"
          :title="showFullscreenSponsorBlock
            ? $t('Video.Player.SponsorBlock.CloseInfoPanel')
            : $t('Video.Player.SponsorBlock.OpenInfoPanel')"
          :aria-expanded="String(showFullscreenSponsorBlock)"
          @click="toggleFullscreenSponsorBlock"
        >
          <FontAwesomeIcon :icon="['fas', 'shield-halved']" />
        </button>
        <button
          v-if="!isLive && !isUpcoming"
          type="button"
          class="fullscreenAction fullscreenTranscriptToggle"
          :class="{ open: showFullscreenTranscript }"
          :aria-label="showFullscreenTranscript
            ? $t('Video.Transcript.Hide')
            : $t('Video.Transcript.Show')"
          :title="showFullscreenTranscript
            ? $t('Video.Transcript.Hide')
            : $t('Video.Transcript.Show')"
          :aria-expanded="String(showFullscreenTranscript)"
          @click="toggleFullscreenTranscript"
        >
          <FontAwesomeIcon :icon="['fas', 'file-lines']" />
        </button>
        <FtShareButton
          v-if="showFullscreenShareAction"
          :id="videoId"
          class="fullscreenShareAction"
          :playlist-id="playlistId"
          :get-timestamp="getShareTimestamp"
          dropdown-position-y="top"
        />
        <FtIconButton
          v-if="showFullscreenPlaylistAction && playlistVideoData"
          class="fullscreenPlaylistAction"
          :class="{ open: isInAnyPlaylist }"
          :title="$t('User Playlists.Add to Playlist')"
          :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
          :use-shadow="false"
          force-dropdown
          dropdown-position-x="left"
          dropdown-position-y="top"
        >
          <FtAddToPlaylistDropdown :video-data="playlistVideoData" />
        </FtIconButton>
        <button
          v-if="quickBookmarkEnabled"
          type="button"
          class="fullscreenAction fullscreenQuickBookmarkAction"
          :class="{ open: quickBookmarked }"
          :aria-label="quickBookmarkTitle"
          :title="quickBookmarkTitle"
          @click="toggleQuickBookmark"
        >
          <FontAwesomeIcon :icon="quickBookmarkIcon" />
        </button>
      </div>
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
        v-if="!hideAnnotations"
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
          v-if="showChaptersOverlay && (isFullscreen || fullWindowEnabled) && chapters.length > 0"
          ref="chapterOverlay"
          class="chapterOverlay shaka-no-propagation"
          :class="{ fullscreenDockReorderable: fullscreenDockCanReorder('chapters') }"
          :style="fullscreenDockStyle('chapters')"
          role="dialog"
          tabindex="-1"
          :aria-label="$t('Chapters.Chapters')"
          @click.stop
          @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'chapters')"
          @dblclick.stop
          @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'chapters')"
          @pointerdown.stop
          @wheel.stop
          @keydown.esc.stop.prevent="closeChaptersOverlay"
        >
          <button
            v-if="fullscreenDockCanResize('chapters')"
            type="button"
            class="fullscreenDockResizeHandle"
            :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
            :title="$t('Video.Player.Resize dock', 'Resize dock')"
            @pointerdown="handleFullscreenDockResizePointerDown($event, 'chapters')"
            @keydown="handleFullscreenDockResizeKeydown($event, 'chapters')"
            @dblclick.stop.prevent="resetFullscreenDockHeights"
          />
          <header class="chapterOverlayHeader">
            <h2 class="chapterOverlayTitle">
              <svg
                class="chapterOverlayTitleIcon"
                viewBox="0 -960 960 960"
                aria-hidden="true"
              >
                <path d="m400-200-182 91q-20 10-39-1.5T160-145v-495q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v495q0 23-19 34.5t-39 1.5l-182-91Zm360-40q-17 0-28.5-11.5T720-280v-520H320q-17 0-28.5-11.5T280-840q0-17 11.5-28.5T320-880h400q33 0 56.5 23.5T800-800v520q0 17-11.5 28.5T760-240Z" />
              </svg>
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
        ref="fullscreenMetadataOverlay"
        class="fullscreenMetadataOverlay shaka-no-propagation"
        :class="{
          open: showFullscreenMetadata,
          fullscreenDockReorderable: fullscreenDockCanReorder('metadata')
        }"
        :style="fullscreenDockStyle('metadata')"
        role="dialog"
        :aria-label="$t('Video.Metadata', 'Video information')"
        :aria-hidden="String(!showFullscreenMetadata)"
        :inert="!showFullscreenMetadata"
        @click.stop
        @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'metadata')"
        @dblclick.stop
        @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'metadata')"
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenMetadata"
      >
        <button
          v-if="fullscreenDockCanResize('metadata')"
          type="button"
          class="fullscreenDockResizeHandle"
          :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
          :title="$t('Video.Player.Resize dock', 'Resize dock')"
          @pointerdown="handleFullscreenDockResizePointerDown($event, 'metadata')"
          @keydown="handleFullscreenDockResizeKeydown($event, 'metadata')"
          @dblclick.stop.prevent="resetFullscreenDockHeights"
        />
        <header class="fullscreenMetadataHeader">
          <h2 class="fullscreenDockHeading">
            <FontAwesomeIcon
              class="fullscreenDockHeadingIcon"
              :icon="['fas', 'info-circle']"
            />
            {{ $t('Video.Metadata', 'Video information') }}
          </h2>
          <button
            type="button"
            class="fullscreenMetadataClose"
            :aria-label="$t('Video.Close Metadata', 'Close video information')"
            :title="$t('Video.Close Metadata', 'Close video information')"
            @click="closeFullscreenMetadata"
          >
            <FontAwesomeIcon :icon="['fas', 'xmark']" />
          </button>
        </header>
        <div
          ref="fullscreenMetadataTarget"
          v-overlay-scrollbars
          class="fullscreenMetadataTarget"
        />
      </aside>
      <aside
        ref="fullscreenTranscriptOverlay"
        class="fullscreenTranscriptOverlay shaka-no-propagation"
        :class="{
          open: showFullscreenTranscript,
          fullscreenDockReorderable: fullscreenDockCanReorder('transcript')
        }"
        :style="fullscreenDockStyle('transcript')"
        role="dialog"
        :aria-label="$t('Video.Transcript.Title')"
        :aria-hidden="String(!showFullscreenTranscript)"
        :inert="!showFullscreenTranscript"
        @click.stop
        @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'transcript')"
        @dblclick.stop
        @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'transcript')"
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenTranscript"
      >
        <button
          v-if="fullscreenDockCanResize('transcript')"
          type="button"
          class="fullscreenDockResizeHandle"
          :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
          :title="$t('Video.Player.Resize dock', 'Resize dock')"
          @pointerdown="handleFullscreenDockResizePointerDown($event, 'transcript')"
          @keydown="handleFullscreenDockResizeKeydown($event, 'transcript')"
          @dblclick.stop.prevent="resetFullscreenDockHeights"
        />
        <div
          ref="fullscreenTranscriptTarget"
          class="fullscreenTranscriptTarget"
        />
      </aside>
      <aside
        ref="fullscreenSponsorBlockOverlay"
        class="fullscreenSponsorBlockOverlay shaka-no-propagation"
        :class="{
          open: showFullscreenSponsorBlock,
          fullscreenDockReorderable: fullscreenDockCanReorder('sponsorBlock')
        }"
        :style="fullscreenDockStyle('sponsorBlock')"
        role="dialog"
        :aria-label="$t('Video.Player.SponsorBlock.InfoPanelTitle')"
        :aria-hidden="String(!showFullscreenSponsorBlock)"
        :inert="!showFullscreenSponsorBlock"
        @click.stop
        @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'sponsorBlock')"
        @dblclick.stop
        @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'sponsorBlock')"
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenSponsorBlock"
      >
        <button
          v-if="fullscreenDockCanResize('sponsorBlock')"
          type="button"
          class="fullscreenDockResizeHandle"
          :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
          :title="$t('Video.Player.Resize dock', 'Resize dock')"
          @pointerdown="handleFullscreenDockResizePointerDown($event, 'sponsorBlock')"
          @keydown="handleFullscreenDockResizeKeydown($event, 'sponsorBlock')"
          @dblclick.stop.prevent="resetFullscreenDockHeights"
        />
        <div
          ref="fullscreenSponsorBlockTarget"
          class="fullscreenSponsorBlockTarget"
        />
      </aside>
      <aside
        ref="fullscreenCommentsOverlay"
        class="fullscreenCommentsOverlay shaka-no-propagation"
        :class="{
          open: showFullscreenComments,
          fullscreenDockReorderable: fullscreenDockCanReorder('comments')
        }"
        :style="fullscreenDockStyle('comments')"
        role="dialog"
        :aria-label="$t('Comments.Comments')"
        :aria-hidden="String(!showFullscreenComments)"
        :inert="!showFullscreenComments"
        @click.stop
        @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'comments')"
        @dblclick.stop
        @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'comments')"
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenComments"
      >
        <button
          v-if="fullscreenDockCanResize('comments')"
          type="button"
          class="fullscreenDockResizeHandle"
          :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
          :title="$t('Video.Player.Resize dock', 'Resize dock')"
          @pointerdown="handleFullscreenDockResizePointerDown($event, 'comments')"
          @keydown="handleFullscreenDockResizeKeydown($event, 'comments')"
          @dblclick.stop.prevent="resetFullscreenDockHeights"
        />
      </aside>
      <aside
        ref="fullscreenPlaylistOverlay"
        class="fullscreenPlaylistOverlay shaka-no-propagation"
        :class="{
          open: showFullscreenPlaylist,
          fullscreenDockReorderable: fullscreenDockCanReorder('playlist')
        }"
        :style="fullscreenDockStyle('playlist')"
        role="dialog"
        :aria-label="$t('Playlist.Playlist')"
        :aria-hidden="String(!showFullscreenPlaylist)"
        :inert="!showFullscreenPlaylist"
        @click.stop
        @dblclick.capture="handleFullscreenDockHeaderDoubleClick($event, 'playlist')"
        @dblclick.stop
        @pointerdown.capture="handleFullscreenDockReorderPointerDown($event, 'playlist')"
        @pointerdown.stop
        @wheel.stop
        @keydown.esc.stop.prevent="closeFullscreenPlaylist"
      >
        <button
          v-if="fullscreenDockCanResize('playlist')"
          type="button"
          class="fullscreenDockResizeHandle"
          :aria-label="$t('Video.Player.Resize dock', 'Resize dock')"
          :title="$t('Video.Player.Resize dock', 'Resize dock')"
          @pointerdown="handleFullscreenDockResizePointerDown($event, 'playlist')"
          @keydown="handleFullscreenDockResizeKeydown($event, 'playlist')"
          @dblclick.stop.prevent="resetFullscreenDockHeights"
        />
        <div
          ref="fullscreenPlaylistTarget"
          class="fullscreenPlaylistTarget"
        />
      </aside>
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
                {{ getSponsorBlockPromptLabel(translatedCategory, uuid) }}
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
              :title="getSponsorBlockPromptActionLabel(uuid)"
              @click.stop.prevent="skipPromptSponsorBlockSegment(uuid)"
            >
              {{ getSponsorBlockPromptActionLabel(uuid) }}
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
                {{ getSponsorBlockToastLabel(uuid, translatedCategory, isHighlight) }}
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
              :title="getSponsorBlockToastActionLabel(true, uuid)"
              @click.stop.prevent="redoSkipSponsorBlockSegment(uuid)"
            >
              {{ getSponsorBlockToastActionLabel(true, uuid) }}
            </button>
            <button
              v-else
              class="unskipButton"
              :title="getSponsorBlockToastActionLabel(false, uuid)"
              @click.stop.prevent="unskipSponsorBlockSegment(uuid)"
            >
              {{ getSponsorBlockToastActionLabel(false, uuid) }}
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
          <div
            v-overlay-scrollbars
            class="sponsorBlockSubmissionSegments"
          >
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
                <span
                  v-if="isSponsorBlockFullVideoSegment(segment)"
                  class="sponsorBlockDraftTimeText"
                >
                  {{ $t('Video.Player.SponsorBlock.FullVideo') }}
                </span>
                <template v-else-if="isSponsorBlockDraftEditing(segment.id)">
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
                  v-if="!isSponsorBlockPointSegment(segment) && !isSponsorBlockFullVideoSegment(segment)"
                  class="sponsorBlockDraftTimeDivider"
                >{{ $t('Video.Player.SponsorBlock.TimeDivider') }}</span>
                <template v-if="isSponsorBlockDraftEditing(segment.id) && !isSponsorBlockPointSegment(segment) && !isSponsorBlockFullVideoSegment(segment)">
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
                  v-else-if="!isSponsorBlockPointSegment(segment) && !isSponsorBlockFullVideoSegment(segment)"
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
              <select
                v-if="!isSponsorBlockPointSegment(segment)"
                class="sponsorBlockDraftCategory"
                :value="sponsorBlockDraftEditValues[segment.id]?.actionType ?? segment.actionType"
                :aria-label="$t('Video.Player.SponsorBlock.ActionTypeLabel')"
                @change="updateSponsorBlockDraftActionType(segment.id, $event.target.value)"
              >
                <option
                  value="skip"
                  :disabled="(sponsorBlockDraftEditValues[segment.id]?.category ?? segment.category) === 'exclusive_access'"
                >
                  {{ $t('Video.Player.SponsorBlock.SkipActionType') }}
                </option>
                <option
                  value="mute"
                  :disabled="(sponsorBlockDraftEditValues[segment.id]?.category ?? segment.category) === 'exclusive_access'"
                >
                  {{ $t('Video.Player.SponsorBlock.MuteActionType') }}
                </option>
                <option
                  value="full"
                  :disabled="!['sponsor', 'selfpromo', 'exclusive_access'].includes(sponsorBlockDraftEditValues[segment.id]?.category ?? segment.category)"
                >
                  {{ $t('Video.Player.SponsorBlock.FullVideo') }}
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
                  v-if="!isSponsorBlockFullVideoSegment(segment)"
                  class="sponsorBlockDraftActionButton"
                  :disabled="segment.endTime == null && !isSponsorBlockPointSegment(segment)"
                  @click="previewSponsorBlockDraft(segment.id, 'preview')"
                >
                  {{ $t('Video.Player.SponsorBlock.PreviewSegment') }}
                </button>
                <button
                  v-if="!isSponsorBlockFullVideoSegment(segment)"
                  class="sponsorBlockDraftActionButton"
                  @click="previewSponsorBlockDraft(segment.id, 'inspect')"
                >
                  {{ $t('Video.Player.SponsorBlock.InspectSegment') }}
                </button>
                <button
                  v-if="!isSponsorBlockPointSegment(segment) && !isSponsorBlockFullVideoSegment(segment)"
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
          :class="{
            isHidden: !scrollMiniPlayPauseVisible,
            'scrollMiniDragHandle-onLightBg': scrollMiniDragHandleOnLightBg
          }"
          :title="$t('Video.Player.Scroll Mini Player.Drag Handle')"
          @pointerdown.stop="handleScrollMiniDragPointerDown"
          @mousedown.stop.prevent
        />
        <div
          class="scrollMiniResizeHandle"
          :class="[
            `scrollMiniResizeHandle-${scrollMiniResizeCorner}`,
            {
              isHidden: !scrollMiniPlayPauseVisible,
              'scrollMiniResizeHandle-onLightBg': scrollMiniResizeHandleOnLightBg
            }
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
