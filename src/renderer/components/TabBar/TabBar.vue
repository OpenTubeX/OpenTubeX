<template>
  <div
    v-if="isElectron"
    class="tabBar"
  >
    <div
      ref="tabsContainer"
      class="tabsContainer"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.isActive }"
        :title="tab.title"
        role="button"
        tabindex="0"
        @click="activateTab(tab.id)"
        @keydown.enter.prevent="activateTab(tab.id)"
        @keydown.space.prevent="activateTab(tab.id)"
        @auxclick.prevent="handleMiddleClick($event, tab.id)"
      >
        <span class="tabTitle">{{ tab.title }}</span>
        <button
          class="closeButton"
          :aria-label="t('Close Tab')"
          :title="t('Close Tab')"
          @click.stop="closeTab(tab.id)"
        >
          <FontAwesomeIcon
            :icon="['fas', 'times']"
            class="closeIcon"
          />
        </button>
      </div>
    </div>
    <button
      class="newTabButton"
      :aria-label="t('New Tab')"
      :title="newTabTooltip"
      @click="createNewTab"
    >
      <FontAwesomeIcon
        :icon="['fas', 'plus']"
        class="newTabIcon"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onMounted } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'

import store from '../../store/index'
import { KeyboardShortcuts } from '../../../constants'
import { localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'

const { t } = useI18n()

const isElectron = process.env.IS_ELECTRON

/** @type {import('vue').ComputedRef<Array<{id: string, url: string, title: string, isActive: boolean}>>} */
const tabs = computed(() => store.getters.getTabs)

const newTabTooltip = computed(() => {
  return localizeAndAddKeyboardShortcutToActionTitle(
    t('New Tab'),
    KeyboardShortcuts.APP.GENERAL.NEW_TAB
  )
})

onMounted(() => {
  if (isElectron) {
    store.dispatch('initializeTabs')
  }
})

/**
 * @param {string} tabId
 */
function activateTab(tabId) {
  store.dispatch('activateTab', tabId)
}

/**
 * @param {string} tabId
 */
async function closeTab(tabId) {
  const hasRemainingTabs = await store.dispatch('closeTab', tabId)
  if (!hasRemainingTabs) {
    // Close window if no tabs left
    window.close()
  }
}

/**
 * @param {MouseEvent} event
 * @param {string} tabId
 */
function handleMiddleClick(event, tabId) {
  // Middle click to close tab
  if (event.button === 1) {
    closeTab(tabId)
  }
}

function createNewTab() {
  store.dispatch('createTab', { makeActive: true })
}
</script>

<style scoped src="./TabBar.css" />
