<template>
  <FtButton
    :class="`${kind}IconSettingsButton`"
    :label="title"
    :icon="['fas', 'icons']"
    @click="open = true"
  />
  <FtSettingsSubpage
    :open="open"
    :title="title"
    :icon="['fas', 'icons']"
    grow-with-content
    @close="open = false"
  >
    <div ref="contentRef">
      <p
        v-if="kind === 'app'"
        class="desktopIconHint"
      >
        {{ IS_WINDOWS ? t('App Icon.Windows Hint') : t('App Icon.Running Only Hint') }}
      </p>
      <fieldset
        class="appIconPresets"
        :aria-label="title"
      >
        <label
          v-for="preset in presets"
          :key="preset.id"
          class="appIconPreset"
        >
          <img
            v-if="preset.id === 'default'"
            :src="defaultIcon"
            width="64"
            height="64"
            alt=""
          >
          <span
            v-else
            class="desktopIconPreview"
            :class="{ monochrome: preset.id === MONOCHROME_TRAY_ICON_PRESET }"
            :style="{ color: preset.foreground, backgroundColor: preset.background }"
            aria-hidden="true"
          >
            <span :style="{ maskImage: `url(${maskUrl})` }" />
          </span>
          <span>{{ presetLabel(preset) }}</span>
          <input
            :checked="selected === preset.id"
            type="radio"
            :name="`${kind}IconPreset`"
            :value="preset.id"
            @change="select(preset.id)"
          >
        </label>
      </fieldset>
    </div>
  </FtSettingsSubpage>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import { APP_ICON_PRESETS } from '../../../../appIconPresets'
import defaultIcon from '../../../../../_icons/iconColor.png'
import maskUrl from '../../../assets/img/tray-icon-mask.svg'
import FtButton from '../../FtButton/FtButton.vue'
import FtSettingsSubpage from '../../FtSettingsSubpage/FtSettingsSubpage.vue'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../../helpers/overlayScrollbars'
import { MONOCHROME_TRAY_ICON_PRESET } from '../../../helpers/desktopIcons'

const props = defineProps({
  /** @type {import('vue').PropType<'tray' | 'app'>} */
  kind: {
    type: String,
    required: true,
  },
})

const IS_WINDOWS = process.platform === 'win32'
const store = useStore()
const { t, tm } = useI18n()
const themeNames = computed(() => tm('Settings.Theme Settings.Base Theme'))
const [defaultPreset, ...themePresets] = APP_ICON_PRESETS
// A monochrome glyph without a tile suits panels, but disappears on matching taskbars.
const presets = props.kind === 'tray'
  ? [{ id: 'theme' }, defaultPreset, { id: MONOCHROME_TRAY_ICON_PRESET }, ...themePresets]
  : [{ id: 'theme' }, defaultPreset, ...themePresets]
const title = computed(() => props.kind === 'tray' ? t('Tray Icon.Title') : t('App Icon.Title'))

function presetLabel(preset) {
  switch (preset.id) {
    case 'theme': return t('Tray Icon.Follow App Theme')
    case 'default': return t('Settings.General Settings.Thumbnail Preference.Default')
    case MONOCHROME_TRAY_ICON_PRESET: return t('Tray Icon.Monochrome')
    default: return themeNames.value[preset.translationKey] ?? preset.translationKey
  }
}
const selected = computed(() => props.kind === 'tray' ? store.getters.getTrayIconPreset : store.getters.getAppIconPreset)

function select(presetId) {
  store.dispatch(props.kind === 'tray' ? 'updateTrayIconPreset' : 'updateAppIconPreset', presetId)
}

const open = ref(false)
const contentRef = useTemplateRef('contentRef')
let resizeObserver
watch(open, async (isOpen) => {
  resizeObserver?.disconnect()
  if (!isOpen) return
  await nextTick()
  const content = contentRef.value
  if (!content) return
  const scroller = content.closest('.settingsSubpageScroll')
  restoreOverlayScrollTop(scroller, 0)
  resizeObserver = new ResizeObserver(() => clampOverlayScrollTop(scroller, content))
  resizeObserver.observe(content)
  resizeObserver.observe(scroller)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped src="./AppIconSettings.css" />
<style scoped src="./DesktopIconSettings.css" />
