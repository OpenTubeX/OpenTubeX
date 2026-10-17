<template>
  <FtSettingsSection
    :title="t('Settings.AiSList Settings.AiSList Settings')"
  >
    <FtFlexBox class="settingsFlexStart500px">
      <FtToggleSwitch
        :label="t('Settings.AiSList Settings.Hide AI Slop Channels')"
        :default-value="useAiSlopList"
        setting-key="useAiSlopList"
        :tooltip="t('Settings.AiSList Settings.Hide AI Slop Channels Tooltip')"
        @change="updateUseAiSlopList"
      />
    </FtFlexBox>
    <p
      v-if="useAiSlopList && status"
      class="aiSlopListStatus"
      aria-live="polite"
    >
      {{ status }}
    </p>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'

import store from '../store/index'
import { formatShortDateTime } from '../helpers/dateFormat'
import { formatNumber } from '../helpers/utils'

const { locale, t } = useI18n()

/** @type {import('vue').ComputedRef<boolean>} */
const useAiSlopList = computed(() => store.getters.getUseAiSlopList)

const status = computed(() => {
  const fetchedAt = store.getters.getAiSlopListFetchedAt

  if (store.getters.getAiSlopListLoadFailed) {
    return t('Settings.AiSList Settings.Failed to Download')
  }

  if (fetchedAt === null) {
    return t('Settings.AiSList Settings.Downloading')
  }

  return t('Settings.AiSList Settings.Loaded Status', {
    blocked: formatNumber(store.getters.getAiSlopBlockedChannels.size),
    warned: formatNumber(store.getters.getAiSlopWarnedChannels.size),
    date: formatShortDateTime(fetchedAt, locale.value, store.getters.getDateFormat, store.getters.getTimeFormat)
  })
})

/**
 * @param {boolean} value
 */
function updateUseAiSlopList(value) {
  store.dispatch('updateUseAiSlopList', value)
}
</script>

<style scoped>
.aiSlopListStatus {
  margin: 0;
  color: var(--secondary-text-color);
  font-size: 0.9em;
  text-align: center;
}
</style>
