<template>
  <WatchChromecast
    v-if="googleCastEnabled"
    ref="googleCast"
    :formats="formats"
    :manifest-url="manifestUrl"
    :manifest-type="manifestType"
    :captions="captions"
    :subtitles-enabled="subtitlesEnabled"
    :is-live="isLive"
    :title="title"
    :get-player="getPlayer"
    :get-source="getSource"
    :disabled="protocolDisabled('google')"
    @close-menu="button?.hideDropdown()"
    @busy-change="updateRemote('busy', 'google', $event)"
    @casting-change="updateRemote('casting', 'google', $event)"
    @playback-state="emit('playback-state', $event)"
    @ended="emit('ended')"
  />
  <WatchChromecast
    v-if="fcastEnabled"
    ref="fcast"
    protocol="fcast"
    :formats="formats"
    :manifest-url="manifestUrl"
    :manifest-type="manifestType"
    :is-live="isLive"
    :title="title"
    :get-player="getPlayer"
    :get-source="getSource"
    :disabled="protocolDisabled('fcast')"
    @close-menu="button?.hideDropdown()"
    @busy-change="updateRemote('busy', 'fcast', $event)"
    @casting-change="updateRemote('casting', 'fcast', $event)"
    @playback-state="emit('playback-state', $event)"
    @ended="emit('ended')"
  />
  <WatchDlnaCast
    v-if="dlnaEnabled"
    ref="dlna"
    :formats="formats"
    :title="title"
    :video-id="videoId"
    :get-player="getPlayer"
    :disabled="protocolDisabled('dlna')"
    @close-menu="button?.hideDropdown()"
    @casting-change="dlnaActive = $event; emit('dlna-change', $event)"
  />
  <FtIconButton
    ref="button"
    class="castControl shaka-no-propagation"
    :class="{ chromecastControl: googleCastEnabled, dlnaCastControl: !googleCastEnabled && dlnaEnabled, fcastControl: !googleCastEnabled && !dlnaEnabled }"
    :title="menuTitle"
    :icon="['fas', 'cast']"
    theme="base-no-default"
    :aria-pressed="casting"
    :force-dropdown="true"
    :disabled="protocols.every(protocolDisabled)"
    dropdown-position-x="right"
    dropdown-class="castMenu"
    :mobile-actions="mobileActions"
    @dropdown-open="refreshAll"
  >
    <template #dropdown-header>
      <div
        v-if="remoteSession"
        class="castHeader"
      >
        <span
          class="castHeaderIcon"
          aria-hidden="true"
        >
          <FtIcon :icon="['fas', 'cast']" />
        </span>
        <span class="castHeaderText">
          <span class="castHeaderTitle">{{ remoteSession.control.deviceName }}</span>
          <!-- Protocol brand names are the same in every locale. -->
          <span class="castHeaderCaption">{{ PROTOCOL_NAMES[remoteSession.protocol] }}</span>
        </span>
      </div>
      <div
        v-else
        class="castHeader"
      >
        <span class="castHeaderTitle">{{ t('Video.Player.Cast') }}</span>
        <button
          type="button"
          class="castHeaderButton"
          :title="t('Theme Discovery.Refresh')"
          :aria-label="t('Theme Discovery.Refresh')"
          :aria-disabled="refreshing"
          @click="refreshAll"
        >
          <FtIcon
            :icon="['fas', 'sync']"
            :spin="refreshing"
            aria-hidden="true"
          />
        </button>
      </div>
    </template>
    <div
      v-if="remoteSession?.protocol === 'dlna'"
      class="castRemote"
    >
      <button
        type="button"
        class="castStop"
        :aria-disabled="remoteSession.control.busy"
        @click="choose('dlna', 'stop')"
      >
        <FtIcon
          :icon="['fas', 'power-off']"
          aria-hidden="true"
        />
        {{ t('Video.Player.DLNA.Stop') }}
      </button>
    </div>
    <div
      v-else-if="remoteSession"
      class="castRemote"
    >
      <template v-if="!isLive && remoteSession.control.status.duration > 0">
        <input
          class="castSlider castSeek"
          type="range"
          min="0"
          :max="remoteSession.control.status.duration"
          step="1"
          :value="seekDraft ?? remoteSession.control.status.currentTime"
          :aria-label="t('Video.Player.Google Cast.Position')"
          :aria-valuetext="`${formatDurationAsTimestamp(seekDraft ?? remoteSession.control.status.currentTime)} / ${formatDurationAsTimestamp(remoteSession.control.status.duration)}`"
          :aria-disabled="remoteSession.control.busy"
          @input="seekDraft = Number($event.target.value)"
          @change="seek"
        >
        <div
          class="castTimes"
          aria-hidden="true"
        >
          <span>{{ formatDurationAsTimestamp(seekDraft ?? remoteSession.control.status.currentTime) }}</span>
          <span>{{ formatDurationAsTimestamp(remoteSession.control.status.duration) }}</span>
        </div>
      </template>
      <div class="castTransport">
        <button
          v-if="!isLive"
          type="button"
          class="castTransportButton"
          :title="t('Video.Player.Google Cast.Rewind')"
          :aria-label="t('Video.Player.Google Cast.Rewind')"
          :aria-disabled="remoteSession.control.busy"
          @click="choose(remoteSession.protocol, 'rewind')"
        >
          <FtIcon
            :icon="['fas', 'undo']"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="castTransportButton castPlay"
          :title="playLabel"
          :aria-label="playLabel"
          :aria-disabled="remoteSession.control.busy"
          @click="choose(remoteSession.protocol, remoteSession.control.status.paused ? 'play' : 'pause')"
        >
          <FtIcon
            :icon="['fas', remoteSession.control.status.paused ? 'play' : 'pause']"
            aria-hidden="true"
          />
        </button>
        <button
          v-if="!isLive"
          type="button"
          class="castTransportButton"
          :title="t('Video.Player.Google Cast.Forward')"
          :aria-label="t('Video.Player.Google Cast.Forward')"
          :aria-disabled="remoteSession.control.busy"
          @click="choose(remoteSession.protocol, 'forward')"
        >
          <FtIcon
            :icon="['fas', 'forward']"
            aria-hidden="true"
          />
        </button>
      </div>
      <div class="castVolume">
        <button
          type="button"
          class="castVolumeButton"
          :title="muteLabel"
          :aria-label="muteLabel"
          :aria-disabled="remoteSession.control.busy"
          @click="choose(remoteSession.protocol, 'mute')"
        >
          <FtIcon
            :icon="['fas', remoteSession.control.status.muted ? 'volume-mute' : 'volume-high']"
            aria-hidden="true"
          />
        </button>
        <input
          class="castSlider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="volumeDraft ?? (remoteSession.control.status.muted ? 0 : remoteSession.control.status.volume)"
          :aria-label="t('Settings.Channel Settings.Volume')"
          :aria-valuetext="`${Math.round((volumeDraft ?? (remoteSession.control.status.muted ? 0 : remoteSession.control.status.volume)) * 100)}%`"
          :aria-disabled="remoteSession.control.busy"
          @input="volumeDraft = Number($event.target.value)"
          @change="setVolume"
        >
      </div>
      <div
        v-if="remoteSession.control.castCaptions.length > 0"
        class="castCaptions"
        role="group"
        :aria-label="t('Search Listing.Label.Subtitles')"
      >
        <button
          v-for="(caption, index) in [{ label: t('Video.Player.Google Cast.Subtitles Off') }, ...remoteSession.control.castCaptions]"
          :key="index"
          type="button"
          class="castCaption"
          :aria-pressed="index === 0 ? remoteSession.control.status.activeTrackIds.length === 0 : remoteSession.control.status.activeTrackIds.includes(index)"
          :aria-disabled="remoteSession.control.busy"
          @click="choose(remoteSession.protocol, `caption-${index}`)"
        >
          <FtIcon
            :icon="['fas', 'closed-captioning']"
            aria-hidden="true"
          />
          {{ caption.label }}
        </button>
      </div>
      <button
        type="button"
        class="castStop"
        :aria-disabled="remoteSession.control.busy"
        @click="choose(remoteSession.protocol, 'stop')"
      >
        <FtIcon
          :icon="['fas', 'display']"
          aria-hidden="true"
        />
        {{ t('Video.Player.Google Cast.Return') }}
      </button>
    </div>
    <ul
      v-else
      class="castDevices"
      :aria-label="t('Video.Player.Cast')"
    >
      <li
        v-for="row in deviceRows"
        :key="`${row.protocol}-${row.value ?? row.label}`"
      >
        <button
          type="button"
          class="castDevice"
          :class="{ castStatus: row.value === undefined }"
          :aria-label="row.label"
          :aria-describedby="protocols.length > 1 ? `${id}-${row.protocol}` : null"
          :disabled="row.disabled || row.value === undefined"
          @click="choose(row.protocol, row.value)"
        >
          <span
            class="castDeviceIcon"
            aria-hidden="true"
          >
            <FtIcon :icon="row.value === undefined ? ['fas', 'circle-info'] : ['fas', 'cast']" />
          </span>
          <span class="castDeviceText">
            <span class="castDeviceName">{{ row.label }}</span>
            <span
              v-if="protocols.length > 1"
              class="castDeviceCaption"
            >{{ PROTOCOL_NAMES[row.protocol] }}</span>
          </span>
        </button>
      </li>
    </ul>
    <!-- Device buttons are described by their protocol's name. -->
    <span
      v-for="protocol in protocols"
      :id="`${id}-${protocol}`"
      :key="protocol"
      hidden
    >{{ PROTOCOL_NAMES[protocol] }}</span>
  </FtIconButton>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, reactive, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import WatchChromecast from '../WatchChromecast/WatchChromecast.vue'
import WatchDlnaCast from '../WatchDlnaCast/WatchDlnaCast.vue'
import { formatDurationAsTimestamp } from '../../helpers/utils'

const props = defineProps({
  googleCastEnabled: { type: Boolean, default: false },
  fcastEnabled: { type: Boolean, default: false },
  dlnaEnabled: { type: Boolean, default: false },
  formats: { type: Array, required: true },
  manifestUrl: { type: String, default: null },
  manifestType: { type: String, default: null },
  captions: { type: Array, default: () => [] },
  subtitlesEnabled: { type: Boolean, default: false },
  isLive: { type: Boolean, default: false },
  title: { type: String, required: true },
  videoId: { type: String, default: null },
  getPlayer: { type: Function, required: true },
  getSource: { type: Function, required: true }
})
const emit = defineEmits(['dlna-change', 'casting-change', 'playback-state', 'ended'])
// Protocol brand names are the same in every locale.
const PROTOCOL_NAMES = { google: 'Google Cast', fcast: 'FCast', dlna: 'DLNA' }
const { t } = useI18n()
const id = useId()
const button = useTemplateRef('button')
const controllers = { google: useTemplateRef('googleCast'), fcast: useTemplateRef('fcast'), dlna: useTemplateRef('dlna') }
const protocols = computed(() => [props.googleCastEnabled && 'google', props.fcastEnabled && 'fcast', props.dlnaEnabled && 'dlna'].filter(Boolean))
const casting = computed(() => Object.values(controllers).some(control => Boolean(control.value?.castId)))
const activeProtocol = computed(() => protocols.value.find(protocolActive))
const menuTitle = computed(() => {
  const protocol = activeProtocol.value ?? (protocols.value.length === 1 ? protocols.value[0] : null)
  return (protocol && controllers[protocol].value?.menuTitle) ?? t('Video.Player.Cast')
})
// A starting, casting or stopping protocol keeps the others unavailable.
const remote = reactive({ busy: { google: false, fcast: false }, casting: { google: false, fcast: false } })
const dlnaActive = ref(false)

watch(protocols, () => button.value?.hideDropdown())

function protocolActive(protocol) {
  return protocol === 'dlna' ? dlnaActive.value : remote.busy[protocol] || remote.casting[protocol]
}

function protocolDisabled(protocol) {
  return Object.keys(PROTOCOL_NAMES).some(other => other !== protocol && protocolActive(other))
}

/** Google Cast and FCast both hand playback to the receiver, so Watch sees them as one remote session. */
function updateRemote(kind, protocol, value) {
  remote[kind][protocol] = value
  if (kind === 'casting') emit('casting-change', remote.casting.google || remote.casting.fcast)
}

const refreshing = computed(() => protocols.value.some(protocol => controllers[protocol].value?.loading))

function refreshAll() {
  for (const protocol of protocols.value) {
    if (!protocolDisabled(protocol)) controllers[protocol].value?.refreshDevices()
  }
}

/**
 * @param {'google' | 'fcast' | 'dlna'} protocol
 * @param {string} value
 */
function choose(protocol, value) {
  // A busy receiver ignores commands, so keep its controls open.
  if (remoteSession.value?.control.busy) return
  controllers[protocol].value?.handleChoice(value)
  // Receiver controls keep the remote open; choosing a device or stopping closes it.
  if (!remoteSession.value || value === 'stop') button.value?.hideDropdown()
}

// The connected receiver, whose controls replace the device list
const remoteSession = computed(() => {
  const protocol = protocols.value.find(candidate => controllers[candidate].value?.castId)
  return protocol ? { protocol, control: controllers[protocol].value } : null
})

// Every protocol's devices share one list; a protocol without devices shows its status instead.
const deviceRows = computed(() => protocols.value.flatMap(protocol => {
  const options = controllers[protocol].value?.options ?? []
  return options
    .filter(option => option.type !== 'divider' && option.value !== 'refresh')
    .map(option => ({ protocol, label: option.label, value: option.value, disabled: option.disabled || protocolDisabled(protocol) }))
}))

const playLabel = computed(() => remoteSession.value?.control.status.paused
  ? t('Video.Player.Scroll Mini Player.Play')
  : t('Video.Player.Scroll Mini Player.Pause'))
const muteLabel = computed(() => remoteSession.value?.control.status.muted
  ? t('Video.Player.SponsorBlock.MuteToastUnmute')
  : t('Video.Player.SponsorBlock.MuteActionType'))

const seekDraft = ref(null)
const volumeDraft = ref(null)
async function seek() {
  const value = seekDraft.value
  if (value === null) return
  await remoteSession.value?.control.control('seek', value)
  seekDraft.value = null
}
async function setVolume() {
  const value = volumeDraft.value
  if (value === null) return
  await remoteSession.value?.control.control('volume', value)
  volumeDraft.value = null
}

/** @param {'google' | 'fcast' | 'dlna'} protocol */
function mobileOptions(protocol) {
  const control = controllers[protocol].value
  return (control?.options ?? []).map(option => option.type === 'divider'
    ? { type: 'separator' }
    : {
        label: option.label,
        icon: option.active ? ['fas', 'check'] : option.icon,
        enabled: !option.disabled && option.value !== undefined,
        run: () => control.handleChoice(option.value)
      })
}

// Phones list a single protocol directly and several as submenus.
const mobileActions = computed(() => {
  const active = activeProtocol.value
  if (active || protocols.value.length === 1) return mobileOptions(active ?? protocols.value[0])
  return protocols.value.map(protocol => ({
    label: PROTOCOL_NAMES[protocol],
    icon: ['fas', 'cast'],
    enabled: !protocolDisabled(protocol),
    submenu: mobileOptions(protocol)
  }))
})

defineExpose({
  stopCasting: resume => Promise.all([controllers.google.value?.stopCasting(resume), controllers.fcast.value?.stopCasting(resume)])
})
</script>

<style scoped src="./WatchCast.css" />
