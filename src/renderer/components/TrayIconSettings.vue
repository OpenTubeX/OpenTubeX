<template>
  <FtButton
    class="trayIconSettingsButton"
    :label="t('Tray Icon.Title')"
    :icon="['fas', 'icons']"
    @click="open = true"
  />
  <FtSettingsSubpage
    :open="open"
    :title="t('Tray Icon.Title')"
    :icon="['fas', 'icons']"
    grow-with-content
    @close="open = false"
  >
    <div ref="contentRef">
      <fieldset
        class="appIconPresets"
        :aria-label="t('Tray Icon.Title')"
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
            class="trayIconPreview"
            :style="{ color: preset.foreground, backgroundColor: preset.background }"
            aria-hidden="true"
          >
            <span :style="{ maskImage: `url(${maskUrl})` }" />
          </span>
          <span>{{ preset.id === 'theme'
            ? t('Tray Icon.Follow App Theme')
            : preset.translationKey
              ? (themeNames[preset.translationKey] ?? preset.translationKey)
              : t('Settings.General Settings.Thumbnail Preference.Default') }}</span>
          <input
            :checked="selected === preset.id"
            type="radio"
            name="trayIconPreset"
            :value="preset.id"
            @change="store.dispatch('updateTrayIconPreset', preset.id)"
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
import { APP_ICON_PRESETS } from '../../appIconPresets'
import defaultIcon from '../../../_icons/iconColor.png'
import maskUrl from '../assets/img/tray-icon-mask.svg'
import FtButton from './FtButton/FtButton.vue'
import FtSettingsSubpage from './FtSettingsSubpage/FtSettingsSubpage.vue'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../helpers/overlayScrollbars'

const store = useStore()
const { t, tm } = useI18n()
const themeNames = computed(() => tm('Settings.Theme Settings.Base Theme'))
const presets = [{ id: 'theme' }, ...APP_ICON_PRESETS]
const selected = computed(() => store.getters.getTrayIconPreset)
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
<style scoped src="./TrayIconSettings.css" />
