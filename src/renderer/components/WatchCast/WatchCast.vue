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
    :disabled="protocolDisabled(selectedProtocol)"
    dropdown-position-x="right"
    @dropdown-open="openDropdown"
  >
    <template #dropdown-header>
      <FtTabs
        v-if="protocols.length > 1"
        class="castTabs"
        variant="segmented"
        role="tablist"
        :aria-label="t('Video.Player.Cast')"
      >
        <button
          v-for="protocol in protocols"
          :id="`${id}-${protocol}`"
          :key="protocol"
          type="button"
          class="castTab"
          role="tab"
          :aria-controls="`${id}-panel`"
          :aria-selected="selectedProtocol === protocol"
          :tabindex="selectedProtocol === protocol ? 0 : -1"
          :disabled="protocolDisabled(protocol)"
          @click="selectProtocol(protocol)"
          @keydown.left.prevent="selectAdjacentProtocol(protocol, -1)"
          @keydown.right.prevent="selectAdjacentProtocol(protocol, 1)"
          @keydown.home.prevent="selectProtocol(protocols[0], true)"
          @keydown.end.prevent="selectProtocol(protocols.at(-1), true)"
        >
          <!-- Protocol brand names are the same in every locale. -->
          {{ PROTOCOL_NAMES[protocol] }}
        </button>
      </FtTabs>
    </template>
    <div
      :id="`${id}-panel`"
      :role="protocols.length > 1 ? 'tabpanel' : null"
      :aria-labelledby="protocols.length > 1 ? `${id}-${selectedProtocol}` : null"
    >
      <ul
        class="castOptions"
        role="listbox"
        :aria-label="controller?.menuTitle"
      >
        <li
          v-for="(option, index) in controller?.options ?? []"
          :key="index"
          :role="option.type === 'divider' ? 'separator' : 'option'"
          :aria-selected="option.active"
          :aria-disabled="option.disabled"
          :tabindex="option.type === 'divider' || option.disabled ? -1 : 0"
          :class="{ castDivider: option.type === 'divider', castOption: option.type !== 'divider' }"
          @click="handleChoice(option)"
          @keydown.enter.prevent="handleChoice(option)"
          @keydown.space.prevent="handleChoice(option)"
        >
          <template v-if="option.type !== 'divider'">
            <FtIcon
              v-if="option.icon || option.active"
              :icon="option.active ? ['fas', 'check'] : option.icon"
              aria-hidden="true"
            />
            <span>{{ option.label }}</span>
          </template>
        </li>
      </ul>
    </div>
  </FtIconButton>
</template>

<script setup>
import FtTabs from '../FtTabs/FtTabs.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, reactive, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import WatchChromecast from '../WatchChromecast/WatchChromecast.vue'
import WatchDlnaCast from '../WatchDlnaCast/WatchDlnaCast.vue'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

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
const selectedProtocol = ref(protocols.value[0])
const controller = computed(() => controllers[selectedProtocol.value]?.value)
const casting = computed(() => Object.values(controllers).some(control => Boolean(control.value?.castId)))
const menuTitle = computed(() => protocols.value.length > 1 && !casting.value
  ? t('Video.Player.Cast')
  : controller.value?.menuTitle ?? t('Video.Player.Cast'))
const scrollPositions = { google: 0, fcast: 0, dlna: 0 }
// A starting, casting or stopping protocol keeps the others unavailable.
const remote = reactive({ busy: { google: false, fcast: false }, casting: { google: false, fcast: false } })
const dlnaActive = ref(false)
const discoveredProtocols = new Set()

watch(protocols, available => {
  button.value?.hideDropdown()
  discoveredProtocols.clear()
  if (!available.includes(selectedProtocol.value)) selectedProtocol.value = available[0]
})

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

function refreshDevices() {
  discoveredProtocols.add(selectedProtocol.value)
  controller.value?.refreshDevices()
}

function openDropdown() {
  discoveredProtocols.clear()
  refreshDevices()
}

function selectAdjacentProtocol(protocol, offset) {
  const available = protocols.value
  const index = available.indexOf(protocol)
  for (let step = 1; step < available.length; step++) {
    const next = available[(((index + offset * step) % available.length) + available.length) % available.length]
    if (!protocolDisabled(next)) return selectProtocol(next, true)
  }
}

async function selectProtocol(protocol, focus = false) {
  if (protocolDisabled(protocol)) return
  const scroller = button.value?.$el.querySelector('.iconDropdownContent')
  if (scroller) scrollPositions[selectedProtocol.value] = scroller.scrollTop
  selectedProtocol.value = protocol
  await nextTick()
  button.value?.updateDropdownLayout()
  if (scroller) restoreOverlayScrollTop(scroller, scrollPositions[protocol])
  if (focus) button.value?.$el.querySelector(`#${CSS.escape(`${id}-${protocol}`)}`)?.focus()
  if (!discoveredProtocols.has(protocol)) refreshDevices()
}

function handleChoice(option) {
  if (option.disabled || option.type === 'divider') return
  controller.value?.handleChoice(option.value)
  button.value?.hideDropdown()
}

defineExpose({
  stopCasting: resume => Promise.all([controllers.google.value?.stopCasting(resume), controllers.fcast.value?.stopCasting(resume)])
})
</script>

<style scoped src="./WatchCast.css" />
