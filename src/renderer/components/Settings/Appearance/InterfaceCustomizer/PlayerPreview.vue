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
        v-if="displayVideoPlayButton"
        class="previewBigPlay"
      >
        <PreviewIcon :path="paused ? SHAKA_PREVIEW_ICONS.PLAY : SHAKA_PREVIEW_ICONS.PAUSE" />
      </span>
      <div
        v-if="menuOpen"
        class="previewOverflowMenu"
        :class="{ list: !usePlayerMenuGrid }"
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
            :class="{ submenu: SUBMENU_CONTROLS.has(item.id) }"
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
            <span
              v-if="item.value"
              class="previewOverflowValue"
            >{{ item.value }}</span>
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
          <template v-if="!IS_CAPACITOR">
            <span class="previewPill previewIconPill">
              <PreviewIcon :path="paused ? SHAKA_PREVIEW_ICONS.PLAY : SHAKA_PREVIEW_ICONS.PAUSE" />
            </span>
            <span class="previewPill previewIconPill">
              <PreviewIcon :path="SHAKA_PREVIEW_ICONS.MUTE" />
            </span>
          </template>
          <span class="previewPill previewTextPill">{{ PREVIEW_TIME }}</span>
          <span
            v-if="showChaptersPill"
            class="previewPill previewTextPill previewChaptersPill"
            data-preview-chapters
          >{{ t('Chapters.Chapters') }}</span>
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
                :class="{ open: button.id === 'menu' && menuOpen }"
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

import store from '../../../../store/index'
import { PlayerIcons, ZOOM_IN_ICON_VIEWBOX } from '../../../../../constants'
import { CONTROL_BAR_BUTTON_DEFINITIONS, getPreviewMenuControlBarButtons } from '../../../../helpers/controlBarButtons'
import { clampOverlayScrollTop } from '../../../../helpers/overlayScrollbars'
import { usePhoneLayout } from '../../../../composables/usePhoneLayout'
import { FULLSCREEN_ACTION_DEFINITIONS } from '../../../../helpers/fullscreenActions'
import { getQuickPlaybackRateLabel } from '../../../../helpers/player/quickPlaybackRateLabel'
import { AB_REPEAT_PREVIEW_ICON, SHAKA_PREVIEW_ICONS } from './playerPreviewIcons'

const props = defineProps({
  state: {
    type: String,
    default: 'window',
    validator: value => ['window', 'menu', 'fullscreen', 'paused'].includes(value)
  },
  /** Whether the playing preview shows the player menu. */
  menu: {
    type: Boolean,
    default: false
  }
})

const { locale, t } = useI18n()
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
const PREVIEW_TIME = '0:42 / 3:14'

function PreviewIcon({ path, viewBox = '0 -960 960 960' }) {
  return h('svg', { class: 'previewIcon', viewBox, 'aria-hidden': 'true' }, [h('path', { d: path })])
}
PreviewIcon.props = ['path', 'viewBox']

const fullscreen = computed(() => props.state === 'fullscreen' || props.state === 'paused')
const paused = computed(() => props.state === 'paused')
// Like the player, narrow windows and phones use the compact controls, whose
// menu covers the whole player, so only there it gets a preview state of its own.
const compact = usePhoneLayout()
const menuOpen = computed(() => props.state === 'menu' || (props.menu && props.state === 'window' && !compact.value))

const usePlayerMenuGrid = computed(() => store.getters.getUsePlayerMenuGrid)
const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)
const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)
const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)
// The mobile player always shows its center button.
const displayVideoPlayButton = computed(() => IS_CAPACITOR || store.getters.getDisplayVideoPlayButton)
const enableScreenshot = computed(() => store.getters.getEnableScreenshot)

// Parse and label the options like the player's quick playback speed bar.
const quickPlaybackRates = computed(() => {
  // The compact desktop controls leave the speed bar out.
  if (!store.getters.getUseQuickPlaybackSpeedBar || (compact.value && !IS_CAPACITOR)) return []
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
  quality: SHAKA_PREVIEW_ICONS.RESOLUTION,
  audioTracks: PlayerIcons.RECORD_VOICE_OVER_FILLED,
  playbackRate: SHAKA_PREVIEW_ICONS.PLAYBACK_RATE,
  loop: SHAKA_PREVIEW_ICONS.LOOP,
  screenshot: PlayerIcons.PHOTO_CAMERA_FILLED,
  autoplay: PlayerIcons.PAUSE_CIRCLE_FILLED,
  captions: SHAKA_PREVIEW_ICONS.CLOSED_CAPTIONS,
  menu: SHAKA_PREVIEW_ICONS.OPEN_OVERFLOW,
  pictureInPicture: SHAKA_PREVIEW_ICONS.PICTURE_IN_PICTURE,
  theatreMode: PlayerIcons.RECTANGLE_DEFAULT,
  fullWindow: PlayerIcons.OPEN_IN_FULL_FILLED,
}

// The other buttons move into the compact controls' menu.
const COMPACT_CONTROL_BAR_BUTTONS = ['captions', 'menu', 'fullscreen', ...(IS_CAPACITOR ? ['pictureInPicture'] : [])]

const controlBarButtons = computed(() => store.getters.getControlBarButtons
  // The screenshot button only shows while screenshots are enabled, and the
  // chapters button sits next to the time.
  .filter(id => (id !== 'screenshot' || enableScreenshot.value) && id !== 'chapters')
  // Like the player, fullscreen hides the theatre mode and full window buttons.
  .filter(id => compact.value
    ? COMPACT_CONTROL_BAR_BUTTONS.includes(id)
    : !fullscreen.value || (id !== 'theatreMode' && id !== 'fullWindow'))
  .map(id => ({
    id,
    path: id === 'fullscreen'
      ? (fullscreen.value ? SHAKA_PREVIEW_ICONS.EXIT_FULLSCREEN : SHAKA_PREVIEW_ICONS.FULLSCREEN)
      : CONTROL_BAR_ICONS[id],
  })))

function controlBarMenuItem(id) {
  const { labelKey } = CONTROL_BAR_BUTTON_DEFINITIONS.find(button => button.id === id)
  return {
    id,
    path: CONTROL_BAR_ICONS[id],
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(labelKey),
    value: id === 'pictureInPicture' ? '' : t('Settings.Interface Customizer.Off'),
  }
}

// Buttons removed from the control bar move into the player menu
const CONTROL_BAR_BUTTON_IDS = new Set(CONTROL_BAR_BUTTON_DEFINITIONS.map(({ id }) => id))
const removedControlBarButtons = computed(() => (
  new Set(getPreviewMenuControlBarButtons(store.getters.getControlBarButtons))
))

const fullscreenActions = computed(() => {
  const definitions = new Map(FULLSCREEN_ACTION_DEFINITIONS.map(action => [action.id, action]))
  return store.getters.getFullscreenActions.map(id => ({
    ...definitions.get(id),
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(definitions.get(id).labelKey),
  }))
})

// Like the player, the chapters button on the control bar sits next to the
// time, which the compact desktop controls leave out.
const showChaptersPill = computed(() => store.getters.getControlBarButtons.includes('chapters') && (!compact.value || IS_CAPACITOR))

// The audio track of the example video is in the app's language.
const audioTrackLanguage = computed(() => {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'language' }).of(new Intl.Locale(locale.value).language) ?? ''
  } catch {
    return ''
  }
})

// The entries that open a submenu, which the list layout marks with a chevron.
const SUBMENU_CONTROLS = new Set(['audioTracks', 'captions', 'playbackRate', 'quality', 'sleepTimer', 'seekHistory', 'videoZoom', 'volumeBoost'])

// Mirrors the overflow menu of a video that has every control available, with the current settings.
const overflowItems = computed(() => {
  const off = t('Settings.Interface Customizer.Off')
  const hidden = new Set(store.getters.getHiddenPlayerMenuControls)
  const items = {
    audioTracks: { path: PlayerIcons.RECORD_VOICE_OVER_FILLED, label: t('Video.Player.Audio Tracks'), value: audioTrackLanguage.value },
    captions: { path: SHAKA_PREVIEW_ICONS.CLOSED_CAPTIONS_STYLE, label: t('Settings.Player Settings.Caption Appearance.Captions'), value: off },
    chapters: { path: SHAKA_PREVIEW_ICONS.CHAPTER, label: t('Chapters.Chapters'), value: '' },
    voiceOverTranslation: store.getters.getUseVoiceOverTranslation && { path: PlayerIcons.RECORD_VOICE_OVER_FILLED, label: t('Settings.Player Settings.Voice-over Translation.Title'), value: t('Video.Player.Voice-over Translation.Start') },
    musicVisualizer: { path: PlayerIcons.INSERT_CHART_FILLED, label: t('Settings.Player Settings.Music Visualizer'), value: '' },
    playbackRate: { path: SHAKA_PREVIEW_ICONS.PLAYBACK_RATE, label: t('Settings.Player Settings.Playback Speed'), value: '1x' },
    quality: { path: SHAKA_PREVIEW_ICONS.RESOLUTION, label: t('Settings.Interface Customizer.Resolution'), value: '1080p' },
    sleepTimer: { path: PlayerIcons.TIMER_FILLED, label: t('Video.Player.Sleep Timer.Sleep Timer'), value: off },
    autoplay: controlBarMenuItem('autoplay'),
    seekHistory: store.getters.getEnableSeekHistory && { icon: ['fas', 'history'], label: t('Video.Player.Seek History.Seek History'), value: t('Video.Player.Seek History.Positions', { count: 2 }, 2) },
    skipSilence: store.getters.getShowSkipSilenceButton && !process.env.IS_IOS && { path: PlayerIcons.SKIP_NEXT_FILLED, label: t('Settings.Player Settings.Skip Silence'), value: off },
    musicMode: store.getters.getShowMusicModeToggle && { icon: ['fas', 'headphones'], label: t('Video.Player.Music Mode'), value: off },
    ambientMode: { path: PlayerIcons.LIGHT_MODE_FILLED, label: t('Global.Ambient Mode'), value: off },
    lightsOff: store.getters.getShowLightsOffToggle && { icon: ['fas', 'moon'], label: t('Settings.Player Settings.Lights Off'), value: off },
    videoZoom: store.getters.getEnableVideoZoom && { path: PlayerIcons.ZOOM_IN_ROUNDED, viewBox: ZOOM_IN_ICON_VIEWBOX, label: t('Video.Player.Zoom.Zoom'), value: off },
    volumeBoost: store.getters.getShowVolumeBoostToggle && !process.env.IS_IOS && { icon: ['fas', 'volume-high'], label: t('Video.Player.Volume Boost.Volume Boost'), value: off },
    monoAudio: store.getters.getShowMonoAudioToggle && !process.env.IS_IOS && { icon: ['fas', 'speaker'], label: t('Settings.Player Settings.Mono Audio'), value: off },
    loop: { path: SHAKA_PREVIEW_ICONS.LOOP, label: t('Settings.Interface Customizer.Loop'), value: off },
    abRepeat: !store.getters.getDisableAbRepeat && { path: AB_REPEAT_PREVIEW_ICON.path, viewBox: AB_REPEAT_PREVIEW_ICON.viewBox, label: t('Video.Player.A-B Repeat.Set Repeat Start'), value: off },
    pictureInPicture: controlBarMenuItem('pictureInPicture'),
    // Like the player, the compact menu has no theatre mode, and Capacitor no full window.
    theatreMode: !compact.value && controlBarMenuItem('theatreMode'),
    fullWindow: !IS_CAPACITOR && controlBarMenuItem('fullWindow'),
    screenshot: enableScreenshot.value && { path: PlayerIcons.PHOTO_CAMERA_FILLED, label: t('Video.Player.Take Screenshot'), value: '' },
  }
  return store.getters.getPlayerMenuControls
    .filter(id => items[id] && !hidden.has(id) &&
        // The full control bar keeps its buttons out of the menu, except for
        // the caption toggle, which keeps the caption menu. The compact
        // controls of phones keep the chapters next to the time.
        (compact.value
          ? !(IS_CAPACITOR && id === 'chapters' && store.getters.getControlBarButtons.includes(id))
          : id === 'captions' || !CONTROL_BAR_BUTTON_IDS.has(id) || removedControlBarButtons.value.has(id)))
    .map(id => ({ ...items[id], id }))
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
