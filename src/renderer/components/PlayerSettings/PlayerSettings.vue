<template>
  <FtSettingsSection
    v-bind="$attrs"
    :title="t('Settings.Player Settings.Player Settings')"
  >
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Playback') }}
    </h4>
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
        :compact="true"
        :default-value="enableSubtitlesByDefault"
        setting-key="enableSubtitlesByDefault"
        @change="updateEnableSubtitlesByDefault"
      />
      <FtToggleSwitch
        v-if="!IS_CAPACITOR"
        :label="t('Settings.Player Settings.Remember Volume')"
        :compact="true"
        :default-value="rememberVolume"
        setting-key="rememberVolume"
        @change="updateRememberVolume"
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
        :label="t('Settings.Player Settings.Music Visualizer')"
        :compact="true"
        :default-value="musicVisualizer"
        setting-key="musicVisualizer"
        @change="updateMusicVisualizer"
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
        v-if="IS_CAPACITOR"
        :label="t('Settings.Player Settings.Continue Playback When Screen Is Locked')"
        :compact="true"
        :default-value="continuePlaybackWhenScreenIsLocked"
        setting-key="continuePlaybackWhenScreenIsLocked"
        :tooltip="t('Tooltips.Player Settings.Continue Playback When Screen Is Locked')"
        @change="updateContinuePlaybackWhenScreenIsLocked"
      />
    </div>
    <FtFlexBox class="playerSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.Player Settings.Default Video Format.Default Video Format')"
        :value="defaultVideoFormat"
        setting-key="defaultVideoFormat"
        :select-names="formatNames"
        :select-values="FORMAT_VALUES"
        :tooltip="t('Tooltips.Player Settings.Default Video Format')"
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
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Autoplay') }}
    </h4>
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Autoplay Videos')"
        :compact="true"
        :default-value="autoplayVideos"
        setting-key="autoplayVideos"
        @change="updateAutoplayVideos"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Play Next Video')"
        :compact="true"
        :disabled="hideRecommendedVideos"
        :default-value="playNextVideo"
        setting-key="playNextVideo"
        @change="updatePlayNextVideo"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Autoplay Playlists')"
        :compact="true"
        :default-value="autoplayPlaylists"
        setting-key="autoplayPlaylists"
        @change="updateAutoplayPlaylists"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Skip Unavailable Playlist Videos')"
        :compact="true"
        :default-value="skipUnavailablePlaylistVideos"
        setting-key="skipUnavailablePlaylistVideos"
        @change="updateSkipUnavailablePlaylistVideos"
      />
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
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Hold to Double Playback Speed')"
        :compact="true"
        :default-value="holdToDoublePlaybackSpeed"
        setting-key="holdToDoublePlaybackSpeed"
        :tooltip="t('Tooltips.Player Settings.Hold to Double Playback Speed')"
        @change="updateHoldToDoublePlaybackSpeed"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Show Playback Rate Adjusted Timestamp')"
        :compact="true"
        :default-value="showPlaybackRateAdjustedTimestamp"
        setting-key="showPlaybackRateAdjustedTimestamp"
        :tooltip="t('Tooltips.Player Settings.Show Playback Rate Adjusted Timestamp')"
        @change="updateShowPlaybackRateAdjustedTimestamp"
      />
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
          :icon="['fas', 'sliders-h']"
          :disabled="!useQuickPlaybackSpeedBar"
          @click="showQuickPlaybackSpeedBarManager = true"
        />
        <FtSyncedSettingIndicator setting-key="quickPlaybackSpeedBarOptions" />
      </div>
    </FtFlexBox>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Player Controls') }}
    </h4>
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        v-if="!IS_IOS"
        :label="t('Settings.Player Settings.Show Volume Boost Toggle')"
        :compact="true"
        :default-value="store.getters.getShowVolumeBoostToggle"
        setting-key="showVolumeBoostToggle"
        @change="store.dispatch('updateShowVolumeBoostToggle', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Show Music Mode Toggle')"
        :compact="true"
        :default-value="store.getters.getShowMusicModeToggle"
        setting-key="showMusicModeToggle"
        :tooltip="t('Video.Player.Music Mode Description')"
        @change="store.dispatch('updateShowMusicModeToggle', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Show Lights Off Toggle')"
        :compact="true"
        :default-value="showLightsOffToggle"
        setting-key="showLightsOffToggle"
        @change="store.dispatch('updateShowLightsOffToggle', $event)"
      />
      <FtToggleSwitch
        v-if="!IS_CAPACITOR"
        :label="t('Settings.Player Settings.Display Play Button In Video Player')"
        :compact="true"
        :default-value="displayVideoPlayButton"
        setting-key="displayVideoPlayButton"
        @change="updateDisplayVideoPlayButton"
      />
      <FtToggleSwitch
        v-if="!IS_IOS"
        :label="t('Settings.Player Settings.Show Skip Silence Toggle')"
        :compact="true"
        :default-value="showSkipSilenceButton"
        setting-key="showSkipSilenceButton"
        :tooltip="t('Tooltips.Player Settings.Show Skip Silence Toggle')"
        @change="updateShowSkipSilenceButton"
      />
      <FtToggleSwitch
        v-if="!IS_IOS"
        :label="t('Settings.Player Settings.Enable Skip Silence by Default')"
        :compact="true"
        :disabled="!showSkipSilenceButton"
        :default-value="enableSkipSilenceByDefault"
        setting-key="enableSkipSilenceByDefault"
        :tooltip="t('Tooltips.Player Settings.Enable Skip Silence by Default')"
        @change="updateEnableSkipSilenceByDefault"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON || IS_CAPACITOR"
        :label="t('Settings.Player Settings.Enable DLNA Casting')"
        :compact="true"
        :default-value="showDlnaCastButton"
        setting-key="showDlnaCastButton"
        @change="store.dispatch('updateShowDlnaCastButton', $event)"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON || (IS_CAPACITOR && !IS_IOS)"
        :label="t('Settings.Player Settings.Enable Google Cast')"
        :compact="true"
        :default-value="store.getters.getShowChromecastButton"
        setting-key="showChromecastButton"
        @change="store.dispatch('updateShowChromecastButton', $event)"
      />
    </div>
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Gestures') }}
    </h4>
    <div class="playerSwitchGrid switchFlowGrid">
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
        :label="t('Settings.Player Settings.Skip by Scrolling Over Video Player')"
        :compact="true"
        :disabled="videoVolumeMouseScroll"
        :default-value="videoSkipMouseScroll"
        setting-key="videoSkipMouseScroll"
        :tooltip="t('Tooltips.Player Settings.Skip by Scrolling Over Video Player')"
        @change="updateVideoSkipMouseScroll"
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
        :label="t('Settings.Player Settings.Enable Video Zoom')"
        :compact="true"
        :default-value="enableVideoZoom"
        setting-key="enableVideoZoom"
        :tooltip="t('Tooltips.Player Settings.Enable Video Zoom')"
        @change="updateEnableVideoZoom"
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
        :label="t('Settings.Player Settings.Show Swipe to Seek Preview')"
        :compact="true"
        :default-value="store.getters.getShowMobileSeekPreview"
        :disabled="!store.getters.getEnableMobileFullscreenSeek"
        setting-key="showMobileSeekPreview"
        @change="store.dispatch('updateShowMobileSeekPreview', $event)"
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
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Enter Fullscreen on Display Rotate')"
        :compact="true"
        :default-value="enterFullscreenOnDisplayRotate"
        setting-key="enterFullscreenOnDisplayRotate"
        @change="updateEnterFullscreenOnDisplayRotate"
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
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Scroll Mini Player.When Scrolling Down')"
        :compact="true"
        :default-value="scrollMiniPlayerEnabled"
        setting-key="scrollMiniPlayerEnabled"
        @change="updateScrollMiniPlayerEnabled"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON || IS_CAPACITOR"
        :label="t('Settings.Player Settings.Scroll Mini Player.On All Tabs')"
        :compact="true"
        :default-value="scrollMiniPlayerOnAllTabs"
        :disabled="autoPictureInPictureTriggers.includes('tab') || store.getters.getKeepPlayingOnNavigation"
        setting-key="scrollMiniPlayerOnAllTabs"
        @change="updateScrollMiniPlayerOnAllTabs"
      />
      <FtToggleSwitch
        v-if="USING_ELECTRON || IS_CAPACITOR"
        :label="t('Settings.Player Settings.Scroll Mini Player.On Navigation')"
        :compact="true"
        :default-value="store.getters.getKeepPlayingOnNavigation"
        setting-key="keepPlayingOnNavigation"
        @change="store.dispatch('updateKeepPlayingOnNavigation', $event)"
      />
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
        :disabled-values="supportsAutoPictureInPictureMinimize ? [] : ['minimize']"
        setting-key="autoPictureInPictureTriggers"
        :tooltips="supportsAutoPictureInPictureMinimize ? {} : { minimize: t('Settings.Player Settings.Auto Picture in Picture.Wayland Minimize Unsupported') }"
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
    <h4 class="groupTitle">
      {{ t('Settings.Player Settings.Sections.Shorts') }}
    </h4>
    <div class="playerSwitchGrid switchFlowGrid">
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Use YouTube-style Shorts')"
        :compact="true"
        :default-value="useCustomShortsPlayer"
        setting-key="useCustomShortsPlayer"
        :tooltip="t('Tooltips.Player Settings.Use YouTube-style Shorts')"
        @change="updateUseCustomShortsPlayer"
      />
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
    <QuickPlaybackSpeedBarManager
      :open="showQuickPlaybackSpeedBarManager"
      @close="showQuickPlaybackSpeedBarManager = false"
    />
  </FtSettingsSection>
</template>

<script setup>
import { displayAndroidPath, chooseAndroidDirectory } from '../../helpers/androidStorage'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtCheckboxList from '../FtCheckboxList/FtCheckboxList.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtSliderGrid from '../FtSliderGrid/FtSliderGrid.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'
import FtInput from '../FtInput/FtInput.vue'
import QuickPlaybackSpeedBarManager from './QuickPlaybackSpeedBarManager.vue'

import store from '../../store/index'
import { showToast } from '../../helpers/utils'
import { initializePlatformInfo, supportsAutoPictureInPictureMinimize } from '../../helpers/platform'
import { AUTO_QUALITY_FALLBACK, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()

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
const showDlnaCastButton = computed(() => store.getters.getShowDlnaCastButton)

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

/** @type {import('vue').ComputedRef<boolean>} */
const holdToDoublePlaybackSpeed = computed(() => store.getters.getHoldToDoublePlaybackSpeed)

/**
 * @param {boolean} value
 */
function updateHoldToDoublePlaybackSpeed(value) {
  store.dispatch('updateHoldToDoublePlaybackSpeed', value)
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

const defaultViewingMode = computed(() => {
  /** @type {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} */
  const defaultViewingMode = store.getters.getDefaultViewingMode

  if ((process.env.IS_CAPACITOR && ['fullwindow', 'fullwindow_always_on'].includes(defaultViewingMode)) ||
    (defaultViewingMode === 'external_player' && (!process.env.IS_ELECTRON || externalPlayer.value === '')) ||
    (!process.env.IS_ELECTRON && (defaultViewingMode === 'fullscreen' || defaultViewingMode === 'pip'))) {
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

    ...process.env.IS_ELECTRON
      ? [
          t('Settings.Player Settings.Default Viewing Mode.Full Screen'),
          t('Settings.Player Settings.Default Viewing Mode.Full Screen (Always On)'),
          t('Settings.Player Settings.Default Viewing Mode.Picture in Picture')
        ]
      : []
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

    ...process.env.IS_ELECTRON
      ? [
          'fullscreen',
          'fullscreen_always_on',
          'pip',
        ]
      : []
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

/** @type {import('vue').WritableComputedRef<string[]>} */
const autoPictureInPictureTriggers = computed({
  get: () => store.getters.getAutoPictureInPictureTriggers,
  set: (value) => store.dispatch('updateAutoPictureInPictureTriggers', value)
})

const mobileAutoPictureInPicture = computed(() => store.getters.getMobileAutoPictureInPicture)

function updateMobileAutoPictureInPicture(value) {
  store.dispatch('updateMobileAutoPictureInPicture', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const scrollMiniPlayerEnabled = computed(() => store.getters.getScrollMiniPlayerEnabled)

/** @type {import('vue').ComputedRef<boolean>} */
const scrollMiniPlayerOnAllTabs = computed(() => store.getters.getKeepPlayingOnNavigation || store.getters.getScrollMiniPlayerOnAllTabs)

/**
 * @param {boolean} value
 */
function updateScrollMiniPlayerEnabled(value) {
  store.dispatch('updateScrollMiniPlayerEnabled', value)
}

/**
 * @param {boolean} value
 */
function updateScrollMiniPlayerOnAllTabs(value) {
  store.dispatch('updateScrollMiniPlayerOnAllTabs', value)
}

const FORMAT_VALUES = ['dash', 'legacy', 'audio']

const formatNames = computed(() => [
  t('Settings.Player Settings.Default Video Format.Dash Formats'),
  t('Settings.Player Settings.Default Video Format.Legacy Formats'),
  t('Settings.Player Settings.Default Video Format.Audio Formats')
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
 * Auto quality is broken with SABR, so it is only offered for the
 * stream extraction methods that don't use it.
 * @type {import('vue').ComputedRef<boolean>}
 */
const autoQualityAvailable = computed(() => {
  return playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine)
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

  if (value === 'auto' && !autoQualityAvailable.value) { return AUTO_QUALITY_FALLBACK }

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

/** @type {import('vue').ComputedRef<boolean>} */
const enableScreenshot = computed(() => store.getters.getEnableScreenshot)

/**
 * @param {boolean} value
 */
function updateEnableScreenshot(value) {
  store.dispatch('updateEnableScreenshot', value)
}

const SCREENSHOT_FORMAT_NAMES = ['PNG', 'JPEG', 'WebP']
const SCREENSHOT_FORMAT_VALUES = ['png', 'jpeg', 'webp']

/** @type {import('vue').ComputedRef<'png' | 'jpeg' | 'webp'>} */
const screenshotFormat = computed(() => store.getters.getScreenshotFormat)

/**
 * @param {'png' | 'jpeg' | 'webp'} format
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

onMounted(() => {
  getScreenshotFilenameExample(screenshotFilenamePattern.value)
})

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
