<template>
  <FtSettingsSection
    :title="$t('Settings.SponsorBlock Settings.SponsorBlock Settings')"
  >
    <FtFlexBox class="settingsFlexStart500px">
      <FtToggleSwitch
        :label="$t('Settings.SponsorBlock Settings.Enable SponsorBlock')"
        :default-value="useSponsorBlock"
        @change="handleUpdateSponsorBlock"
      />
      <FtToggleSwitch
        :label="$t('Settings.SponsorBlock Settings.UseDeArrowTitles')"
        :default-value="useDeArrowTitles"
        :tooltip="$t('Tooltips.SponsorBlock Settings.UseDeArrowTitles')"
        @change="handleUpdateUseDeArrowTitles"
      />
      <FtToggleSwitch
        :label="$t('Settings.SponsorBlock Settings.UseDeArrowThumbnails')"
        :default-value="useDeArrowThumbnails"
        :tooltip="$t('Tooltips.SponsorBlock Settings.UseDeArrowThumbnails')"
        @change="handleUpdateUseDeArrowThumbnails"
      />
    </FtFlexBox>
    <template
      v-if="useSponsorBlock || useDeArrowTitles || useDeArrowThumbnails"
    >
      <FtFlexBox
        v-if="useSponsorBlock"
        class="settingsFlexStart500px"
      >
        <FtToggleSwitch
          :label="$t('Settings.SponsorBlock Settings.Notify when sponsor segment is skipped')"
          :default-value="sponsorBlockShowSkippedToast"
          @change="handleUpdateSponsorBlockShowSkippedToast"
        />
        <FtToggleSwitch
          :label="$t('Settings.SponsorBlock Settings.Enable SponsorBlock Submission')"
          :default-value="sponsorBlockEnableSubmission"
          @change="handleUpdateSponsorBlockEnableSubmission"
        />
        <FtSlider
          :label="$t('Settings.SponsorBlock Settings.Skip notification timeout')"
          :default-value="sponsorBlockSkippedToastDuration"
          :min-value="2"
          :max-value="15"
          :step="1"
          value-extension="s"
          :disabled="!sponsorBlockShowSkippedToast"
          @change="handleUpdateSponsorBlockSkippedToastDuration"
        />
      </FtFlexBox>
      <FtFlexBox>
        <FtInput
          :placeholder="$t('Settings.SponsorBlock Settings[\'SponsorBlock API Url (Default is https://sponsor.ajay.app)\']')"
          :show-action-button="false"
          :show-label="true"
          :value="sponsorBlockUrl"
          @input="handleUpdateSponsorBlockUrl"
        />
      </FtFlexBox>
      <FtFlexBox
        v-if="useSponsorBlock && sponsorBlockEnableSubmission"
      >
        <div class="sponsorBlockUserIdSection">
          <FtInput
            :placeholder="$t('Settings.SponsorBlock Settings.SponsorBlock Private User ID (optional)')"
            :show-action-button="false"
            :show-label="true"
            :tooltip="$t('Settings.SponsorBlock Settings.SponsorBlock Private User ID Tooltip')"
            :value="sponsorBlockUserId"
            @input="handleUpdateSponsorBlockUserId"
          />
          <div
            v-if="sponsorBlockGeneratedUserId !== ''"
            class="generatedUserIdContainer"
          >
            <FtButton
              v-if="!showGeneratedSponsorBlockUserId"
              :label="t('Settings.SponsorBlock Settings.Export Generated User ID')"
              @click="handleShowGeneratedSponsorBlockUserId"
            />
            <div
              v-else
              class="generatedUserIdActionRow"
            >
              <div class="generatedUserIdInfo">
                <div class="generatedUserIdLabelRow">
                  <span class="generatedUserIdLabel">
                    {{ t('Settings.SponsorBlock Settings.Generated SponsorBlock User ID') }}
                  </span>
                  <FtTooltip
                    position="bottom"
                    :tooltip="t('Settings.SponsorBlock Settings.Generated SponsorBlock User ID Tooltip')"
                  />
                </div>
                <div class="generatedUserIdValueRow">
                  <div class="generatedUserIdValue">
                    {{ sponsorBlockGeneratedUserId }}
                  </div>
                  <FtIconButton
                    :title="t('Settings.SponsorBlock Settings.Generated SponsorBlock User ID Copy Button')"
                    :icon="['fas', 'copy']"
                    theme="secondary"
                    :use-shadow="false"
                    :size="14"
                    :padding="5"
                    @click="handleCopyGeneratedSponsorBlockUserId"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </FtFlexBox>
      <FtFlexBox
        v-if="useDeArrowThumbnails"
      >
        <FtInput
          v-if="useDeArrowThumbnails"
          :placeholder="$t('Settings.SponsorBlock Settings[\'DeArrow Thumbnail Generator API Url (Default is https://dearrow-thumb.ajay.app)\']')"
          :show-action-button="false"
          :show-label="true"
          :value="deArrowThumbnailGeneratorUrl"
          @input="handleUpdateDeArrowThumbnailGeneratorUrl"
        />
      </FtFlexBox>

      <FtFlexBox
        v-if="useSponsorBlock"
      >
        <FtSponsorBlockCategory
          v-for="category in CATEGORIES"
          :key="category"
          :category-name="category"
        />
      </FtFlexBox>
    </template>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from '../composables/use-i18n-polyfill'

import FtButton from './FtButton/FtButton.vue'
import FtIconButton from './FtIconButton/FtIconButton.vue'
import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtInput from './FtInput/FtInput.vue'
import FtSlider from './FtSlider/FtSlider.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtSponsorBlockCategory from './FtSponsorBlockCategory/FtSponsorBlockCategory.vue'
import FtTooltip from './FtTooltip/FtTooltip.vue'

import store from '../store/index'
import { copyToClipboard } from '../helpers/utils'

const { t } = useI18n()
const showGeneratedSponsorBlockUserId = ref(false)

const CATEGORIES = [
  'sponsor',
  'self-promotion',
  'interaction',
  'intro',
  'outro',
  'recap',
  'music offtopic',
  'filler',
  'highlight'
]

/** @type {import('vue').ComputedRef<boolean>} */
const useSponsorBlock = computed(() => store.getters.getUseSponsorBlock)

/** @type {import('vue').ComputedRef<string>} */
const sponsorBlockUrl = computed(() => store.getters.getSponsorBlockUrl)

/** @type {import('vue').ComputedRef<boolean>} */
const sponsorBlockShowSkippedToast = computed(() => store.getters.getSponsorBlockShowSkippedToast)

/** @type {import('vue').ComputedRef<number>} */
const sponsorBlockSkippedToastDuration = computed(() => store.getters.getSponsorBlockSkippedToastDuration)

/** @type {import('vue').ComputedRef<boolean>} */
const sponsorBlockEnableSubmission = computed(() => store.getters.getSponsorBlockEnableSubmission)

/** @type {import('vue').ComputedRef<string>} */
const sponsorBlockUserId = computed(() => store.getters.getSponsorBlockUserId)

/** @type {import('vue').ComputedRef<string>} */
const sponsorBlockGeneratedUserId = computed(() => store.getters.getSponsorBlockGeneratedUserId)

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowTitles = computed(() => store.getters.getUseDeArrowTitles)

/** @type {import('vue').ComputedRef<boolean>} */
const useDeArrowThumbnails = computed(() => store.getters.getUseDeArrowThumbnails)

/** @type {import('vue').ComputedRef<string>} */
const deArrowThumbnailGeneratorUrl = computed(() => store.getters.getDeArrowThumbnailGeneratorUrl)

/**
 * @param {boolean} value
 */
function handleUpdateSponsorBlock(value) {
  store.dispatch('updateUseSponsorBlock', value)
}

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
 * @param {boolean} value
 */
function handleUpdateSponsorBlockShowSkippedToast(value) {
  store.dispatch('updateSponsorBlockShowSkippedToast', value)
}

/**
 * @param {number} value
 */
function handleUpdateSponsorBlockSkippedToastDuration(value) {
  store.dispatch('updateSponsorBlockSkippedToastDuration', value)
}

/**
 * @param {boolean} value
 */
function handleUpdateSponsorBlockEnableSubmission(value) {
  store.dispatch('updateSponsorBlockEnableSubmission', value)
}

/**
 * @param {string} value
 */
function handleUpdateSponsorBlockUserId(value) {
  store.dispatch('updateSponsorBlockUserId', value.trim())
}

function handleShowGeneratedSponsorBlockUserId() {
  showGeneratedSponsorBlockUserId.value = true
}

function handleCopyGeneratedSponsorBlockUserId() {
  copyToClipboard(sponsorBlockGeneratedUserId.value, {
    messageOnSuccess: t('Settings.SponsorBlock Settings.Generated SponsorBlock User ID Copied')
  })
}

/**
 * @param {string} value
 */
function handleUpdateSponsorBlockUrl(value) {
  store.dispatch('updateSponsorBlockUrl', cleanupUrl(value))
}

/**
 * @param {string} value
 */
function handleUpdateDeArrowThumbnailGeneratorUrl(value) {
  store.dispatch('updateDeArrowThumbnailGeneratorUrl', cleanupUrl(value))
}

/**
 * @param {string} url
 */
function cleanupUrl(url) {
  return url
    .replace(/\/$/, '')
    .replace(/\/api$/, '')
}
</script>

<style scoped>
.sponsorBlockUserIdSection {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: min(100%, 600px);
}

.generatedUserIdContainer {
  width: 100%;
}

.generatedUserIdContainer :deep(.btn) {
  margin-inline: auto;
}

.generatedUserIdActionRow {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 5px;
  padding: 8px 0 0;
  box-sizing: border-box;
}

.generatedUserIdInfo {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.generatedUserIdLabelRow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--primary-text-color);
}

.generatedUserIdLabel {
  font-size: 0.95rem;
  font-weight: 500;
}

.generatedUserIdValue {
  overflow-wrap: anywhere;
  color: var(--primary-text-color);
  font-family: monospace;
  user-select: text;
  text-align: center;
}

.generatedUserIdValueRow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
