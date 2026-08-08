<template>
  <menu
    class="settingsMenu"
    :class="{ filtered }"
  >
    <button
      v-for="settingsSection in settingsSections"
      ref="linkRefs"
      :key="settingsSection.type"
      class="title"
      :class="{ active: activeSection === settingsSection.type }"
      type="button"
      :data-section="settingsSection.type"
      @click.stop="goToSettingsSection"
    >
      <div class="titleContent">
        <div class="iconAndTitleText">
          <FontAwesomeIcon
            :icon="settingsSection.icon"
            class="titleIcon"
          />
          {{ settingsSection.title }}
        </div>
        <div class="titleUnderline" />
      </div>
    </button>
    <p
      v-if="settingsSections.length === 0 && emptyMessage"
      class="emptyMessage"
    >
      {{ emptyMessage }}
    </p>
  </menu>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
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
    linkRefs.value.find((link) => link.dataset.section === name)?.focus()
  }
})
</script>

<style scoped src="./FtSettingsMenu.css" />
