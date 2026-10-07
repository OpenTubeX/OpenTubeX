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
    :disabled="dlnaActive"
    @close-menu="button?.hideDropdown()"
    @busy-change="emit('busy-change', $event)"
    @casting-change="emit('casting-change', $event)"
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
    :disabled="googleCastActive || googleCastBusy"
    @close-menu="button?.hideDropdown()"
    @casting-change="emit('dlna-change', $event)"
  />
  <FtIconButton
    ref="button"
    class="castControl shaka-no-propagation"
    :class="{ chromecastControl: googleCastEnabled, dlnaCastControl: !googleCastEnabled && dlnaEnabled }"
    :title="menuTitle"
    :icon="['fas', 'cast']"
    :aria-pressed="Boolean(googleCast?.castId || dlna?.castId)"
    :force-dropdown="true"
    :disabled="protocolDisabled(selectedProtocol)"
    dropdown-position-x="right"
    @dropdown-open="refreshDevices"
  >
    <template #dropdown-header>
      <div
        v-if="protocols.length > 1"
        class="castTabs"
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
          @keydown.left.right.prevent="selectProtocol(protocol === 'google' ? 'dlna' : 'google', true)"
          @keydown.home.prevent="selectProtocol(protocols[0], true)"
          @keydown.end.prevent="selectProtocol(protocols.at(-1), true)"
        >
          <!-- Protocol brand names are the same in every locale. -->
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -->
          {{ protocol === 'google' ? 'Google Cast' : 'DLNA' }}
        </button>
      </div>
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
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import WatchChromecast from '../WatchChromecast/WatchChromecast.vue'
import WatchDlnaCast from '../WatchDlnaCast/WatchDlnaCast.vue'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  googleCastEnabled: { type: Boolean, default: false },
  dlnaEnabled: { type: Boolean, default: false },
  googleCastActive: { type: Boolean, default: false },
  googleCastBusy: { type: Boolean, default: false },
  dlnaActive: { type: Boolean, default: false },
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
const emit = defineEmits(['dlna-change', 'busy-change', 'casting-change', 'playback-state', 'ended'])
const { t } = useI18n()
const id = useId()
const button = useTemplateRef('button')
const googleCast = useTemplateRef('googleCast')
const dlna = useTemplateRef('dlna')
const protocols = computed(() => [props.googleCastEnabled && 'google', props.dlnaEnabled && 'dlna'].filter(Boolean))
const selectedProtocol = ref(protocols.value[0])
const controller = computed(() => selectedProtocol.value === 'google' ? googleCast.value : dlna.value)
const menuTitle = computed(() => protocols.value.length > 1 && !googleCast.value?.castId && !dlna.value?.castId
  ? t('Video.Player.Cast')
  : controller.value?.menuTitle ?? t('Video.Player.Cast'))
const scrollPositions = { google: 0, dlna: 0 }
const discoveredProtocols = new Set()

watch(protocols, available => {
  button.value?.hideDropdown()
  discoveredProtocols.clear()
  if (!available.includes(selectedProtocol.value)) selectedProtocol.value = available[0]
})

function protocolDisabled(protocol) {
  return protocol === 'google' ? props.dlnaActive : props.googleCastActive || props.googleCastBusy
}

function refreshDevices() {
  discoveredProtocols.add(selectedProtocol.value)
  controller.value?.refreshDevices()
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

defineExpose({ stopCasting: resume => googleCast.value?.stopCasting(resume) })
</script>

<style scoped src="./WatchCast.css" />
