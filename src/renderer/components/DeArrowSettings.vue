<template>
  <FtSettingsSection
    :title="$t('Settings.SponsorBlock Settings.DeArrow Settings')"
  >
    <FtFlexBox class="settingsFlexStart500px">
      <FtToggleSwitch
        :label="$t('Settings.SponsorBlock Settings.UseDeArrowTitles')"
        :default-value="useDeArrowTitles"
        setting-key="useDeArrowTitles"
        :tooltip="$t('Tooltips.SponsorBlock Settings.UseDeArrowTitles')"
        @change="handleUpdateUseDeArrowTitles"
      />
      <FtToggleSwitch
        :label="$t('Settings.SponsorBlock Settings.UseDeArrowThumbnails')"
        :default-value="useDeArrowThumbnails"
        setting-key="useDeArrowThumbnails"
        :tooltip="$t('Tooltips.SponsorBlock Settings.UseDeArrowThumbnails')"
        @change="handleUpdateUseDeArrowThumbnails"
      />
    </FtFlexBox>
    <FtFlexBox>
      <FtInput
        ref="deArrowThumbnailGeneratorUrl"
        :icon="['fas', 'link']"
        :label="$t('Settings.SponsorBlock Settings[\'DeArrow Thumbnail Generator API Url (Default is https://dearrow-thumb.ajay.app)\']')"
        placeholder="https://dearrow-thumb.ajay.app"
        :supporting-text="$t('Form Inputs.Default Value', { value: 'https://dearrow-thumb.ajay.app' })"
        :show-action-button="false"
        :show-label="true"
        :value="deArrowThumbnailGeneratorUrl"
        setting-key="deArrowThumbnailGeneratorUrl"
        @blur="handleUpdateDeArrowThumbnailGeneratorUrl"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, useTemplateRef } from 'vue'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtInput from './FtInput/FtInput.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'

import store from '../store/index'

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowTitles = computed(() => store.getters.getUseDeArrowTitles)

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowThumbnails = computed(() => store.getters.getUseDeArrowThumbnails)

/** @type {import('vue').ComputedRef<string>} */
const deArrowThumbnailGeneratorUrl = computed(() => store.getters.getDeArrowThumbnailGeneratorUrl)

const deArrowThumbnailGeneratorUrlRef = useTemplateRef('deArrowThumbnailGeneratorUrl')

/**
 * @param {boolean} value
 */
function handleUpdateUseDeArrowTitles(value) {
  store.dispatch('updateUseDeArrowTitles', value)
}

/**
 * @param {boolean} value
 */
function handleUpdateUseDeArrowThumbnails(value) {
  store.dispatch('updateUseDeArrowThumbnails', value)
}

/**
 * @param {string} value
 */
function handleUpdateDeArrowThumbnailGeneratorUrl(value) {
  const cleanValue = value
    .replace(/\/+$/, '')
    .replace(/\/api$/, '')
  store.dispatch('updateDeArrowThumbnailGeneratorUrl', cleanValue)

  if (cleanValue !== value) {
    deArrowThumbnailGeneratorUrlRef.value?.setText(cleanValue)
  }
}
</script>
