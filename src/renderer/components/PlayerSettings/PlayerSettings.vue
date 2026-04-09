<template>
  <FtSettingsSection
    :title="t('Settings.Player Settings.Player Settings')"
  >
    <div class="switchColumnGrid">
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Proxy Videos Through Invidious')"
          :compact="true"
          :default-value="showProxyVideosAsDisabled ? false : proxyVideos"
          :disabled="showProxyVideosAsDisabled"
          :tooltip="t('Tooltips.Player Settings.Proxy Videos Through Invidious')"
          @change="updateProxyVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Turn on Subtitles by Default')"
          :compact="true"
          :default-value="enableSubtitlesByDefault"
          @change="updateEnableSubtitlesByDefault"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Scroll Volume Over Video Player')"
          :compact="true"
          :disabled="videoSkipMouseScroll"
          :default-value="videoVolumeMouseScroll"
          @change="updateVideoVolumeMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Scroll Playback Rate Over Video Player')"
          :compact="true"
          :default-value="videoPlaybackRateMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Scroll Playback Rate Over Video Player')"
          @change="updateVideoPlaybackRateMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Skip by Scrolling Over Video Player')"
          :compact="true"
          :disabled="videoVolumeMouseScroll"
          :default-value="videoSkipMouseScroll"
          :tooltip="t('Tooltips.Player Settings.Skip by Scrolling Over Video Player')"
          @change="updateVideoSkipMouseScroll"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Multiply Seek Interval by Playback Rate')"
          :compact="true"
          :default-value="seekIntervalMultiplyByPlaybackRate"
          :tooltip="t('Tooltips.Player Settings.Multiply Seek Interval by Playback Rate')"
          @change="updateSeekIntervalMultiplyByPlaybackRate"
        />
      </div>
      <div class="switchColumn">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Play Next Video')"
          :compact="true"
          :disabled="hideRecommendedVideos"
          :default-value="playNextVideo"
          @change="updatePlayNextVideo"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Playlists')"
          :compact="true"
          :default-value="autoplayPlaylists"
          @change="updateAutoplayPlaylists"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Autoplay Videos')"
          :compact="true"
          :default-value="autoplayVideos"
          @change="updateAutoplayVideos"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Display Play Button In Video Player')"
          :compact="true"
          :default-value="displayVideoPlayButton"
          @change="updateDisplayVideoPlayButton"
        />
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Enter Fullscreen on Display Rotate')"
          :compact="true"
          :default-value="enterFullscreenOnDisplayRotate"
          @change="updateEnterFullscreenOnDisplayRotate"
        />
      </div>
    </div>
    <FtFlexBox>
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Viewing Mode.Default Viewing Mode')"
        :value="defaultViewingMode"
        :select-names="viewingModeNames"
        :select-values="viewingModeValues"
        :icon="['fas', 'expand']"
        @change="updateDefaultViewingMode"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Video Format.Default Video Format')"
        :value="defaultVideoFormat"
        :select-names="formatNames"
        :select-values="FORMAT_VALUES"
        :tooltip="t('Tooltips.Player Settings.Default Video Format')"
        :icon="['fas', 'file-video']"
        @change="updateDefaultVideoFormat"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
        :value="defaultQuality"
        :select-names="qualityNames"
        :select-values="QUALITY_VALUES"
        :icon="['fas', 'photo-film']"
        @change="updateDefaultQuality"
      />
      <FtSelect
        :placeholder="t('Settings.Player Settings.Video Playback Rate Interval')"
        :value="videoPlaybackRateIntervalString"
        :select-names="PLAYBACK_RATE_INTERVAL_VALUES"
        :select-values="PLAYBACK_RATE_INTERVAL_VALUES"
        :icon="['fas', 'gauge']"
        @change="updateVideoPlaybackRateInterval"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtSlider
        :label="t('Settings.Player Settings.Next Video Interval')"
        :default-value="defaultInterval"
        :min-value="0"
        :max-value="60"
        :step="1"
        value-extension="s"
        @change="updateDefaultInterval"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Autoplay Interruption Timer')"
        :default-value="defaultAutoplayInterruptionIntervalHours"
        :min-value="1"
        :max-value="12"
        :step="1"
        value-extension="h"
        @change="updateDefaultAutoplayInterruptionIntervalHours"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Fast-Forward / Rewind Interval')"
        :default-value="defaultSkipInterval"
        :min-value="1"
        :max-value="70"
        :step="1"
        value-extension="s"
        @change="updateDefaultSkipInterval"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Default Volume')"
        :default-value="defaultVolume"
        :min-value="0"
        :max-value="100"
        :step="1"
        value-extension="%"
        @change="updateDefaultVolume"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Default Playback Rate')"
        :default-value="defaultPlayback"
        :min-value="videoPlaybackRateInterval"
        :max-value="maxVideoPlaybackRate"
        :step="videoPlaybackRateInterval"
        value-extension="x"
        @change="updateDefaultPlayback"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Max Video Playback Rate')"
        :default-value="maxVideoPlaybackRate"
        :min-value="2"
        :max-value="10"
        :step="1"
        value-extension="x"
        @change="updateMaxVideoPlaybackRate"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Remember Playback Speed Per Channel')"
        :compact="true"
        :default-value="rememberPlaybackSpeedPerChannel"
        @change="updateRememberPlaybackSpeedPerChannel"
      />
      <FtToggleSwitch
        v-if="rememberPlaybackSpeedPerChannel"
        :label="t('Settings.Player Settings.Auto Update Channel Playback Speed')"
        :compact="true"
        :default-value="autoUpdateChannelPlaybackSpeeds"
        @change="updateAutoUpdateChannelPlaybackSpeeds"
      />
    </FtFlexBox>
    <FtFlexBox v-if="rememberPlaybackSpeedPerChannel">
      <FtButton
        :label="t('Settings.Player Settings.Manage Channel Playback Speeds')"
        :icon="['fas', 'sliders-h']"
        @click="showChannelSpeedManager = true"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Remember Video Quality Per Channel')"
        :compact="true"
        :default-value="rememberVideoQualityPerChannel"
        @change="updateRememberVideoQualityPerChannel"
      />
      <FtToggleSwitch
        v-if="rememberVideoQualityPerChannel"
        :label="t('Settings.Player Settings.Auto Update Channel Video Quality')"
        :compact="true"
        :default-value="autoUpdateChannelVideoQualities"
        @change="updateAutoUpdateChannelVideoQualities"
      />
    </FtFlexBox>
    <FtFlexBox v-if="rememberVideoQualityPerChannel">
      <FtButton
        :label="t('Settings.Player Settings.Manage Channel Video Qualities')"
        :icon="['fas', 'sliders-h']"
        @click="showChannelQualityManager = true"
      />
    </FtFlexBox>
    <br>
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Screenshot.Enable')"
        :default-value="enableScreenshot"
        @change="updateEnableScreenshot"
      />
    </FtFlexBox>
    <div v-if="enableScreenshot">
      <FtFlexBox>
        <FtSelect
          :placeholder="t('Settings.Player Settings.Screenshot.Format Label')"
          :value="screenshotFormat"
          :select-names="SCREENSHOT_FORMAT_NAMES"
          :select-values="SCREENSHOT_FORMAT_VALUES"
          :icon="['fas', 'file-image']"
          @change="handleUpdateScreenshotFormat"
        />
        <FtSlider
          :label="t('Settings.Player Settings.Screenshot.Quality Label')"
          :default-value="screenshotQuality"
          :min-value="0"
          :max-value="100"
          :step="1"
          value-extension="%"
          :disabled="screenshotFormat === 'png'"
          @change="updateScreenshotQuality"
        />
      </FtFlexBox>
      <FtFlexBox v-if="USING_ELECTRON">
        <FtToggleSwitch
          :label="t('Settings.Player Settings.Screenshot.Ask Path')"
          :default-value="screenshotAskPath"
          @change="updateScreenshotAskPath"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="USING_ELECTRON && !screenshotAskPath"
        class="screenshotFolderContainer"
      >
        <p class="screenshotFolderLabel">
          {{ t('Settings.Player Settings.Screenshot.Folder Label') }}
        </p>
        <FtInput
          class="screenshotFolderPath"
          :placeholder="screenshotFolder"
          :show-action-button="false"
          :show-label="false"
          :disabled="true"
        />
        <FtButton
          :label="t('Settings.Player Settings.Screenshot.Folder Button')"
          class="screenshotFolderButton"
          @click="chooseScreenshotFolder"
        />
      </FtFlexBox>
      <FtFlexBox
        class="screenshotFolderContainer"
      >
        <p class="screenshotFilenamePatternTitle">
          {{ t('Settings.Player Settings.Screenshot.File Name Label') }}
          <FtTooltip
            class="selectTooltip"
            position="bottom"
            :tooltip="t('Settings.Player Settings.Screenshot.File Name Tooltip')"
          />
        </p>
        <FtInput
          class="screenshotFilenamePatternInput"
          placeholder=""
          :value="screenshotFilenamePattern"
          :show-action-button="false"
          :show-label="false"
          @input="handleScreenshotFilenamePatternChanged"
        />
        <FtInput
          class="screenshotFilenamePatternExample"
          :placeholder="screenshotFilenameExample"
          :show-action-button="false"
          :show-label="false"
          :disabled="true"
        />
      </FtFlexBox>
      <br>
    </div>
    <FtPrompt
      v-if="showChannelSpeedManager"
      :label="t('Settings.Player Settings.Channel Playback Speed Manager')"
      theme="readable-width"
      @click="handleChannelSpeedManagerClick"
    >
      <div
        v-if="channelSpeedEntries.length === 0"
        class="emptyState"
      >
        <p>{{ t("Settings.Player Settings.No Saved Playback Speeds") }}</p>
      </div>
      <div
        v-else
        class="channelSpeedList"
      >
        <div
          v-for="entry in channelSpeedEntries"
          :key="entry.channelId"
          class="channelSpeedEntry"
        >
          <div class="channelSpeedInfo">
            <p class="channelId">
              {{ entry.channelName }}
            </p>
            <FtSlider
              :label="t('Settings.Player Settings.Playback Speed')"
              :default-value="entry.speed"
              :min-value="videoPlaybackRateInterval"
              :max-value="maxVideoPlaybackRate"
              :step="videoPlaybackRateInterval"
              value-extension="x"
              @change="(value) => updateChannelSpeed(entry.channelId, value)"
            />
          </div>
          <FtButton
            :label="t('Delete')"
            :icon="['fas', 'trash']"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            @click="deleteChannelSpeed(entry.channelId)"
          />
        </div>
      </div>
      <FtFlexBox>
        <FtButton
          :label="t('Close')"
          @click="showChannelSpeedManager = false"
        />
      </FtFlexBox>
    </FtPrompt>
    <FtPrompt
      v-if="showChannelQualityManager"
      :label="t('Settings.Player Settings.Channel Video Quality Manager')"
      theme="readable-width"
      @click="handleChannelQualityManagerClick"
    >
      <div
        v-if="channelQualityEntries.length === 0"
        class="emptyState"
      >
        <p>{{ t("Settings.Player Settings.No Saved Video Qualities") }}</p>
      </div>
      <div
        v-else
        class="channelSpeedList"
      >
        <div
          v-for="entry in channelQualityEntries"
          :key="entry.channelId"
          class="channelSpeedEntry"
        >
          <div class="channelSpeedInfo">
            <p class="channelId">
              {{ entry.channelName }}
            </p>
            <FtSelect
              :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
              :value="entry.quality"
              :select-names="qualityNames"
              :select-values="QUALITY_VALUES"
              :icon="['fas', 'photo-film']"
              @change="(value) => updateChannelQuality(entry.channelId, value)"
            />
          </div>
          <FtButton
            :label="t('Delete')"
            :icon="['fas', 'trash']"
            text-color="var(--destructive-text-color)"
            background-color="var(--destructive-color)"
            @click="deleteChannelQuality(entry.channelId)"
          />
        </div>
      </div>
      <FtFlexBox>
        <FtButton
          :label="t('Close')"
          @click="showChannelQualityManager = false"
        />
      </FtFlexBox>
    </FtPrompt>
  </FtSettingsSection>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtSlider from '../FtSlider/FtSlider.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'

import store from '../../store/index'

import {
  findChannelTagInfo,
  checkYoutubeChannelId,
} from '../../helpers/channels'

const { t } = useI18n()

/** @type {boolean} */
const USING_ELECTRON = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<boolean>} */
const proxyVideos = computed(() => store.getters.getProxyVideos)

const showProxyVideosAsDisabled = computed(() => {
  return store.getters.getBackendPreference !== 'invidious' && !store.getters.getBackendFallback
})

/**
 * @param {boolean} value
 */
function updateProxyVideos(value) {
  store.dispatch('updateProxyVideos', value)
}

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

/**
 * @param {boolean} value
 */
function updateAutoplayPlaylists(value) {
  store.dispatch('updateAutoplayPlaylists', value)
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
const displayVideoPlayButton = computed(() => store.getters.getDisplayVideoPlayButton)

/**
 * @param {boolean} value
 */
function updateDisplayVideoPlayButton(value) {
  store.dispatch('updateDisplayVideoPlayButton', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const enterFullscreenOnDisplayRotate = computed(() => store.getters.getEnterFullscreenOnDisplayRotate)

/**
 * @param {boolean} value
 */
function updateEnterFullscreenOnDisplayRotate(value) {
  store.dispatch('updateEnterFullscreenOnDisplayRotate', value)
}

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

const defaultViewingMode = computed(() => {
  /** @type {'default' | 'theatre' | 'fullwindow' | 'fullscreen' | 'pip' | 'external_player'} */
  const defaultViewingMode = store.getters.getDefaultViewingMode

  if ((defaultViewingMode === 'external_player' && (!process.env.IS_ELECTRON || externalPlayer.value === '')) ||
    (!process.env.IS_ELECTRON && (defaultViewingMode === 'fullscreen' || defaultViewingMode === 'pip'))) {
    return 'default'
  }

  return defaultViewingMode
})

const viewingModeNames = computed(() => {
  const viewingModeNames = [
    t('Settings.General Settings.Thumbnail Preference.Default'),
    t('Settings.Player Settings.Default Viewing Mode.Theater'),
    t('Video.Player.Full Window'),

    ...process.env.IS_ELECTRON
      ? [
          t('Settings.Player Settings.Default Viewing Mode.Full Screen'),
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
    'fullwindow',

    ...process.env.IS_ELECTRON
      ? ['fullscreen', 'pip']
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

// TODO: Revert when auto is fixed
// const QUALITY_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144', 'auto']
const QUALITY_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),

  // TODO: Revert when auto is fixed
  // t('Settings.Player Settings.Default Quality.Auto')
])

/** @type {import('vue').ComputedRef<'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'>} */
const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality

  // TODO: Revert when auto is fixed (720 is the default setttings value)
  if (value === 'auto') { return '720' }

  return value
})

/**
 * @param {'2160' | '1440' | '1080' | '720' | '480' | '360' | '240' | '144' | 'auto'} value
 */
function updateDefaultQuality(value) {
  store.dispatch('updateDefaultQuality', value)
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
const rememberPlaybackSpeedPerChannel = computed(() => store.getters.getRememberPlaybackSpeedPerChannel)

/**
 * @param {boolean} value
 */
function updateRememberPlaybackSpeedPerChannel(value) {
  store.dispatch('updateRememberPlaybackSpeedPerChannel', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelPlaybackSpeeds = computed(() => store.getters.getAutoUpdateChannelPlaybackSpeeds)

/**
 * @param {boolean} value
 */
function updateAutoUpdateChannelPlaybackSpeeds(value) {
  store.dispatch('updateAutoUpdateChannelPlaybackSpeeds', value)
}

/** @type {import('vue').Ref<boolean>} */
const showChannelSpeedManager = ref(false)

/** @type {import('vue').ComputedRef<boolean>} */
const rememberVideoQualityPerChannel = computed(() => store.getters.getRememberVideoQualityPerChannel)

/**
 * @param {boolean} value
 */
function updateRememberVideoQualityPerChannel(value) {
  store.dispatch('updateRememberVideoQualityPerChannel', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelVideoQualities = computed(() => store.getters.getAutoUpdateChannelVideoQualities)

/**
 * @param {boolean} value
 */
function updateAutoUpdateChannelVideoQualities(value) {
  store.dispatch('updateAutoUpdateChannelVideoQualities', value)
}

/** @type {import('vue').Ref<boolean>} */
const showChannelQualityManager = ref(false)

/** @type {import('vue').ComputedRef<string>} */
const channelPlaybackSpeeds = computed(
  () => store.getters.getChannelPlaybackSpeeds
)

/** @type {import('vue').ComputedRef<string>} */
const channelVideoQualities = computed(
  () => store.getters.getChannelVideoQualities
)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const backendOptions = computed(() => ({
  preference: backendPreference.value,
  fallback: backendFallback.value,
}))

/** @type {import('vue').Ref<Map<string, string>>} */
const channelNamesCache = ref(new Map())

/**
 * @param {string} value
 * @param {string} errorContext
 * @returns {Record<string, string | number>}
 */
function parseChannelPreferences(value, errorContext) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed != null && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    console.error(`Failed to parse ${errorContext}:`, e)
    return {}
  }
}

/** @type {import('vue').ComputedRef<Array<{channelId: string, speed: number, channelName: string}>>} */
const channelSpeedEntries = computed(() => {
  const speeds = parseChannelPreferences(channelPlaybackSpeeds.value, 'channel playback speeds')
  return Object.entries(speeds).map(([channelId, speed]) => ({
    channelId,
    speed: typeof speed === 'number' ? speed : parseFloat(speed),
    channelName: channelNamesCache.value.get(channelId) || channelId,
  }))
})

/** @type {import('vue').ComputedRef<Array<{channelId: string, quality: string, channelName: string}>>} */
const channelQualityEntries = computed(() => {
  const qualities = parseChannelPreferences(channelVideoQualities.value, 'channel video qualities')
  return Object.entries(qualities).map(([channelId, quality]) => {
    const normalizedQuality = String(quality) === 'auto' ? defaultQuality.value : String(quality)

    return {
      channelId,
      quality: normalizedQuality,
      channelName: channelNamesCache.value.get(channelId) || channelId,
    }
  })
})

/**
 * Fetch channel names for all playback speed entries
 * @returns {Promise<void>}
 */
async function fetchChannelNames() {
  const speeds = parseChannelPreferences(channelPlaybackSpeeds.value, 'channel playback speeds')
  const qualities = parseChannelPreferences(channelVideoQualities.value, 'channel video qualities')
  const channelIds = new Set([
    ...Object.keys(speeds),
    ...Object.keys(qualities),
  ])

  for (const channelId of channelIds) {
    if (channelNamesCache.value.has(channelId)) {
      continue
    }

    if (!checkYoutubeChannelId(channelId)) {
      channelNamesCache.value.set(channelId, channelId)
      continue
    }

    try {
      const { preferredName, invalidId } = await findChannelTagInfo(
        channelId,
        backendOptions.value
      )
      if (invalidId || !preferredName) {
        channelNamesCache.value.set(channelId, channelId)
      } else {
        channelNamesCache.value.set(channelId, preferredName)
      }
    } catch (e) {
      console.error(`Failed to fetch channel name for ${channelId}:`, e)
      channelNamesCache.value.set(channelId, channelId)
    }
  }
}

watch([showChannelSpeedManager, showChannelQualityManager], ([isSpeedManagerOpen, isQualityManagerOpen]) => {
  if (isSpeedManagerOpen || isQualityManagerOpen) {
    fetchChannelNames()
  }
})

watch([channelPlaybackSpeeds, channelVideoQualities], () => {
  if (showChannelSpeedManager.value || showChannelQualityManager.value) {
    fetchChannelNames()
  }
})

/**
 * @param {string | null} value
 */
function handleChannelSpeedManagerClick(value) {
  if (value === null) {
    showChannelSpeedManager.value = false
  }
}

/**
 * @param {string | null} value
 */
function handleChannelQualityManagerClick(value) {
  if (value === null) {
    showChannelQualityManager.value = false
  }
}

/**
 * @param {string} channelId
 * @param {number} newSpeed
 */
function updateChannelSpeed(channelId, newSpeed) {
  try {
    const speeds = JSON.parse(channelPlaybackSpeeds.value || '{}')
    speeds[channelId] = newSpeed
    store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(speeds))
  } catch (e) {
    console.error('Failed to update channel playback speed:', e)
  }
}

/**
 * @param {string} channelId
 */
function deleteChannelSpeed(channelId) {
  try {
    const speeds = parseChannelPreferences(channelPlaybackSpeeds.value, 'channel playback speeds')
    delete speeds[channelId]
    store.dispatch('updateChannelPlaybackSpeeds', JSON.stringify(speeds))
    channelNamesCache.value.delete(channelId)
  } catch (e) {
    console.error('Failed to delete channel playback speed:', e)
  }
}

/**
 * @param {string} channelId
 * @param {string} newQuality
 */
function updateChannelQuality(channelId, newQuality) {
  try {
    const qualities = parseChannelPreferences(channelVideoQualities.value, 'channel video qualities')

    if (newQuality === defaultQuality.value) {
      delete qualities[channelId]
      channelNamesCache.value.delete(channelId)
    } else {
      qualities[channelId] = newQuality
    }

    store.dispatch('updateChannelVideoQualities', JSON.stringify(qualities))
  } catch (e) {
    console.error('Failed to update channel video quality:', e)
  }
}

/**
 * @param {string} channelId
 */
function deleteChannelQuality(channelId) {
  try {
    const qualities = parseChannelPreferences(channelVideoQualities.value, 'channel video qualities')
    delete qualities[channelId]
    store.dispatch('updateChannelVideoQualities', JSON.stringify(qualities))
    channelNamesCache.value.delete(channelId)
  } catch (e) {
    console.error('Failed to delete channel video quality:', e)
  }
}

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

/** @type {import('vue').ComputedRef<number>} */
const screenshotQuality = computed(() => store.getters.getScreenshotQuality)

/**
 * @param {number} value
 */
function updateScreenshotQuality(value) {
  store.dispatch('updateScreenshotQuality', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const screenshotAskPath = computed(() => store.getters.getScreenshotAskPath)

/**
 * @param {boolean} value
 */
function updateScreenshotAskPath(value) {
  store.dispatch('updateScreenshotAskPath', value)
}

/** @type {import('vue').ComputedRef<string>} */
const screenshotFolder = computed(() => store.getters.getScreenshotFolderPath)

function chooseScreenshotFolder() {
  // only use with electron
  if (process.env.IS_ELECTRON) {
    window.ftElectron.chooseDefaultFolder()
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
