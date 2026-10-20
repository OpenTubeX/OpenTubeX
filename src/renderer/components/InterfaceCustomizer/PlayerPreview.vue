<template>
  <div
    class="playerPreview"
    :class="{
      fullscreen,
      paused,
      hideControls: paused && !showPlayerControlsWhenPaused,
      hideTitle: paused && !showVideoTitleWhenPaused,
      hideActions: paused && !showFullscreenActionsWhenPaused,
    }"
  >
    <div class="previewPlayer">
      <div
        class="previewVideo"
        aria-hidden="true"
      >
        <span class="previewVideoSun" />
        <span class="previewVideoHill" />
        <span class="previewVideoHill back" />
      </div>
      <div
        v-if="fullscreen"
        class="previewTitle"
      >
        {{ t('Settings.Interface Customizer.Example Video Title') }}
      </div>
      <span
        v-if="paused && displayVideoPlayButton"
        class="previewBigPlay"
      >
        <PreviewIcon :path="SHAKA_PREVIEW_ICONS.PLAY" />
      </span>
      <div
        v-if="state === 'menu'"
        class="previewOverflowMenu"
      >
        <span
          v-for="item in overflowItems"
          :key="item.id"
          class="previewOverflowItem"
          :data-preview-overflow-item="item.id"
        >
          <PreviewIcon
            v-if="item.path"
            :path="item.path"
            :view-box="item.viewBox"
          />
          <FtIcon
            v-else
            class="previewOverflowFtIcon"
            :icon="item.icon"
            aria-hidden="true"
          />
          <span class="previewOverflowLabel">{{ item.label }}</span>
          <span class="previewOverflowValue">{{ item.value }}</span>
        </span>
      </div>
      <div
        v-if="fullscreen && fullscreenActions.length > 0"
        class="previewFullscreenActions"
      >
        <span
          v-for="action in fullscreenActions"
          :key="action.id"
          class="previewFullscreenAction"
          :title="action.label"
          :data-preview-fullscreen-action="action.id"
        >
          <FtIcon
            :icon="action.icon"
            aria-hidden="true"
          />
        </span>
      </div>
      <div class="previewControls">
        <div class="previewSeekBar">
          <span class="previewSeekBarPlayed" />
          <span class="previewSeekBarThumb" />
        </div>
        <div class="previewButtonPanel">
          <span class="previewPill previewIconPill">
            <PreviewIcon :path="paused ? SHAKA_PREVIEW_ICONS.PLAY : SHAKA_PREVIEW_ICONS.PAUSE" />
          </span>
          <span class="previewPill previewIconPill">
            <PreviewIcon :path="SHAKA_PREVIEW_ICONS.MUTE" />
          </span>
          <span class="previewPill previewTextPill">{{ PREVIEW_TIME }}</span>
          <span class="previewSpacer" />
          <span
            v-if="quickPlaybackRates.length > 0"
            class="previewPill previewRateBar"
            data-preview-control="quickPlaybackSpeedBar"
          >
            <span
              v-for="(rate, index) in quickPlaybackRates"
              :key="index"
              class="previewRate"
              :class="{ active: rate.speed === 1 }"
            >{{ rate.label }}</span>
          </span>
          <span class="previewPill previewRightGroup">
            <span
              v-if="enableScreenshot"
              class="previewIconButton"
              data-preview-control="screenshot"
            >
              <PreviewIcon :path="PlayerIcons.PHOTO_CAMERA_FILLED" />
            </span>
            <span class="previewAutoplayToggle">
              <span class="previewAutoplayKnob">
                <PreviewIcon :path="SHAKA_PREVIEW_ICONS.PAUSE" />
              </span>
            </span>
            <span class="previewIconButton">
              <PreviewIcon :path="SHAKA_PREVIEW_ICONS.CLOSED_CAPTIONS" />
            </span>
            <span
              class="previewIconButton"
              :class="{ open: state === 'menu' }"
            >
              <PreviewIcon :path="SHAKA_PREVIEW_ICONS.OPEN_OVERFLOW" />
            </span>
            <span class="previewIconButton">
              <PreviewIcon :path="PlayerIcons.RECTANGLE_DEFAULT" />
            </span>
            <span
              v-if="!fullscreen && !IS_CAPACITOR"
              class="previewIconButton"
            >
              <PreviewIcon :path="PlayerIcons.OPEN_IN_FULL_FILLED" />
            </span>
            <span class="previewIconButton">
              <PreviewIcon :path="fullscreen ? SHAKA_PREVIEW_ICONS.EXIT_FULLSCREEN : SHAKA_PREVIEW_ICONS.FULLSCREEN" />
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { PlayerIcons, ZOOM_IN_ICON_VIEWBOX } from '../../../constants'
import { FULLSCREEN_ACTION_DEFINITIONS } from '../../helpers/fullscreenActions'
import { getQuickPlaybackRateLabel } from '../../helpers/player/quickPlaybackRateLabel'
import { AB_REPEAT_PREVIEW_ICON, SHAKA_PREVIEW_ICONS } from './playerPreviewIcons'

const props = defineProps({
  state: {
    type: String,
    default: 'window',
    validator: value => ['window', 'menu', 'fullscreen', 'paused'].includes(value)
  }
})

const { t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const PREVIEW_TIME = '0:42 / 3:14'

function PreviewIcon({ path, viewBox = '0 -960 960 960' }) {
  return h('svg', { class: 'previewIcon', viewBox, 'aria-hidden': 'true' }, [h('path', { d: path })])
}
PreviewIcon.props = ['path', 'viewBox']

const fullscreen = computed(() => props.state === 'fullscreen' || props.state === 'paused')
const paused = computed(() => props.state === 'paused')

const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)
const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)
const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)
const displayVideoPlayButton = computed(() => !IS_CAPACITOR && store.getters.getDisplayVideoPlayButton)
const enableScreenshot = computed(() => store.getters.getEnableScreenshot)

// Parse and label the options like the player's quick playback speed bar.
const quickPlaybackRates = computed(() => {
  if (!store.getters.getUseQuickPlaybackSpeedBar) return []
  let options = []
  try {
    const parsed = JSON.parse(store.getters.getQuickPlaybackSpeedBarOptions || '[]')
    options = Array.isArray(parsed)
      ? parsed
          .map(option => ({
            speed: Number.parseFloat(option?.speed),
            name: typeof option?.name === 'string' ? option.name : '',
          }))
          .filter(option => Number.isFinite(option.speed) && option.speed > 0)
      : []
  } catch {}
  if (options.length === 0) options = [{ speed: 1, name: '' }]
  return options.map(option => ({ ...option, label: getQuickPlaybackRateLabel(option.speed, option.name, t) }))
})

const fullscreenActions = computed(() => {
  const definitions = new Map(FULLSCREEN_ACTION_DEFINITIONS.map(action => [action.id, action]))
  return store.getters.getFullscreenActions.map(id => ({
    ...definitions.get(id),
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(definitions.get(id).labelKey),
  }))
})

// Mirrors the desktop overflow menu of a regular video with the current settings.
const overflowItems = computed(() => {
  const off = t('Settings.Interface Customizer.Off')
  return [
    { id: 'playbackRate', path: SHAKA_PREVIEW_ICONS.PLAYBACK_RATE, label: t('Settings.Player Settings.Playback Speed'), value: '1x' },
    { id: 'quality', path: SHAKA_PREVIEW_ICONS.RESOLUTION, label: t('Settings.Interface Customizer.Resolution'), value: '1080p' },
    { id: 'sleepTimer', path: PlayerIcons.TIMER_FILLED, label: t('Video.Player.Sleep Timer.Sleep Timer'), value: off },
    store.getters.getShowSkipSilenceButton && !process.env.IS_IOS && { id: 'skipSilence', path: PlayerIcons.SKIP_NEXT_FILLED, label: t('Settings.Player Settings.Skip Silence'), value: off },
    store.getters.getShowMusicModeToggle && { id: 'musicMode', icon: ['fas', 'headphones'], label: t('Video.Player.Music Mode'), value: off },
    { id: 'ambientMode', path: PlayerIcons.LIGHT_MODE_FILLED, label: t('Global.Ambient Mode'), value: off },
    store.getters.getShowLightsOffToggle && { id: 'lightsOff', icon: ['fas', 'moon'], label: t('Settings.Player Settings.Lights Off'), value: off },
    store.getters.getEnableVideoZoom && { id: 'zoom', path: PlayerIcons.ZOOM_IN_ROUNDED, viewBox: ZOOM_IN_ICON_VIEWBOX, label: t('Video.Player.Zoom.Zoom'), value: off },
    !process.env.IS_IOS && { id: 'volumeBoost', icon: ['fas', 'volume-high'], label: t('Video.Player.Volume Boost.Volume Boost'), value: off },
    { id: 'loop', path: SHAKA_PREVIEW_ICONS.LOOP, label: t('Settings.Interface Customizer.Loop'), value: off },
    !store.getters.getDisableAbRepeat && { id: 'abRepeat', path: AB_REPEAT_PREVIEW_ICON.path, viewBox: AB_REPEAT_PREVIEW_ICON.viewBox, label: t('Video.Player.A-B Repeat.Set Repeat Start'), value: off },
  ].filter(Boolean)
})
</script>

<style scoped src="./PlayerPreview.css" />
