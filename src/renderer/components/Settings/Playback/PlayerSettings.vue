<template>
  <FtSettingsSection
    v-bind="$attrs"
    :title="t('Settings.Player Settings.Player Settings')"
    :icon="['fas', 'play']"
  >
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Playback') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
          :compact="true"
          :default-value="enableSubtitlesByDefault"
          setting-key="enableSubtitlesByDefault"
          @change="updateEnableSubtitlesByDefault"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Automatically Open Chapters')"
          :compact="true"
          :default-value="autoOpenChapters"
          setting-key="autoOpenChapters"
          @change="updateAutoOpenChapters"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Pause on Stream Recovery')"
          :compact="true"
          :default-value="store.getters.getPauseOnStreamRecovery"
          setting-key="pauseOnStreamRecovery"
          :tooltip="t('Tooltips.Player Settings.Pause on Stream Recovery')"
          @change="store.dispatch('updatePauseOnStreamRecovery', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Music Visualizer')"
          :compact="true"
          :default-value="musicVisualizer"
          setting-key="musicVisualizer"
          @change="updateMusicVisualizer"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Continue Playback When Screen Is Locked')"
          :compact="true"
          :default-value="continuePlaybackWhenScreenIsLocked"
          setting-key="continuePlaybackWhenScreenIsLocked"
          :tooltip="t('Tooltips.Player Settings.Continue Playback When Screen Is Locked')"
          @change="updateContinuePlaybackWhenScreenIsLocked"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Switch to Audio in Background')"
          :compact="true"
          :default-value="store.getters.getSwitchToAudioInBackground"
          :disabled="!continuePlaybackWhenScreenIsLocked"
          setting-key="switchToAudioInBackground"
          :tooltip="t('Tooltips.Player Settings.Switch to Audio in Background')"
          @change="store.dispatch('updateSwitchToAudioInBackground', $event)"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Remember Volume')"
          :compact="true"
          :default-value="rememberVolume"
          setting-key="rememberVolume"
          @change="updateRememberVolume"
        />
        <FtToggleSwitch
          v-if="!IS_IOS"
          :label="t('Settings.Player Settings.Normalize Loudness')"
          :compact="true"
          :default-value="store.getters.getNormalizeLoudness"
          setting-key="normalizeLoudness"
          :tooltip="t('Tooltips.Player Settings.Normalize Loudness')"
          @change="store.dispatch('updateNormalizeLoudness', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enable Seek History')"
          :compact="true"
          :default-value="store.getters.getEnableSeekHistory"
          setting-key="enableSeekHistory"
          :tooltip="t('Tooltips.Player Settings.Enable Seek History')"
          @change="store.dispatch('updateEnableSeekHistory', $event)"
        />
        <FtToggleSwitch
          :label="t('Global.Ambient Mode')"
          :compact="true"
          :default-value="ambientMode"
          setting-key="ambientMode"
          :tooltip="t('Tooltips.Player Settings.Ambient Mode')"
          @change="updateAmbientMode"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Multiply Seek Interval by Playback Rate')"
          :compact="true"
          :default-value="seekIntervalMultiplyByPlaybackRate"
          setting-key="seekIntervalMultiplyByPlaybackRate"
          :tooltip="t('Tooltips.Player Settings.Multiply Seek Interval by Playback Rate')"
          @change="updateSeekIntervalMultiplyByPlaybackRate"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR && !IS_IOS"
          :label="t('Settings.Player Settings.Ignore Headphone Controls')"
          :compact="true"
          :default-value="store.getters.getIgnoreHeadphoneControls"
          setting-key="ignoreHeadphoneControls"
          :tooltip="t('Tooltips.Player Settings.Ignore Headphone Controls')"
          @change="store.dispatch('updateIgnoreHeadphoneControls', $event)"
        />
      </div>
    </div>
    <FtFlexBox class="playerSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Default Media Format.Default Media Format')"
        :value="defaultVideoFormat"
        setting-key="defaultVideoFormat"
        :select-names="formatNames"
        :select-values="FORMAT_VALUES"
        :tooltip="t('Tooltips.Player Settings.Default Media Format')"
        :icon="['fas', 'file-video']"
        @change="updateDefaultVideoFormat"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
        :value="defaultQuality"
        setting-key="defaultQuality"
        :select-names="qualityNames"
        :select-values="qualityValues"
        :icon="['fas', 'photo-film']"
        @change="updateDefaultQuality"
      />
      <FtSelect
        v-if="IS_CAPACITOR && !IS_IOS"
        size-to-content
        :placeholder="t('Settings.Player Settings.Quality Limit on Metered Networks.Quality Limit on Metered Networks')"
        :value="meteredNetworkQualityLimit"
        setting-key="meteredNetworkQualityLimit"
        :select-names="meteredNetworkQualityLimitNames"
        :select-values="METERED_NETWORK_QUALITY_LIMIT_VALUES"
        :tooltip="t('Settings.Player Settings.Quality Limit on Metered Networks.Tooltip')"
        :icon="['fas', 'signal']"
        @change="updateMeteredNetworkQualityLimit"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        v-if="!IS_CAPACITOR"
        :label="t('Settings.Player Settings.Default Volume')"
        :default-value="defaultVolume"
        setting-key="defaultVolume"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        :disabled="rememberVolume"
        :tooltip="rememberVolume ? t('Tooltips.Player Settings.Default Volume') : ''"
        @change="updateDefaultVolume"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Fast-Forward / Rewind Interval')"
        :default-value="defaultSkipInterval"
        setting-key="defaultSkipInterval"
        :min-value="1"
        :max-value="70"
        :step="1"
        value-extension="s"
        @change="updateDefaultSkipInterval"
      />
    </FtSliderGrid>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Rewind on Resume')"
        :default-value="store.getters.getRewindOnResume"
        setting-key="rewindOnResume"
        :min-value="0"
        :max-value="30"
        :step="1"
        value-extension="s"
        :tooltip="t('Tooltips.Player Settings.Rewind on Resume')"
        @change="store.dispatch('updateRewindOnResume', $event)"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Minimum Pause Before Rewinding')"
        :default-value="store.getters.getRewindOnResumeMinimumPause"
        setting-key="rewindOnResumeMinimumPause"
        :min-value="0"
        :max-value="60"
        :step="1"
        value-extension="s"
        :disabled="store.getters.getRewindOnResume === 0"
        :tooltip="t('Tooltips.Player Settings.Minimum Pause Before Rewinding')"
        @change="store.dispatch('updateRewindOnResumeMinimumPause', $event)"
      />
    </FtSliderGrid>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Autoplay') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Videos')"
          :compact="true"
          :default-value="autoplayVideos"
          setting-key="autoplayVideos"
          @change="updateAutoplayVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Playlists')"
          :compact="true"
          :default-value="autoplayPlaylists"
          setting-key="autoplayPlaylists"
          @change="updateAutoplayPlaylists"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Play Next Video')"
          :compact="true"
          :disabled="hideRecommendedVideos"
          :default-value="playNextVideo"
          setting-key="playNextVideo"
          @change="updatePlayNextVideo"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Skip Unavailable Playlist Videos')"
          :compact="true"
          :default-value="skipUnavailablePlaylistVideos"
          setting-key="skipUnavailablePlaylistVideos"
          @change="updateSkipUnavailablePlaylistVideos"
        />
      </div>
    </div>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Next Video Interval')"
        :default-value="defaultInterval"
        setting-key="defaultInterval"
        :min-value="0"
        :max-value="60"
        :step="1"
        value-extension="s"
        @change="updateDefaultInterval"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Autoplay Interruption Timer')"
        :default-value="defaultAutoplayInterruptionIntervalHours"
        setting-key="defaultAutoplayInterruptionIntervalHours"
        :min-value="1"
        :max-value="12"
        :step="1"
        value-extension="h"
        @change="updateDefaultAutoplayInterruptionIntervalHours"
      />
    </FtSliderGrid>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Playback Speed') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Show Playback Rate Adjusted Timestamp')"
          :compact="true"
          :default-value="showPlaybackRateAdjustedTimestamp"
          setting-key="showPlaybackRateAdjustedTimestamp"
          :tooltip="t('Tooltips.Player Settings.Show Playback Rate Adjusted Timestamp')"
          @change="updateShowPlaybackRateAdjustedTimestamp"
        />
      </div>
    </div>
    <FtFlexBox class="playerSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Video Playback Rate Interval')"
        :value="videoPlaybackRateIntervalString"
        setting-key="videoPlaybackRateInterval"
        :select-names="PLAYBACK_RATE_INTERVAL_VALUES"
        :select-values="PLAYBACK_RATE_INTERVAL_VALUES"
        :icon="['fas', 'gauge']"
        @change="updateVideoPlaybackRateInterval"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Hold to Speed Up.Hold to Speed Up')"
        :value="holdPlaybackRateMultiplier"
        setting-key="holdPlaybackRateMultiplier"
        :select-names="holdPlaybackRateMultiplierNames"
        :select-values="HOLD_PLAYBACK_RATE_MULTIPLIERS"
        :icon="['fas', 'forward-fast']"
        :tooltip="t('Tooltips.Player Settings.Hold to Speed Up')"
        @change="updateHoldPlaybackRateMultiplier"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Default Playback Rate')"
        :default-value="defaultPlayback"
        setting-key="defaultPlayback"
        :min-value="videoPlaybackRateInterval"
        :max-value="maxVideoPlaybackRate"
        :step="videoPlaybackRateInterval"
        value-extension="x"
        @change="updateDefaultPlayback"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Max Video Playback Rate')"
        :default-value="maxVideoPlaybackRate"
        setting-key="maxVideoPlaybackRate"
        :min-value="2"
        :max-value="10"
        :step="1"
        value-extension="x"
        @change="updateMaxVideoPlaybackRate"
      />
    </FtSliderGrid>
    <FtFlexBox>
      <FtToggleSwitch
        class="quickPlaybackSpeedToggle"
        :label="t('Settings.Player Settings.Use Quick Playback Speed Bar')"
        :compact="true"
        :default-value="useQuickPlaybackSpeedBar"
        setting-key="useQuickPlaybackSpeedBar"
        :tooltip="t('Tooltips.Player Settings.Use Quick Playback Speed Bar')"
        @change="updateUseQuickPlaybackSpeedBar"
      />
      <div class="settingButtonWithSync quickPlaybackSpeedCustomizeButton">
        <FtButton
          data-settings-subpage="quick-playback-speed"
          :label="t('Settings.Player Settings.Customize Quick Playback Speed Bar')"
          :icon="['fas', 'sliders']"
          :disabled="!useQuickPlaybackSpeedBar"
          @click="showQuickPlaybackSpeedBarManager = true"
        />
        <FtSyncedSettingIndicator setting-key="quickPlaybackSpeedBarOptions" />
      </div>
    </FtFlexBox>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Player Controls') }}
    </h4>
    <div class="switchColumnGrid playerControlsGrid">
      <div class="switchColumn">
        <h5 class="controlGroupTitle">
          {{ t('Settings.Player Settings.Player Controls.Audio') }}
        </h5>
        <FtToggleSwitch
          v-if="!IS_IOS"
          :label="t('Video.Player.Volume Boost.Volume Boost')"
          :description="t('Settings.Player Settings.Player Controls.Volume Boost Description')"
          :icon="['fas', 'volume-high']"
          :compact="true"
          :default-value="store.getters.getShowVolumeBoostToggle"
          setting-key="showVolumeBoostToggle"
          @change="store.dispatch('updateShowVolumeBoostToggle', $event)"
        />
        <FtToggleSwitch
          v-if="!IS_IOS"
          :label="t('Settings.Player Settings.Mono Audio')"
          :description="t('Settings.Player Settings.Player Controls.Mono Audio Description')"
          :icon="['fas', 'speaker']"
          :compact="true"
          :default-value="store.getters.getShowMonoAudioToggle"
          setting-key="showMonoAudioToggle"
          @change="store.dispatch('updateShowMonoAudioToggle', $event)"
        />
        <FtToggleSwitch
          :label="t('Video.Player.Music Mode')"
          :description="t('Settings.Player Settings.Player Controls.Music Mode Description')"
          :icon="['fas', 'headphones']"
          :compact="true"
          :default-value="store.getters.getShowMusicModeToggle"
          setting-key="showMusicModeToggle"
          @change="store.dispatch('updateShowMusicModeToggle', $event)"
        />
        <FtToggleSwitch
          v-if="!IS_IOS"
          :label="t('Settings.Player Settings.Skip Silence')"
          :description="t('Settings.Player Settings.Player Controls.Skip Silence Description')"
          :icon="['fas', 'forward-step']"
          :compact="true"
          :default-value="showSkipSilenceButton"
          setting-key="showSkipSilenceButton"
          @change="updateShowSkipSilenceButton"
        />
        <FtToggleSwitch
          v-if="!IS_IOS"
          class="nestedSwitch"
          :label="t('Settings.Player Settings.Player Controls.On by Default')"
          :description="t('Settings.Player Settings.Player Controls.On by Default Description')"
          :compact="true"
          :disabled="!showSkipSilenceButton"
          :default-value="enableSkipSilenceByDefault"
          setting-key="enableSkipSilenceByDefault"
          @change="updateEnableSkipSilenceByDefault"
        />
      </div>
      <div class="switchColumn">
        <h5 class="controlGroupTitle">
          {{ t('Settings.Player Settings.Player Controls.Video') }}
        </h5>
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Lights Off')"
          :description="t('Settings.Player Settings.Player Controls.Lights Off Description')"
          :icon="['fas', 'moon']"
          :compact="true"
          :default-value="showLightsOffToggle"
          setting-key="showLightsOffToggle"
          @change="store.dispatch('updateShowLightsOffToggle', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Mirror Video')"
          :description="t('Settings.Player Settings.Player Controls.Mirror Video Description')"
          :icon="['fas', 'flip-horizontal']"
          :compact="true"
          :default-value="store.getters.getShowMirrorVideoToggle"
          setting-key="showMirrorVideoToggle"
          @change="store.dispatch('updateShowMirrorVideoToggle', $event)"
        />
        <FtToggleSwitch
          :label="t('Video.Player.Rotate Video.Rotate Video')"
          :description="t('Settings.Player Settings.Player Controls.Rotate Video Description')"
          :icon="['fas', 'rotate-right']"
          :compact="true"
          :default-value="store.getters.getShowRotateVideoMenu"
          setting-key="showRotateVideoMenu"
          @change="store.dispatch('updateShowRotateVideoMenu', $event)"
        />
        <template v-if="USING_ELECTRON || IS_CAPACITOR">
          <h5 class="controlGroupTitle">
            {{ t('Settings.Player Settings.Player Controls.Casting') }}
          </h5>
          <FtSelect
            multiple
            class="castProtocolsSelect"
            :placeholder="t('Settings.Player Settings.Player Controls.Cast To')"
            :empty-label="t('Global.Off')"
            :value="store.getters.getCastProtocols"
            setting-key="castProtocols"
            :select-names="castProtocolOptions.map(({ name }) => name)"
            :select-values="castProtocolOptions.map(({ value }) => value)"
            :icon="['fas', 'cast']"
            :tooltip="castProtocolsTooltip"
            tooltip-allow-newlines
            @change="updateCastProtocols"
          />
        </template>
      </div>
      <!-- Alone in its row, this group is centered below the two above. -->
      <div class="switchColumn">
        <h5 class="controlGroupTitle">
          {{ t('Settings.Player Settings.Player Controls.Seek Bar and Overlay') }}
        </h5>
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Player Controls.Seek Bar Filmstrip')"
          :description="t('Settings.Player Settings.Player Controls.Seek Bar Filmstrip Description')"
          :icon="['fas', 'film']"
          :compact="true"
          :default-value="store.getters.getShowSeekBarFilmstrip"
          setting-key="showSeekBarFilmstrip"
          @change="store.dispatch('updateShowSeekBarFilmstrip', $event)"
        />
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Player Controls.Center Play Button')"
          :description="t('Settings.Player Settings.Player Controls.Center Play Button Description')"
          :icon="['fas', 'circle-play']"
          :compact="true"
          :default-value="displayVideoPlayButton"
          setting-key="displayVideoPlayButton"
          @change="updateDisplayVideoPlayButton"
        />
      </div>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Gestures') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          v-if="!IS_CAPACITOR"
          :label="t('Settings.Player Settings.Scroll Volume Over Video Player')"
          :compact="true"
          :disabled="videoSkipMouseScroll"
          :default-value="videoVolumeMouseScroll"
          setting-key="videoVolumeMouseScroll"
          @change="updateVideoVolumeMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Scroll Playback Rate Over Video Player')"
          :compact="true"
          :default-value="videoPlaybackRateMouseScroll"
          setting-key="videoPlaybackRateMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Scroll Playback Rate Over Video Player')"
          @change="updateVideoPlaybackRateMouseScroll"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Swipe Up or Down to Enter or Exit Fullscreen')"
          :compact="true"
          :default-value="enableMobileFullscreenSwipe"
          setting-key="enableMobileFullscreenSwipe"
          @change="updateEnableMobileFullscreenSwipe"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Swipe Left or Right to Seek in Fullscreen')"
          :compact="true"
          :default-value="store.getters.getEnableMobileFullscreenSeek"
          setting-key="enableMobileFullscreenSeek"
          @change="store.dispatch('updateEnableMobileFullscreenSeek', $event)"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Swipe Gestures.Fullscreen Brightness')"
          :compact="true"
          :default-value="store.getters.getMobileFullscreenBrightness"
          setting-key="mobileFullscreenBrightness"
          @change="store.dispatch('updateMobileFullscreenBrightness', $event)"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Skip by Scrolling Over Video Player')"
          :compact="true"
          :disabled="videoVolumeMouseScroll"
          :default-value="videoSkipMouseScroll"
          setting-key="videoSkipMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Skip by Scrolling Over Video Player')"
          @change="updateVideoSkipMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enable Video Zoom')"
          :compact="true"
          :default-value="enableVideoZoom"
          setting-key="enableVideoZoom"
          :tooltip="t('Tooltips.Player Settings.Enable Video Zoom')"
          @change="updateEnableVideoZoom"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Show Swipe to Seek Preview')"
          :compact="true"
          :default-value="store.getters.getShowMobileSeekPreview"
          :disabled="!store.getters.getEnableMobileFullscreenSeek"
          setting-key="showMobileSeekPreview"
          @change="store.dispatch('updateShowMobileSeekPreview', $event)"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Double-Tap With Two Fingers to Skip Chapters')"
          :compact="true"
          :default-value="store.getters.getEnableMobileChapterTaps"
          setting-key="enableMobileChapterTaps"
          :tooltip="t('Tooltips.Player Settings.Double-Tap With Two Fingers to Skip Chapters')"
          @change="store.dispatch('updateEnableMobileChapterTaps', $event)"
        />
      </div>
    </div>
    <FtFlexBox
      v-if="IS_CAPACITOR"
      class="playerSelectGrid"
    >
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Swipe Gestures.Left')"
        :value="store.getters.getMobileLeftSwipeAction"
        setting-key="mobileLeftSwipeAction"
        :select-names="mobileSwipeActionNames"
        :select-values="MOBILE_SWIPE_ACTION_VALUES"
        :tooltip="t('Settings.Player Settings.Swipe Gestures.Hint')"
        :icon="MOBILE_SWIPE_ACTION_ICONS[store.getters.getMobileLeftSwipeAction]"
        @change="store.dispatch('updateMobileLeftSwipeAction', $event)"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Swipe Gestures.Right')"
        :value="store.getters.getMobileRightSwipeAction"
        setting-key="mobileRightSwipeAction"
        :select-names="mobileSwipeActionNames"
        :select-values="MOBILE_SWIPE_ACTION_VALUES"
        :tooltip="t('Settings.Player Settings.Swipe Gestures.Hint')"
        :icon="MOBILE_SWIPE_ACTION_ICONS[store.getters.getMobileRightSwipeAction]"
        @change="store.dispatch('updateMobileRightSwipeAction', $event)"
      />
    </FtFlexBox>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Viewing Modes') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Keep Player Visible When Scrolling')"
          :tooltip="t('Settings.Player Settings.Keep Player Visible When Scrolling Tooltip')"
          :compact="true"
          :default-value="store.getters.getKeepPlayerVisibleOnScroll"
          setting-key="keepPlayerVisibleOnScroll"
          @change="store.dispatch('updateKeepPlayerVisibleOnScroll', $event)"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enter Fullscreen on Display Rotate')"
          :compact="true"
          :default-value="enterFullscreenOnDisplayRotate"
          setting-key="enterFullscreenOnDisplayRotate"
          @change="updateEnterFullscreenOnDisplayRotate"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR && !IS_IOS"
          :label="t('Settings.Player Settings.Keep Status Bar Hidden in Fullscreen')"
          :tooltip="t('Tooltips.Player Settings.Keep Status Bar Hidden in Fullscreen')"
          :compact="true"
          :default-value="store.getters.getKeepStatusBarHiddenInFullscreen"
          setting-key="keepStatusBarHiddenInFullscreen"
          @change="store.dispatch('updateKeepStatusBarHiddenInFullscreen', $event)"
        />
      </div>
      <div
        v-if="USING_ELECTRON || IS_CAPACITOR"
        class="switchColumn"
      >
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Keep Playing After Leaving Video')"
          :compact="true"
          :default-value="store.getters.getKeepPlayingOnNavigation"
          setting-key="keepPlayingOnNavigation"
          @change="store.dispatch('updateKeepPlayingOnNavigation', $event)"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR && !IS_IOS"
          :label="t('Settings.Player Settings.Ignore System Rotation Lock for Fullscreen')"
          :tooltip="t('Tooltips.Player Settings.Ignore System Rotation Lock for Fullscreen')"
          :compact="true"
          :disabled="!enterFullscreenOnDisplayRotate"
          :default-value="fullscreenRotationIgnoresSystemLock"
          setting-key="fullscreenRotationIgnoresSystemLock"
          @change="updateFullscreenRotationIgnoresSystemLock"
        />
        <FtToggleSwitch
          v-if="IS_CAPACITOR"
          :label="t('Settings.Player Settings.Rotate Wide Videos to Landscape in Fullscreen')"
          :compact="true"
          :default-value="rotateFullscreenToLandscape"
          setting-key="rotateFullscreenToLandscape"
          @change="updateRotateFullscreenToLandscape"
        />
      </div>
    </div>
    <FtFlexBox
      v-if="IS_CAPACITOR"
      class="autoPictureInPictureSettings"
    >
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Auto Picture in Picture.Auto Picture in Picture')"
        :compact="true"
        :default-value="mobileAutoPictureInPicture"
        setting-key="mobileAutoPictureInPicture"
        @change="updateMobileAutoPictureInPicture"
      />
    </FtFlexBox>
    <FtFlexBox
      v-else
      class="autoPictureInPictureSettings"
    >
      <FtCheckboxList
        v-model="autoPictureInPictureTriggers"
        :title="t('Settings.Player Settings.Auto Picture in Picture.Auto Picture in Picture')"
        :labels="autoPictureInPictureTriggerLabels"
        :values="AUTO_PIP_TRIGGER_VALUES"
        :disabled-values="autoPictureInPictureDisabledTriggers"
        setting-key="autoPictureInPictureTriggers"
        :tooltips="autoPictureInPictureTriggerTooltips"
      />
    </FtFlexBox>
    <FtFlexBox class="playerSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Default Viewing Mode.Default Viewing Mode')"
        :value="defaultViewingMode"
        setting-key="defaultViewingMode"
        :select-names="viewingModeNames"
        :select-values="viewingModeValues"
        :tooltip="t('Settings.Player Settings.Default Viewing Mode.Tooltip')"
        :icon="['fas', 'expand']"
        @change="updateDefaultViewingMode"
      />
    </FtFlexBox>
    <PlayerInterfaceSettings />
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Shorts') }}
    </h4>
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Use YouTube-style Shorts')"
          :compact="true"
          :default-value="useCustomShortsPlayer"
          setting-key="useCustomShortsPlayer"
          :tooltip="t('Tooltips.Player Settings.Use YouTube-style Shorts')"
          @change="updateUseCustomShortsPlayer"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Loop Shorts')"
          :compact="true"
          :disabled="!useCustomShortsPlayer"
          :default-value="loopShorts"
          setting-key="loopShorts"
          :tooltip="t('Tooltips.Player Settings.Loop Shorts')"
          @change="updateLoopShorts"
        />
      </div>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Screenshots') }}
    </h4>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Screenshot.Enable')"
        :default-value="enableScreenshot"
        setting-key="enableScreenshot"
        @change="updateEnableScreenshot"
      />
    </FtFlexBox>
    <div v-if="enableScreenshot">
      <FtFlexBox>
        <FtSelect
          size-to-content
          :placeholder="t('Settings.Player Settings.Screenshot.Mode')"
          :value="screenshotMode"
          setting-key="screenshotMode"
          :select-names="screenshotModeNames"
          :select-values="screenshotModeValues"
          :icon="['fas', 'expand']"
          @change="handleUpdateScreenshotMode"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="screenshotMode !== 'clipboard'"
        class="screenshotFormatRow"
      >
        <FtSelect
          size-to-content
          :placeholder="t('Settings.Player Settings.Screenshot.Format Label')"
          :value="screenshotFormat"
          setting-key="screenshotFormat"
          :select-names="SCREENSHOT_FORMAT_NAMES"
          :select-values="SCREENSHOT_FORMAT_VALUES"
          :option-groups="SCREENSHOT_FORMAT_GROUPS"
          :option-group-labels="{
            legacy: t('Settings.Player Settings.Screenshot.Legacy Formats'),
            modern: t('Settings.Player Settings.Screenshot.Modern Formats')
          }"
          :icon="['fas', 'file-image']"
          @change="handleUpdateScreenshotFormat"
        />
        <FtSlider
          :label="t('Settings.Player Settings.Screenshot.Quality Label')"
          :default-value="screenshotQuality"
          setting-key="screenshotQuality"
          :min-value="0"
          :max-value="100"
          :step="1"
          value-extension="%"
          :disabled="screenshotFormat === 'png'"
          @change="updateScreenshotQuality"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="(USING_ELECTRON || IS_CAPACITOR) && screenshotMode === 'default_folder'"
        class="screenshotFolderContainer"
      >
        <FtInput
          class="screenshotFolderPath"
          :label="t('Settings.Player Settings.Screenshot.Folder Label')"
          :icon="['fas', 'folder-open']"
          placeholder="/path/to/screenshots"
          :value="displayAndroidPath(screenshotFolder)"
          :show-action-button="false"
          :disabled="true"
        />
        <FtButton
          :label="t('Settings.Player Settings.Screenshot.Folder Button')"
          :icon="['fas', 'folder-open']"
          class="screenshotFolderButton"
          @click="chooseScreenshotFolder"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="screenshotMode !== 'clipboard'"
        class="screenshotFolderContainer"
      >
        <FtInput
          class="screenshotFilenamePatternInput"
          :tooltip="t('Settings.Player Settings.Screenshot.File Name Tooltip')"
          :label="t('Settings.Player Settings.Screenshot.File Name Label')"
          :icon="['fas', 'file-lines']"
          placeholder="%Y-%M-%D_%H-%N-%S"
          :value="screenshotFilenamePattern"
          setting-key="screenshotFilenamePattern"
          :show-action-button="false"
          @input="handleScreenshotFilenamePatternChanged"
        />
        <FtInput
          class="screenshotFilenamePatternExample"
          :label="t('Form Inputs.Filename Preview')"
          :icon="['fas', 'file-image']"
          placeholder="2026-10-04_12-30-00.png"
          :value="screenshotFilenameExample"
          :show-action-button="false"
          :disabled="true"
        />
      </FtFlexBox>
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Timestamp Notes') }}
    </h4>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Timestamp Notes.Enable')"
        :default-value="enableTimestampNotes"
        setting-key="enableTimestampNotes"
        :tooltip="t('Tooltips.Player Settings.Enable Timestamp Notes')"
        @change="store.dispatch('updateEnableTimestampNotes', $event)"
      />
    </FtFlexBox>
    <template v-if="USING_ELECTRON && enableTimestampNotes">
      <FtFlexBox>
        <FtInput
          class="obsidianVaultInput"
          :label="t('Settings.Player Settings.Timestamp Notes.Obsidian Vault')"
          :placeholder="t('Form Inputs.Vault Name Hint')"
          :tooltip="t('Tooltips.Player Settings.Obsidian Vault')"
          setting-key="obsidianVault"
          :icon="['fas', 'file-export']"
          :value="obsidianVault"
          :maxlength="255"
          :show-action-button="false"
          @change="store.dispatch('updateObsidianVault', $event.trim())"
        />
      </FtFlexBox>
    </template>
    <FtSettingsSubpage
      :open="showQuickPlaybackSpeedBarManager"
      :title="t('Settings.Player Settings.Quick Playback Speed Bar Manager')"
      :icon="['fas', 'gauge-high']"
      flush
      @close="showQuickPlaybackSpeedBarManager = false"
    >
      <template #breadcrumb-action>
        <FtSyncedSettingIndicator setting-key="quickPlaybackSpeedBarOptions" />
      </template>
      <div class="quickPlaybackSpeedManager">
        <div class="quickPlaybackSpeedToolbar">
          <FtFlexBox class="quickPlaybackSpeedToolbarActions">
            <FtButton
              :label="t('Settings.Player Settings.Add Playback Speed')"
              :icon="['fas', 'plus']"
              :disabled="quickPlaybackSpeedBarEntries.length >= QUICK_PLAYBACK_SPEED_LIMIT"
              @click="addQuickPlaybackSpeed"
            />
            <FtButton
              :label="t('Settings.Player Settings.Reset Quick Playback Speed Bar')"
              :icon="['fas', 'arrow-rotate-left']"
              :disabled="!hasModifiedQuickPlaybackSpeedBarOptions"
              @click="resetQuickPlaybackSpeedBarOptions"
            />
          </FtFlexBox>
        </div>
        <div
          ref="quickPlaybackSpeedScrollRef"
          v-overlay-scrollbars
          class="quickPlaybackSpeedScroll"
        >
          <div
            ref="quickPlaybackSpeedListRef"
            class="quickPlaybackSpeedList"
          >
            <div
              v-for="(option, index) in quickPlaybackSpeedBarEntries"
              :key="option.id"
              class="quickPlaybackSpeedEntry"
              :class="{
                dragging: draggedQuickPlaybackSpeedId === option.id,
                settling: isQuickPlaybackSpeedDragSettling,
                suppressTransition: suppressQuickPlaybackSpeedDragTransitions
              }"
              :data-quick-playback-speed-index="index"
              :data-quick-playback-speed-id="option.id"
              :style="getQuickPlaybackSpeedEntryStyle(option.id)"
            >
              <button
                class="quickPlaybackSpeedDragHandle"
                type="button"
                :title="t('Settings.Player Settings.Reorder Playback Speed')"
                :aria-label="t('Settings.Player Settings.Reorder Playback Speed')"
                @pointerdown.prevent="startQuickPlaybackSpeedDrag(index, $event)"
              >
                <FtIcon :icon="['fas', 'bars']" />
              </button>
              <div class="quickPlaybackSpeedFields">
                <div
                  v-if="editingQuickPlaybackSpeedNameId !== option.id"
                  class="quickPlaybackSpeedNameRow"
                >
                  <span class="quickPlaybackSpeedName">
                    {{ getQuickPlaybackSpeedDisplayName(option) }}
                  </span>
                  <FtIconButton
                    class="quickPlaybackSpeedIconButton"
                    :title="t('Settings.Player Settings.Edit Playback Speed Name')"
                    :icon="['fas', 'pen-to-square']"
                    theme="base-no-default"
                    @click="editingQuickPlaybackSpeedNameId = option.id"
                  />
                </div>
                <div
                  v-else
                  class="quickPlaybackSpeedNameEditRow"
                >
                  <FtInput
                    class="quickPlaybackSpeedNameInput"
                    :label="t('Settings.Player Settings.Playback Speed Name')"
                    :icon="['fas', 'font']"
                    :placeholder="getAutomaticQuickPlaybackSpeedName(option.speed)"
                    :value="option.name"
                    :show-action-button="false"
                    @input="(value) => updateQuickPlaybackSpeedName(option.id, value)"
                  />
                  <FtIconButton
                    class="quickPlaybackSpeedIconButton"
                    :title="t('Settings.Player Settings.Use Automatic Playback Speed Name')"
                    :icon="['fas', 'arrow-rotate-left']"
                    theme="base-no-default"
                    @click="resetQuickPlaybackSpeedName(option.id)"
                  />
                </div>
              </div>
              <FtInput
                class="quickPlaybackSpeedValueField"
                :change-filter="normalizeQuickPlaybackSpeed"
                :icon="['fas', 'gauge-high']"
                input-type="number"
                :label="t('Settings.Player Settings.Playback Speed')"
                :placeholder="t('Form Inputs.Example', { example: '1.25' })"
                min="0.01"
                step="0.01"
                :value="String(option.speed)"
                :show-action-button="false"
                @change="updateQuickPlaybackSpeed(option.id, $event)"
              />
              <FtIconButton
                class="quickPlaybackSpeedIconButton delete"
                :disabled="quickPlaybackSpeedBarEntries.length <= 1"
                :title="t('Delete')"
                :icon="['fas', 'trash']"
                theme="base-no-default"
                @click="deleteQuickPlaybackSpeed(option.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </FtSettingsSubpage>
  </FtSettingsSection>
</template>

<script setup>
import FtIconButton from '../../FtIconButton/FtIconButton.vue'
import { displayAndroidPath, chooseAndroidDirectory } from '../../../helpers/androidStorage'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import PlayerInterfaceSettings from './PlayerInterfaceSettings.vue'
import FtCheckboxList from '../../FtCheckboxList/FtCheckboxList.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSliderGrid from '../../FtSliderGrid/FtSliderGrid.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtButton from '../../FtButton/FtButton.vue'
import FtSyncedSettingIndicator from '../../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtInput from '../../FtInput/FtInput.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'

import store from '../../../store/index'
import { showToast } from '../../../helpers/utils'
import { DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS } from '../../../../constants'
import { clampOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import {
  getHoldPlaybackRateMultiplierNames,
  HOLD_PLAYBACK_RATE_MULTIPLIERS,
  normalizeHoldPlaybackRateMultiplier,
} from '../../../helpers/holdPlaybackRate.js'
import { initializePlatformInfo, supportsAutoPictureInPictureMinimize } from '../../../helpers/platform'
import { getAutoQualityFallback, playbackEngineSupportsAutoQuality } from '../../../helpers/player/autoQuality'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()

const QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX = 5
const QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS = 180
const QUICK_PLAYBACK_SPEED_LIMIT = 14

/** @type {boolean} */
const USING_ELECTRON = process.env.IS_ELECTRON
const IS_CAPACITOR = process.env.IS_CAPACITOR
const IS_IOS = process.env.IS_IOS
const MOBILE_SWIPE_ACTION_VALUES = ['disabled', 'brightness', 'volume', 'speed']
const MOBILE_SWIPE_ACTION_ICONS = {
  disabled: ['fas', 'xmark'],
  brightness: ['fas', 'sun'],
  volume: ['fas', 'volume-high'],
  speed: ['fas', 'gauge-high'],
}
const mobileSwipeActionNames = computed(() => [
  t('Settings.Player Settings.Swipe Gestures.Disabled'),
  t('Settings.Player Settings.Swipe Gestures.Brightness'),
  t('Settings.Player Settings.Swipe Gestures.Volume'),
  t('Settings.Player Settings.Playback Speed'),
])

/** @type {import('vue').ComputedRef<boolean>} */
const enableSubtitlesByDefault = computed(() => store.getters.getEnableSubtitlesByDefault)

/**
 * @param {boolean} value
 */
function updateEnableSubtitlesByDefault(value) {
  store.dispatch('updateEnableSubtitlesByDefault', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoVolumeMouseScroll = computed(() => store.getters.getVideoVolumeMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoVolumeMouseScroll(value) {
  store.dispatch('updateVideoVolumeMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberVolume = computed(() => store.getters.getRememberVolume)

/**
 * @param {boolean} value
 */
function updateRememberVolume(value) {
  store.dispatch('updateRememberVolume', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showLightsOffToggle = computed(() => store.getters.getShowLightsOffToggle)

const showSkipSilenceButton = computed(() => store.getters.getShowSkipSilenceButton)

// iOS can only cast with DLNA.
const castProtocolOptions = computed(() => [
  {
    value: 'googleCast',
    name: t('Settings.Player Settings.Player Controls.Google Cast'),
    description: t('Settings.Player Settings.Player Controls.Google Cast Description'),
  },
  {
    value: 'fcast',
    name: t('Settings.Player Settings.Player Controls.FCast'),
    description: t('Settings.Player Settings.Player Controls.FCast Description'),
  },
  {
    value: 'dlna',
    name: t('Settings.Player Settings.Player Controls.DLNA'),
    description: t('Settings.Player Settings.Player Controls.DLNA Description'),
  },
].filter(({ value }) => value === 'dlna' || USING_ELECTRON || !IS_IOS))

/**
 * Keeps protocols that this platform doesn't offer, which synced settings can
 * hold for other devices.
 * @param {string[]} protocols
 */
function updateCastProtocols(protocols) {
  const offered = castProtocolOptions.value.map(({ value }) => value)
  store.dispatch('updateCastProtocols', [
    ...protocols,
    ...store.getters.getCastProtocols.filter(protocol => !offered.includes(protocol)),
  ])
}

const castProtocolsTooltip = computed(() => castProtocolOptions.value
  .map(({ name, description }) => `${name}: ${description}`)
  .join('\n'))

/**
 * @param {boolean} value
 */
function updateShowSkipSilenceButton(value) {
  store.dispatch('updateShowSkipSilenceButton', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableSkipSilenceByDefault = computed(() => store.getters.getEnableSkipSilenceByDefault)

/**
 * @param {boolean} value
 */
function updateEnableSkipSilenceByDefault(value) {
  store.dispatch('updateEnableSkipSilenceByDefault', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableVideoZoom = computed(() => store.getters.getEnableVideoZoom)

/**
 * @param {boolean} value
 */
function updateEnableVideoZoom(value) {
  store.dispatch('updateEnableVideoZoom', value)
}

/** @type {import('vue').ComputedRef<number>} */
const holdPlaybackRateMultiplier = computed(() => normalizeHoldPlaybackRateMultiplier(store.getters.getHoldPlaybackRateMultiplier))

const holdPlaybackRateMultiplierNames = computed(() => getHoldPlaybackRateMultiplierNames(t))

/**
 * @param {number} value
 */
function updateHoldPlaybackRateMultiplier(value) {
  store.dispatch('updateHoldPlaybackRateMultiplier', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoPlaybackRateMouseScroll = computed(() => store.getters.getVideoPlaybackRateMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoPlaybackRateMouseScroll(value) {
  store.dispatch('updateVideoPlaybackRateMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const videoSkipMouseScroll = computed(() => store.getters.getVideoSkipMouseScroll)

/**
 * @param {boolean} value
 */
function updateVideoSkipMouseScroll(value) {
  store.dispatch('updateVideoSkipMouseScroll', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const seekIntervalMultiplyByPlaybackRate = computed(() => store.getters.getSeekIntervalMultiplyByPlaybackRate)

/**
 * @param {boolean} value
 */
function updateSeekIntervalMultiplyByPlaybackRate(value) {
  store.dispatch('updateSeekIntervalMultiplyByPlaybackRate', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const playNextVideo = computed(() => store.getters.getPlayNextVideo)

/**
 * @param {boolean} value
 */
function updatePlayNextVideo(value) {
  store.dispatch('updatePlayNextVideo', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideRecommendedVideos = computed(() => store.getters.getHideRecommendedVideos)

/** @type {import('vue').ComputedRef<boolean>} */
const autoplayPlaylists = computed(() => store.getters.getAutoplayPlaylists)

const skipUnavailablePlaylistVideos = computed(() => store.getters.getSkipUnavailablePlaylistVideos)

/**
 * @param {boolean} value
 */
function updateAutoplayPlaylists(value) {
  store.dispatch('updateAutoplayPlaylists', value)
}

function updateSkipUnavailablePlaylistVideos(value) {
  store.dispatch('updateSkipUnavailablePlaylistVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoplayVideos = computed(() => store.getters.getAutoplayVideos)

/**
 * @param {boolean} value
 */
function updateAutoplayVideos(value) {
  store.dispatch('updateAutoplayVideos', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useCustomShortsPlayer = computed(() => store.getters.getUseCustomShortsPlayer)

/**
 * @param {boolean} value
 */
function updateUseCustomShortsPlayer(value) {
  store.dispatch('updateUseCustomShortsPlayer', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const loopShorts = computed(() => store.getters.getLoopShorts)

/**
 * @param {boolean} value
 */
function updateLoopShorts(value) {
  store.dispatch('updateLoopShorts', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoOpenChapters = computed(() => store.getters.getAutoOpenChapters)

/**
 * @param {boolean} value
 */
function updateAutoOpenChapters(value) {
  store.dispatch('updateAutoOpenChapters', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const displayVideoPlayButton = computed(() => store.getters.getDisplayVideoPlayButton)

/**
 * @param {boolean} value
 */
function updateDisplayVideoPlayButton(value) {
  store.dispatch('updateDisplayVideoPlayButton', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const ambientMode = computed(() => store.getters.getAmbientMode)

/**
 * @param {boolean} value
 */
function updateAmbientMode(value) {
  store.dispatch('updateAmbientMode', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const musicVisualizer = computed(() => store.getters.getMusicVisualizer)

/**
 * @param {boolean} value
 */
function updateMusicVisualizer(value) {
  store.dispatch('updateMusicVisualizer', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enterFullscreenOnDisplayRotate = computed(() => store.getters.getEnterFullscreenOnDisplayRotate)

/**
 * @param {boolean} value
 */
function updateEnterFullscreenOnDisplayRotate(value) {
  store.dispatch('updateEnterFullscreenOnDisplayRotate', value)
}

const fullscreenRotationIgnoresSystemLock = computed(() => store.getters.getFullscreenRotationIgnoresSystemLock)

/**
 * @param {boolean} value
 */
function updateFullscreenRotationIgnoresSystemLock(value) {
  store.dispatch('updateFullscreenRotationIgnoresSystemLock', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const rotateFullscreenToLandscape = computed(() => store.getters.getRotateFullscreenToLandscape)

/**
 * @param {boolean} value
 */
function updateRotateFullscreenToLandscape(value) {
  store.dispatch('updateRotateFullscreenToLandscape', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enableMobileFullscreenSwipe = computed(() => store.getters.getEnableMobileFullscreenSwipe)

/**
 * @param {boolean} value
 */
function updateEnableMobileFullscreenSwipe(value) {
  store.dispatch('updateEnableMobileFullscreenSwipe', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const continuePlaybackWhenScreenIsLocked = computed(() => store.getters.getContinuePlaybackWhenScreenIsLocked)

/** @param {boolean} value */
function updateContinuePlaybackWhenScreenIsLocked(value) {
  store.dispatch('updateContinuePlaybackWhenScreenIsLocked', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showPlaybackRateAdjustedTimestamp = computed(() => store.getters.getShowPlaybackRateAdjustedTimestamp)

/**
 * @param {boolean} value
 */
function updateShowPlaybackRateAdjustedTimestamp(value) {
  store.dispatch('updateShowPlaybackRateAdjustedTimestamp', value)
}

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

// Android starts these in its rotation fullscreen, which needs no user gesture.
const fullscreenViewingModesSupported = process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS)

const defaultViewingMode = computed(() => {
  /** @type {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} */
  const defaultViewingMode = store.getters.getDefaultViewingMode

  if ((process.env.IS_CAPACITOR && ['fullwindow', 'fullwindow_always_on'].includes(defaultViewingMode)) ||
    (defaultViewingMode === 'external_player' && (!process.env.IS_ELECTRON || externalPlayer.value === '')) ||
    (!process.env.IS_ELECTRON && defaultViewingMode === 'pip') ||
    (!fullscreenViewingModesSupported && ['fullscreen', 'fullscreen_always_on'].includes(defaultViewingMode))) {
    return 'default'
  }

  return defaultViewingMode
})

const viewingModeNames = computed(() => {
  const viewingModeNames = [
    t('Settings.General Settings.Thumbnail Preference.Default'),
    t('Settings.Player Settings.Default Viewing Mode.Theater'),
    ...(!process.env.IS_CAPACITOR
      ? [
          t('Video.Player.Full Window'),
          t('Settings.Player Settings.Default Viewing Mode.Full Window (Always On)'),
        ]
      : []),

    ...fullscreenViewingModesSupported
      ? [
          t('Settings.Player Settings.Default Viewing Mode.Full Screen'),
          t('Settings.Player Settings.Default Viewing Mode.Full Screen (Always On)'),
        ]
      : [],
    ...process.env.IS_ELECTRON ? [t('Settings.Player Settings.Default Viewing Mode.Picture in Picture')] : []
  ]

  if (process.env.IS_ELECTRON && externalPlayer.value !== '') {
    viewingModeNames.push(
      t('Settings.Player Settings.Default Viewing Mode.External Player', { externalPlayerName: externalPlayer.value })
    )
  }

  return viewingModeNames
})

const viewingModeValues = computed(() => {
  const viewingModeValues = [
    'default',
    'theatre',
    ...(!process.env.IS_CAPACITOR ? ['fullwindow', 'fullwindow_always_on'] : []),

    ...fullscreenViewingModesSupported ? ['fullscreen', 'fullscreen_always_on'] : [],
    ...process.env.IS_ELECTRON ? ['pip'] : []
  ]

  if (process.env.IS_ELECTRON && externalPlayer.value !== '') {
    viewingModeValues.push('external_player')
  }

  return viewingModeValues
})

/**
 * @param {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} value
 */
function updateDefaultViewingMode(value) {
  store.dispatch('updateDefaultViewingMode', value)
}

const AUTO_PIP_TRIGGER_VALUES = ['tab', 'minimize', 'blur']

initializePlatformInfo()

const autoPictureInPictureTriggerLabels = computed(() => [
  t('Settings.Player Settings.Auto Picture in Picture.On Tab Change'),
  t('Settings.Player Settings.Auto Picture in Picture.On Window Minimize'),
  t('Settings.Player Settings.Auto Picture in Picture.On Window Hide')
])

// Videos that keep playing in the mini player do not enter Picture-in-Picture on tab changes.
const autoPictureInPictureDisabledTriggers = computed(() => [
  ...(store.getters.getKeepPlayingOnNavigation && (USING_ELECTRON || IS_CAPACITOR) ? ['tab'] : []),
  ...(supportsAutoPictureInPictureMinimize.value ? [] : ['minimize'])
])

const autoPictureInPictureTriggerTooltips = computed(() => ({
  ...(autoPictureInPictureDisabledTriggers.value.includes('tab')
    ? { tab: t('Settings.Player Settings.Auto Picture in Picture.On Tab Change Mini Player') }
    : {}),
  ...(supportsAutoPictureInPictureMinimize.value
    ? {}
    : { minimize: t('Settings.Player Settings.Auto Picture in Picture.Wayland Minimize Unsupported') })
}))

/** @type {import('vue').WritableComputedRef<string[]>} */
const autoPictureInPictureTriggers = computed({
  get: () => store.getters.getAutoPictureInPictureTriggers,
  set: (value) => store.dispatch('updateAutoPictureInPictureTriggers', value)
})

const mobileAutoPictureInPicture = computed(() => store.getters.getMobileAutoPictureInPicture)

function updateMobileAutoPictureInPicture(value) {
  store.dispatch('updateMobileAutoPictureInPicture', value)
}

const FORMAT_VALUES = ['dash', 'legacy', 'audio']

const formatNames = computed(() => [
  t('Settings.Player Settings.Default Media Format.Dash Formats'),
  t('Settings.Player Settings.Default Media Format.Legacy Formats'),
  t('Settings.Player Settings.Default Media Format.Audio Formats')
])

/** @type {import('vue').ComputedRef<'dash' | 'audio' |' legacy'>} */
const defaultVideoFormat = computed(() => store.getters.getDefaultVideoFormat)

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function updateDefaultVideoFormat(value) {
  store.dispatch('updateDefaultVideoFormat', value)
}

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

/**
 * Auto quality is broken with SABR, so it is only offered unless every
 * video's streams use it.
 * @type {import('vue').ComputedRef<boolean>}
 */
const autoQualityAvailable = computed(() => {
  return playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine, store.getters.getBuiltInStreams)
})

const qualityValues = computed(() => {
  return autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES
})

const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),

  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])

/** @type {import('vue').ComputedRef<'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'>} */
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality

  if (value === 'auto' && !autoQualityAvailable.value) { return getAutoQualityFallback() }

  return value
})

/**
 * @param {'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'} value
 */
function updateDefaultQuality(value) {
  store.dispatch('updateDefaultQuality', value)
}

const METERED_NETWORK_QUALITY_LIMIT_VALUES = ['none', ...RESOLUTION_VALUES]

const meteredNetworkQualityLimitNames = computed(() => [
  t('Settings.Player Settings.Quality Limit on Metered Networks.No Limit'),
  ...qualityNames.value.slice(0, RESOLUTION_VALUES.length)
])

/** @type {import('vue').ComputedRef<'none' | '2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144'>} */
const meteredNetworkQualityLimit = computed(() => store.getters.getMeteredNetworkQualityLimit)

/**
 * @param {'none' | '2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144'} value
 */
function updateMeteredNetworkQualityLimit(value) {
  store.dispatch('updateMeteredNetworkQualityLimit', value)
}

const PLAYBACK_RATE_INTERVAL_VALUES = ['0.1', '0.25', '0.5', '1']

/** @type {import('vue').ComputedRef<number>} */
const videoPlaybackRateInterval = computed(() => store.getters.getVideoPlaybackRateInterval)

/** @type {import('vue').ComputedRef<string>} */
const videoPlaybackRateIntervalString = computed(() => store.getters.getVideoPlaybackRateInterval.toString())

/**
 * @param {string} value
 */
function updateVideoPlaybackRateInterval(value) {
  store.dispatch('updateVideoPlaybackRateInterval', parseFloat(value))
}

/** @type {import('vue').ComputedRef<number>} */
const defaultInterval = computed(() => store.getters.getDefaultInterval)

/**
 * @param {number} value
 */
function updateDefaultInterval(value) {
  store.dispatch('updateDefaultInterval', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultAutoplayInterruptionIntervalHours = computed(() => {
  return store.getters.getDefaultAutoplayInterruptionIntervalHours
})

/**
 * @param {number} value
 */
function updateDefaultAutoplayInterruptionIntervalHours(value) {
  store.dispatch('updateDefaultAutoplayInterruptionIntervalHours', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultSkipInterval = computed(() => store.getters.getDefaultSkipInterval)

/**
 * @param {number} value
 */
function updateDefaultSkipInterval(value) {
  store.dispatch('updateDefaultSkipInterval', value)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultVolume = computed(() => Math.round(store.getters.getDefaultVolume * 100))

/**
 * @param {number} value
 */
function updateDefaultVolume(value) {
  store.dispatch('updateDefaultVolume', value / 100)
}

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

/**
 * @param {number} value
 */
function updateDefaultPlayback(value) {
  store.dispatch('updateDefaultPlayback', value)
}

/** @type {import('vue').ComputedRef<number>} */
const maxVideoPlaybackRate = computed(() => store.getters.getMaxVideoPlaybackRate)

/**
 * @param {number} value
 */
function updateMaxVideoPlaybackRate(value) {
  store.dispatch('updateMaxVideoPlaybackRate', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const useQuickPlaybackSpeedBar = computed(() => store.getters.getUseQuickPlaybackSpeedBar)

/**
 * @param {boolean} value
 */
function updateUseQuickPlaybackSpeedBar(value) {
  store.dispatch('updateUseQuickPlaybackSpeedBar', value)
}

/** @type {import('vue').Ref<boolean>} */
const showQuickPlaybackSpeedBarManager = ref(false)

const quickPlaybackSpeedScrollRef = useTemplateRef('quickPlaybackSpeedScrollRef')
const quickPlaybackSpeedListRef = useTemplateRef('quickPlaybackSpeedListRef')
// Deleting, resetting, or a taller viewport can shorten the list below the scroll offset
watch(quickPlaybackSpeedListRef, (list, _, onCleanup) => {
  const scroller = quickPlaybackSpeedScrollRef.value
  if (!list || !scroller) return
  const observer = new ResizeObserver(() => clampOverlayScrollTop(scroller, list))
  observer.observe(list)
  observer.observe(scroller)
  onCleanup(() => observer.disconnect())
})

/** @type {import('vue').Ref<string | null>} */
const editingQuickPlaybackSpeedNameId = ref(null)

/** @type {import('vue').Ref<string | null>} */
const draggedQuickPlaybackSpeedId = ref(null)

/** @type {import('vue').Ref<Record<string, number>>} */
const quickPlaybackSpeedDragOffsets = ref({})

/** @type {import('vue').Ref<boolean>} */
const isQuickPlaybackSpeedDragSettling = ref(false)

/** @type {import('vue').Ref<boolean>} */
const suppressQuickPlaybackSpeedDragTransitions = ref(false)

/** @type {ReturnType<typeof window.setTimeout> | null} */
let quickPlaybackSpeedSettleTimeoutId = null

/** @type {null | {id: string, sourceIndex: number, targetIndex: number, pointerStartY: number, rects: Array<{id: string, top: number, height: number}>, gap: number, started: boolean, moved: boolean, draggedOffset: number}} */
let quickPlaybackSpeedDragSession = null

/** @type {import('vue').ComputedRef<string>} */
const quickPlaybackSpeedBarOptions = computed(() => store.getters.getQuickPlaybackSpeedBarOptions)

/** @type {import('vue').ComputedRef<Array<{id: string, speed: number, name: string}>>} */
const quickPlaybackSpeedBarEntries = computed(() => {
  return parseQuickPlaybackSpeedBarOptions(quickPlaybackSpeedBarOptions.value)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hasModifiedQuickPlaybackSpeedBarOptions = computed(() => {
  return quickPlaybackSpeedBarEntries.value.length !== DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.length ||
    quickPlaybackSpeedBarEntries.value.some((option, index) => {
      const defaultOption = DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS[index]
      return option.speed !== defaultOption.speed || option.name.trim() !== defaultOption.name
    })
})

/**
 * @param {string} value
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function parseQuickPlaybackSpeedBarOptions(value) {
  try {
    const parsedOptions = JSON.parse(value || '[]')

    if (!Array.isArray(parsedOptions)) {
      return getDefaultQuickPlaybackSpeedBarEntries()
    }

    const options = parsedOptions
      .map((option, index) => {
        const speed = Number.parseFloat(option?.speed)

        return {
          id: typeof option?.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
          speed,
          name: typeof option?.name === 'string' ? option.name : '',
        }
      })
      .filter((option) => Number.isFinite(option.speed) && option.speed > 0)

    return options.length > 0 ? options : getDefaultQuickPlaybackSpeedBarEntries()
  } catch (error) {
    console.error('Failed to parse quick playback speed bar options:', error)
    return getDefaultQuickPlaybackSpeedBarEntries()
  }
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getDefaultQuickPlaybackSpeedBarEntries() {
  return DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS.map((option, index) => ({
    id: `default-${index}`,
    ...option,
  }))
}

/**
 * @param {Array<{id?: string, speed: number, name: string}>} options
 */
function saveQuickPlaybackSpeedBarOptions(options) {
  const normalizedOptions = options
    .map((option) => ({
      id: typeof option.id === 'string' && option.id !== '' ? option.id : createQuickPlaybackSpeedOptionId(),
      speed: normalizeQuickPlaybackSpeed(option.speed),
      name: option.name.trim(),
    }))
    .filter((option) => option.speed > 0)
    .slice(0, QUICK_PLAYBACK_SPEED_LIMIT)

  return store.dispatch(
    'updateQuickPlaybackSpeedBarOptions',
    JSON.stringify(normalizedOptions.length > 0 ? normalizedOptions : [{ id: createQuickPlaybackSpeedOptionId(), speed: 1, name: '' }])
  )
}

/**
 * @returns {string}
 */
function createQuickPlaybackSpeedOptionId() {
  return `speed-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * @param {number|string} speed
 * @returns {number}
 */
function normalizeQuickPlaybackSpeed(speed) {
  const parsedSpeed = Number.parseFloat(speed)

  if (!Number.isFinite(parsedSpeed) || parsedSpeed <= 0) {
    return 1
  }

  return Number.parseFloat(parsedSpeed.toFixed(2)) || 1
}

/**
 * @param {{speed: number, name: string}} option
 * @returns {string}
 */
function getQuickPlaybackSpeedDisplayName(option) {
  return option.name.trim() || getAutomaticQuickPlaybackSpeedName(option.speed)
}

/**
 * @param {number} speed
 * @returns {string}
 */
function getAutomaticQuickPlaybackSpeedName(speed) {
  if (Math.abs(speed - 1) < 0.01) {
    return t('Video.Player.Normal')
  }

  if (speed < 1) {
    return `${Math.round(speed * 100)}%`
  }

  return `${speed}x`
}

function addQuickPlaybackSpeed() {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length >= QUICK_PLAYBACK_SPEED_LIMIT) {
    return
  }

  const lastSpeed = options.length > 0 ? options[options.length - 1].speed : 1
  options.push({
    id: createQuickPlaybackSpeedOptionId(),
    speed: normalizeQuickPlaybackSpeed(lastSpeed + videoPlaybackRateInterval.value),
    name: '',
  })
  saveQuickPlaybackSpeedBarOptions(options)
}

function resetQuickPlaybackSpeedBarOptions() {
  saveQuickPlaybackSpeedBarOptions(DEFAULT_QUICK_PLAYBACK_SPEED_BAR_OPTIONS)
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} name
 */
function updateQuickPlaybackSpeedName(id, name) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.name = name
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function resetQuickPlaybackSpeedName(id) {
  updateQuickPlaybackSpeedName(id, '')
  editingQuickPlaybackSpeedNameId.value = null
}

/**
 * @param {string} id
 * @param {string} speed
 */
function updateQuickPlaybackSpeed(id, speed) {
  const options = getEditableQuickPlaybackSpeedBarOptions()
  const option = options.find((option) => option.id === id)

  if (!option) {
    return
  }

  option.speed = normalizeQuickPlaybackSpeed(speed)
  saveQuickPlaybackSpeedBarOptions(options)
}

/**
 * @param {string} id
 */
function deleteQuickPlaybackSpeed(id) {
  const options = getEditableQuickPlaybackSpeedBarOptions()

  if (options.length <= 1) {
    return
  }

  const index = options.findIndex((option) => option.id === id)

  if (index === -1) {
    return
  }

  options.splice(index, 1)
  saveQuickPlaybackSpeedBarOptions(options)

  if (editingQuickPlaybackSpeedNameId.value === id) {
    editingQuickPlaybackSpeedNameId.value = null
  }
}

/**
 * @param {string} id
 * @returns {Record<string, string>|undefined}
 */
function getQuickPlaybackSpeedEntryStyle(id) {
  const offset = quickPlaybackSpeedDragOffsets.value[id] || 0
  return offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined
}

/**
 * @returns {Array<{id: string, speed: number, name: string}>}
 */
function getEditableQuickPlaybackSpeedBarOptions() {
  return quickPlaybackSpeedBarEntries.value.map((option) => ({
    id: option.id,
    speed: option.speed,
    name: option.name,
  }))
}

/**
 * @param {number} index
 * @param {PointerEvent} event
 */
function startQuickPlaybackSpeedDrag(index, event) {
  const rows = Array.from(document.querySelectorAll('[data-quick-playback-speed-id]'))
    .filter((element) => element instanceof HTMLElement)
  const sourceElement = rows[index]

  if (!(sourceElement instanceof HTMLElement)) {
    return
  }

  finishQuickPlaybackSpeedDragSettle(true)

  const rects = rows.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      id: element.dataset.quickPlaybackSpeedId ?? '',
      top: rect.top,
      height: rect.height,
    }
  })
  let gap = 0

  if (rects.length > 1) {
    gap = rects[1].top - (rects[0].top + rects[0].height)
  }

  quickPlaybackSpeedDragSession = {
    id: sourceElement.dataset.quickPlaybackSpeedId ?? '',
    sourceIndex: index,
    targetIndex: index,
    pointerStartY: event.clientY,
    rects,
    gap,
    started: false,
    moved: false,
    draggedOffset: 0,
  }

  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.addEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.addEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {PointerEvent} event
 */
function handleQuickPlaybackSpeedDragMove(event) {
  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const dy = event.clientY - quickPlaybackSpeedDragSession.pointerStartY

  if (!quickPlaybackSpeedDragSession.started) {
    if (Math.abs(dy) < QUICK_PLAYBACK_SPEED_DRAG_THRESHOLD_PX) {
      return
    }

    quickPlaybackSpeedDragSession.started = true
    draggedQuickPlaybackSpeedId.value = quickPlaybackSpeedDragSession.id
  }

  quickPlaybackSpeedDragSession.moved = true
  event.preventDefault()

  const { rects, sourceIndex, gap } = quickPlaybackSpeedDragSession
  const sourceRect = rects[sourceIndex]
  const lastRect = rects[rects.length - 1]
  const newTop = Math.max(
    rects[0].top - sourceRect.height / 2,
    Math.min(lastRect.top + lastRect.height - sourceRect.height / 2, sourceRect.top + dy)
  )
  const draggedOffset = newTop - sourceRect.top
  const draggedCenter = newTop + sourceRect.height / 2
  let targetIndex = sourceIndex

  for (let i = 0; i < rects.length; i++) {
    if (i === sourceIndex) {
      continue
    }

    const center = rects[i].top + rects[i].height / 2
    if (i < sourceIndex && draggedCenter < center) {
      targetIndex = Math.min(targetIndex, i)
    } else if (i > sourceIndex && draggedCenter > center) {
      targetIndex = Math.max(targetIndex, i)
    }
  }

  quickPlaybackSpeedDragSession.targetIndex = targetIndex
  quickPlaybackSpeedDragSession.draggedOffset = draggedOffset
  quickPlaybackSpeedDragOffsets.value = computeQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  const offsets = {}

  if (sourceIndex === targetIndex) {
    offsets[rects[sourceIndex].id] = draggedOffset
    return offsets
  }

  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    const rect = rects[index]
    if (index === sourceIndex) {
      offsets[rect.id] = draggedOffset
    } else {
      const delta = cursor - rect.top
      if (delta !== 0) {
        offsets[rect.id] = delta
      }
    }
    cursor += rect.height + gap
  }

  return offsets
}

/**
 * @param {Array<{id: string, top: number, height: number}>} rects
 * @param {number} sourceIndex
 * @param {number} targetIndex
 * @param {number} gap
 * @param {number} draggedOffset
 * @returns {Record<string, number>}
 */
function computeFinalQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset) {
  if (sourceIndex === targetIndex) {
    return {}
  }

  const offsets = computeQuickPlaybackSpeedDragOffsets(rects, sourceIndex, targetIndex, gap, draggedOffset)
  const order = rects.map((_, index) => index)
  const [source] = order.splice(sourceIndex, 1)
  order.splice(targetIndex, 0, source)

  let cursor = rects[0].top
  for (const index of order) {
    if (index === sourceIndex) {
      offsets[rects[index].id] = cursor - rects[index].top
      break
    }
    cursor += rects[index].height + gap
  }

  return offsets
}

function stopQuickPlaybackSpeedDrag() {
  cleanupQuickPlaybackSpeedDragListeners()

  if (!quickPlaybackSpeedDragSession) {
    return
  }

  const { id, sourceIndex, targetIndex, started, rects, gap, draggedOffset } = quickPlaybackSpeedDragSession

  if (!started) {
    quickPlaybackSpeedDragSession = null
    return
  }

  quickPlaybackSpeedDragOffsets.value = computeFinalQuickPlaybackSpeedDragOffsets(
    rects,
    sourceIndex,
    targetIndex,
    gap,
    draggedOffset
  )
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = true

  quickPlaybackSpeedSettleTimeoutId = window.setTimeout(() => {
    quickPlaybackSpeedSettleTimeoutId = null
    commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex)
  }, QUICK_PLAYBACK_SPEED_SETTLE_DURATION_MS)

  quickPlaybackSpeedDragSession = null
}

function cleanupQuickPlaybackSpeedDragListeners() {
  window.removeEventListener('pointermove', handleQuickPlaybackSpeedDragMove)
  window.removeEventListener('pointerup', stopQuickPlaybackSpeedDrag)
  window.removeEventListener('pointercancel', stopQuickPlaybackSpeedDrag)
}

/**
 * @param {string} id
 * @param {number} sourceIndex
 * @param {number} targetIndex
 */
async function commitQuickPlaybackSpeedReorder(id, sourceIndex, targetIndex) {
  if (sourceIndex !== targetIndex) {
    const options = getEditableQuickPlaybackSpeedBarOptions()
    const currentIndex = options.findIndex((option) => option.id === id)

    if (currentIndex !== -1) {
      const [option] = options.splice(currentIndex, 1)
      options.splice(targetIndex, 0, option)
      suppressQuickPlaybackSpeedDragTransitions.value = true
      await saveQuickPlaybackSpeedBarOptions(options)
    }
  }

  quickPlaybackSpeedDragOffsets.value = {}
  isQuickPlaybackSpeedDragSettling.value = false

  nextTick(() => {
    requestAnimationFrame(() => {
      suppressQuickPlaybackSpeedDragTransitions.value = false
    })
  })
}

/**
 * @param {boolean} [immediate=false]
 */
function finishQuickPlaybackSpeedDragSettle(immediate = false) {
  if (quickPlaybackSpeedSettleTimeoutId !== null) {
    window.clearTimeout(quickPlaybackSpeedSettleTimeoutId)
    quickPlaybackSpeedSettleTimeoutId = null
  }

  if (immediate) {
    suppressQuickPlaybackSpeedDragTransitions.value = true
  }

  quickPlaybackSpeedDragOffsets.value = {}
  draggedQuickPlaybackSpeedId.value = null
  isQuickPlaybackSpeedDragSettling.value = false
  quickPlaybackSpeedDragSession = null

  if (immediate) {
    nextTick(() => {
      requestAnimationFrame(() => {
        suppressQuickPlaybackSpeedDragTransitions.value = false
      })
    })
  }
}

onBeforeUnmount(() => {
  cleanupQuickPlaybackSpeedDragListeners()
  finishQuickPlaybackSpeedDragSettle(true)
})

/** @type {import('vue').ComputedRef<boolean>} */
const enableScreenshot = computed(() => store.getters.getEnableScreenshot)

/**
 * @param {boolean} value
 */
function updateEnableScreenshot(value) {
  store.dispatch('updateEnableScreenshot', value)
}

const SCREENSHOT_FORMAT_NAMES = ['PNG', 'JPEG', 'WebP', 'JPEG XL']
const SCREENSHOT_FORMAT_VALUES = ['png', 'jpeg', 'webp', 'jxl']
const SCREENSHOT_FORMAT_GROUPS = ['legacy', 'legacy', 'modern', 'modern']

/** @type {import('vue').ComputedRef<'png' | 'jpeg' | 'webp' | 'jxl'>} */
const screenshotFormat = computed(() => store.getters.getScreenshotFormat)

/**
 * @param {'png' | 'jpeg' | 'webp' | 'jxl'} format
 */
async function handleUpdateScreenshotFormat(format) {
  await store.dispatch('updateScreenshotFormat', format)
  getScreenshotFilenameExample(screenshotFilenamePattern.value)
}

const screenshotModeNames = computed(() => [
  t('Settings.Player Settings.Screenshot.Modes.Ask Path'),
  ...(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) ? [t('Settings.Player Settings.Screenshot.Modes.Save To Folder')] : [],
  t('Settings.Player Settings.Screenshot.Modes.Clipboard'),
])
const screenshotModeValues = computed(() => [
  'prompt_folder',
  ...(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) ? ['default_folder'] : [],
  'clipboard'
])

/** @type {import('vue').ComputedRef<'prompt_folder' | 'default_folder' | 'clipboard'>} */
const screenshotMode = computed(() => store.getters.getScreenshotMode)

/**
 * @param {'prompt_folder' | 'default_folder' | 'clipboard'} mode
 */
async function handleUpdateScreenshotMode(mode) {
  await store.dispatch('updateScreenshotMode', mode)
}

/** @type {import('vue').ComputedRef<number>} */
const screenshotQuality = computed(() => store.getters.getScreenshotQuality)

/**
 * @param {number} value
 */
function updateScreenshotQuality(value) {
  store.dispatch('updateScreenshotQuality', value)
}

/** @type {import('vue').ComputedRef<string>} */
const screenshotFolder = computed(() => store.getters.getScreenshotFolderPath)

async function chooseScreenshotFolder() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.chooseDefaultFolder()
  } else if (process.env.IS_CAPACITOR) {
    try {
      const path = await chooseAndroidDirectory()
      if (path) await store.dispatch('updateScreenshotFolderPath', path)
    } catch (error) {
      showToast({ message: t('Screenshot Error', { error }), icon: ['fas', 'circle-exclamation'] })
    }
  }
}

/** @type {import('vue').ComputedRef<string>} */
const screenshotFilenamePattern = computed(() => store.getters.getScreenshotFilenamePattern)
const enableTimestampNotes = computed(() => store.getters.getEnableTimestampNotes)
const obsidianVault = computed(() => store.getters.getObsidianVault)

const SCREENSHOT_DEFAULT_PATTERN = '%Y%M%D-%H%N%S'

/**
 * @param {string} input
 */
async function handleScreenshotFilenamePatternChanged(input) {
  const pattern = input.trim()

  if (!await getScreenshotFilenameExample(pattern)) {
    return
  }

  store.dispatch('updateScreenshotFilenamePattern', pattern || SCREENSHOT_DEFAULT_PATTERN)
}

const screenshotFilenameExample = ref('')

// Also covers store-side changes, such as a reset or a synced pattern.
watch(screenshotFilenamePattern, (pattern) => {
  getScreenshotFilenameExample(pattern)
}, { immediate: true })

/**
 * @param {string} pattern
 */
async function getScreenshotFilenameExample(pattern) {
  try {
    const filename = await store.dispatch('parseScreenshotCustomFileName', {
      pattern: pattern || SCREENSHOT_DEFAULT_PATTERN,
      date: new Date(),
      playerTime: 123.456,
      videoId: 'dQw4w9WgXcQ'
    })

    screenshotFilenameExample.value = `${filename}.${screenshotFormat.value}`
    return true
  } catch (err) {
    screenshotFilenameExample.value = `❗ ${err.message}`
    return false
  }
}
</script>

<style scoped src="./PlayerSettings.css" />
