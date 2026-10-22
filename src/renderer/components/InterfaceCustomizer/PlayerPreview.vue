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
        <span class="previewOverflowClose">
          <PreviewIcon :path="SHAKA_PREVIEW_ICONS.CLOSE" />
        </span>
        <div
          ref="overflowGrid"
          v-overlay-scrollbars
          class="previewOverflowGrid"
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
            <template
              v-for="button in controlBarButtons"
              :key="button.id"
            >
              <span
                v-if="button.id === 'autoplay'"
                class="previewAutoplayToggle"
                :data-preview-control="button.id"
              >
                <PreviewIcon :path="PlayerIcons.PAUSE_CIRCLE_FILLED" />
              </span>
              <span
                v-else
                class="previewIconButton"
                :class="{ open: button.id === 'menu' && state === 'menu' }"
                :data-preview-control="button.id"
              >
                <PreviewIcon :path="button.path" />
              </span>
            </template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, h, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { PlayerIcons, ZOOM_IN_ICON_VIEWBOX } from '../../../constants'
import { getControlBarButtonDefinitions } from '../../helpers/controlBarButtons'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
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

const CONTROL_BAR_ICONS = {
  autoplay: PlayerIcons.PAUSE_CIRCLE_FILLED,
  captions: SHAKA_PREVIEW_ICONS.CLOSED_CAPTIONS,
  menu: SHAKA_PREVIEW_ICONS.OPEN_OVERFLOW,
  pictureInPicture: SHAKA_PREVIEW_ICONS.PICTURE_IN_PICTURE,
  theatreMode: PlayerIcons.RECTANGLE_DEFAULT,
  fullWindow: PlayerIcons.OPEN_IN_FULL_FILLED,
}

const controlBarButtons = computed(() => store.getters.getControlBarButtons
  // Like the player, fullscreen hides the theatre mode and full window buttons.
  .filter(id => !fullscreen.value || (id !== 'theatreMode' && id !== 'fullWindow'))
  .map(id => ({
    id,
    path: id === 'fullscreen'
      ? (fullscreen.value ? SHAKA_PREVIEW_ICONS.EXIT_FULLSCREEN : SHAKA_PREVIEW_ICONS.FULLSCREEN)
      : CONTROL_BAR_ICONS[id],
  })))

// Buttons removed from the control bar move into the player menu, except for
// captions, which already have their own menu entry, and fullscreen.
const removedControlBarButtons = computed(() => {
  const selected = store.getters.getControlBarButtons
  return getControlBarButtonDefinitions()
    .filter(({ id }) => !selected.includes(id) && id !== 'captions' && id !== 'fullscreen')
    .map(({ id, labelKey }) => ({
      id,
      path: CONTROL_BAR_ICONS[id],
      // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
      label: t(labelKey),
      value: id === 'pictureInPicture' ? '' : t('Settings.Interface Customizer.Off'),
    }))
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
  const removed = removedControlBarButtons.value
  return [
    { id: 'playbackRate', path: SHAKA_PREVIEW_ICONS.PLAYBACK_RATE, label: t('Settings.Player Settings.Playback Speed'), value: '1x' },
    { id: 'quality', path: SHAKA_PREVIEW_ICONS.RESOLUTION, label: t('Settings.Interface Customizer.Resolution'), value: '1080p' },
    { id: 'sleepTimer', path: PlayerIcons.TIMER_FILLED, label: t('Video.Player.Sleep Timer.Sleep Timer'), value: off },
    ...removed.filter(item => item.id === 'autoplay'),
    store.getters.getEnableSeekHistory && { id: 'seekHistory', icon: ['fas', 'history'], label: t('Video.Player.Seek History.Seek History'), value: t('Video.Player.Seek History.Positions', { count: 2 }, 2) },
    store.getters.getShowSkipSilenceButton && !process.env.IS_IOS && { id: 'skipSilence', path: PlayerIcons.SKIP_NEXT_FILLED, label: t('Settings.Player Settings.Skip Silence'), value: off },
    store.getters.getShowMusicModeToggle && { id: 'musicMode', icon: ['fas', 'headphones'], label: t('Video.Player.Music Mode'), value: off },
    { id: 'ambientMode', path: PlayerIcons.LIGHT_MODE_FILLED, label: t('Global.Ambient Mode'), value: off },
    store.getters.getShowLightsOffToggle && { id: 'lightsOff', icon: ['fas', 'moon'], label: t('Settings.Player Settings.Lights Off'), value: off },
    store.getters.getEnableVideoZoom && { id: 'zoom', path: PlayerIcons.ZOOM_IN_ROUNDED, viewBox: ZOOM_IN_ICON_VIEWBOX, label: t('Video.Player.Zoom.Zoom'), value: off },
    store.getters.getShowVolumeBoostToggle && !process.env.IS_IOS && { id: 'volumeBoost', icon: ['fas', 'volume-high'], label: t('Video.Player.Volume Boost.Volume Boost'), value: off },
    { id: 'loop', path: SHAKA_PREVIEW_ICONS.LOOP, label: t('Settings.Interface Customizer.Loop'), value: off },
    !store.getters.getDisableAbRepeat && { id: 'abRepeat', path: AB_REPEAT_PREVIEW_ICON.path, viewBox: AB_REPEAT_PREVIEW_ICON.viewBox, label: t('Video.Player.A-B Repeat.Set Repeat Start'), value: off },
    ...removed.filter(item => item.id !== 'autoplay'),
  ].filter(Boolean)
})

// The phone layout scrolls the tiles. Fewer tiles or a smaller player can leave
// the offset past the new end, which the scrolling element doesn't clamp itself.
const overflowGrid = useTemplateRef('overflowGrid')
function clampOverflowGrid() {
  const grid = overflowGrid.value
  if (grid) clampOverlayScrollTop(grid, [...grid.querySelectorAll('.previewOverflowItem')].at(-1) ?? null)
}
let overflowGridObserver = null
watch(overflowGrid, grid => {
  overflowGridObserver?.disconnect()
  overflowGridObserver = grid ? new ResizeObserver(clampOverflowGrid) : null
  overflowGridObserver?.observe(grid)
})
watch(overflowItems, clampOverflowGrid, { flush: 'post' })
onBeforeUnmount(() => overflowGridObserver?.disconnect())
</script>

<style scoped src="./PlayerPreview.css" />
