<template>
  <menu
    ref="menuElement"
    class="settingsMenu"
    :class="{ filtered, compact: hideSettingsCategoryDescriptions }"
  >
    <li
      v-for="settingsSection in settingsSections"
      :key="settingsSection.type"
      class="titleItem"
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
            <FtIcon
              :icon="settingsSection.icon"
              class="titleIcon"
            />
            <span class="titleText">{{ settingsSection.title }}</span>
            <small
              v-if="settingsSection.description && !hideSettingsCategoryDescriptions"
              class="titleDescription"
            >
              {{ settingsSection.description }}
            </small>
          </div>
          <div class="titleUnderline" />
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

const hideSettingsCategoryDescriptions = computed(() => store.getters.getHideSettingsCategoryDescriptions)

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

watch(hideSettingsCategoryDescriptions, () => {
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
