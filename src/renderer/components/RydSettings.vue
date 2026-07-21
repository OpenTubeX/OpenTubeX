<template>
  <FtSettingsSection
    :title="$t('Settings.Return YouTube Dislike Settings.Return YouTube Dislike Settings')"
  >
    <FtFlexBox class="settingsFlexStart500px">
      <FtToggleSwitch
        :label="$t('Settings.Return YouTube Dislike Settings.Enable Return YouTube Dislike')"
        :default-value="useReturnYoutubeDislikes"
        setting-key="useReturnYouTubeDislikes"
        @change="handleUpdateUseReturnYoutubeDislike"
      />
    </FtFlexBox>
    <FtFlexBox
      v-if="useReturnYoutubeDislikes"
    >
      <FtInput
        :placeholder="$t('Settings.Return YouTube Dislike Settings.Return YouTube Dislike Url')"
        :show-action-button="false"
        :show-label="true"
        :data-list="returnYoutubeDislikesInstances"
        :value="returnYoutubeDislikesUrl"
        setting-key="returnYouTubeDislikesUrl"
        @input="handleUpdateReturnYouTubeDislikesUrl"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'

import FtSettingsSection from './FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from './FtToggleSwitch/FtToggleSwitch.vue'
import FtInput from './FtInput/FtInput.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'

import store from '../store/index'
import { getRYDInstances } from '../helpers/returnyoutubedislike'

/** @type {import('vue').ComputedRef<boolean>} */
const useReturnYoutubeDislikes = computed(() => store.getters.getUseReturnYouTubeDislikes)

/** @type {import('vue').ComputedRef<string>} */
const returnYoutubeDislikesUrl = computed(() => store.getters.getReturnYouTubeDislikesUrl)

const returnYoutubeDislikesInstances = getRYDInstances()

/**
 * @param {boolean} value
 */
function handleUpdateUseReturnYoutubeDislike(value) {
  store.dispatch('updateUseReturnYouTubeDislikes', value)
}

/**
 * @param {string} value
 */
function handleUpdateReturnYouTubeDislikesUrl(value) {
  const cleaned = value
    .replace(/\/$/, '')
    .replace(/\/votes$/i, '')
  store.dispatch('updateReturnYouTubeDislikesUrl', cleaned)
}
</script>
