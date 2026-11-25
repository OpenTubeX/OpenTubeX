<template>
  <menu
    ref="menuElement"
    class="settingsMenu"
    :class="{ filtered }"
  >
    <li
      v-for="(settingsSection, index) in settingsSections"
      :key="settingsSection.type"
      class="titleItem"
      :class="{
        groupStart: settingsSection.group !== settingsSections[index - 1]?.group,
        groupEnd: settingsSection.group !== settingsSections[index + 1]?.group
      }"
      :style="{ '--settings-icon-hue': settingsSection.hue }"
    >
      <button
        ref="linkRefs"
        class="title"
        :class="{ active: activeSection === settingsSection.type }"
        type="button"
        :data-section="settingsSection.type"
        @click.stop="goToSettingsSection"
      >
        <div class="titleContent">
          <div class="iconAndTitleText">
            <span
              class="titleIcon"
              aria-hidden="true"
            >
              <FtIcon :icon="settingsSection.icon" />
            </span>
            <span class="titleText">{{ settingsSection.title }}</span>
          </div>
        </div>
      </button>
    </li>
    <li
      v-if="settingsSections.length === 0 && emptyMessage"
    >
      <p class="emptyMessage">
        {{ emptyMessage }}
      </p>
    </li>
  </menu>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, useTemplateRef, watch } from 'vue'
import store from '../../store/index'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const uiDensity = computed(() => store.getters.getUiDensity)

defineProps({
  settingsSections: {
    type: Array,
    required: true
  },
  activeSection: {
    type: String,
    default: null
  },
  emptyMessage: {
    type: String,
    default: ''
  },
  filtered: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['navigate-to-section'])

/**
 * @param {PointerEvent | KeyboardEvent} event
 */
function goToSettingsSection(event) {
  emit('navigate-to-section', event.currentTarget.dataset.section)
}

const linkRefs = useTemplateRef('linkRefs')
const menuElement = useTemplateRef('menuElement')

watch(uiDensity, () => {
  const menu = menuElement.value
  if (menu?.offsetHeight) {
    clampOverlayScrollTop(menu, menu.querySelector('.titleItem:last-of-type'))
  }
}, { flush: 'post' })

defineExpose({
  /**
   * @param {string} name
   */
  focusLink: (name) => {
    linkRefs.value?.find((link) => link.dataset.section === name)?.focus()
  }
})
</script>

<style scoped src="./FtSettingsMenu.css" />
