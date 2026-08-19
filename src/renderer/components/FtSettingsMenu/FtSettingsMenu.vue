<template>
  <menu
    class="settingsMenu"
    :class="{ filtered }"
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
              v-if="settingsSection.description"
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
import { useTemplateRef } from 'vue'

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
