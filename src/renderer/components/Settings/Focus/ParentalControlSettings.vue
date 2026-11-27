<template>
  <FtSettingsSection
    :title="$t('Settings.Parental Control Settings.Parental Control Settings')"
    hide-title
  >
    <div class="settingsRows">
      <FtSettingsRow
        :title="$t('Settings.Parental Control Settings.Hide Unsubscribe Button')"
        :icon="['fas', 'user-minus']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Parental Control Settings.Hide Unsubscribe Button')"
          hide-label
          :default-value="hideUnsubscribeButton"
          setting-key="hideUnsubscribeButton"
          @change="updateHideUnsubscribeButton"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Parental Control Settings.Show Family Friendly Only')"
        :icon="['fas', 'shield-halved']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Parental Control Settings.Show Family Friendly Only')"
          hide-label
          :default-value="showFamilyFriendlyOnly"
          setting-key="showFamilyFriendlyOnly"
          @change="updateShowFamilyFriendlyOnly"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Parental Control Settings.Hide Search Bar')"
        :icon="['fas', 'magnifying-glass']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Parental Control Settings.Hide Search Bar')"
          hide-label
          :default-value="hideSearchBar"
          setting-key="hideSearchBar"
          @change="updateHideSearchBar"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Parental Control Settings.Disable Channel Links')"
        :icon="['fas', 'link-slash']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Parental Control Settings.Disable Channel Links')"
          hide-label
          :default-value="disableChannelLinks"
          setting-key="disableChannelLinks"
          @change="updateDisableChannelLinks"
        />
      </FtSettingsRow>
      <FtSettingsRow
        :title="$t('Settings.Parental Control Settings.Hide Uploader on Watch page')"
        :icon="['fas', 'circle-user']"
      >
        <FtToggleSwitch
          :label="$t('Settings.Parental Control Settings.Hide Uploader on Watch page')"
          hide-label
          :default-value="hideUploader"
          setting-key="hideUploader"
          @change="updateHideUploader"
        />
      </FtSettingsRow>
    </div>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'

import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'

const hideSearchBar = computed(() => {
  return store.getters.getHideSearchBar
})

const hideUnsubscribeButton = computed(() => {
  return store.getters.getHideUnsubscribeButton
})

const hideUploader = computed(() => {
  return store.getters.getHideUploader
})

const showFamilyFriendlyOnly = computed(() => {
  return store.getters.getShowFamilyFriendlyOnly
})

const disableChannelLinks = computed(() => {
  return store.getters.getDisableChannelLinks
})

/**
 * @param {boolean} value
 */
function updateHideSearchBar(value) {
  store.dispatch('updateHideSearchBar', value)
}

/**
 * @param {boolean} value
 */
function updateHideUnsubscribeButton(value) {
  store.dispatch('updateHideUnsubscribeButton', value)
}

/**
 * @param {boolean} value
 */
function updateHideUploader(value) {
  store.dispatch('updateHideUploader', value)
}

/**
 * @param {boolean} value
 */
function updateShowFamilyFriendlyOnly(value) {
  store.dispatch('updateShowFamilyFriendlyOnly', value)
}

/**
 * @param {boolean} value
 */
function updateDisableChannelLinks(value) {
  store.dispatch('updateDisableChannelLinks', value)
}
</script>
