<template>
  <FtFlexBox>
    <FtSlider
      :label="t('Settings.Distraction Free Settings.Playing Interface Hide Delay')"
      :default-value="store.getters.getPlayingInterfaceHideDelay"
      setting-key="playingInterfaceHideDelay"
      :min-value="0.5"
      :max-value="10"
      :step="0.5"
      value-extension="s"
      @change="store.dispatch('updatePlayingInterfaceHideDelay', $event)"
    />
  </FtFlexBox>
  <h4 class="groupTitle">
    {{ t('Settings.Distraction Free Settings.Sections.Visible While Paused') }}
  </h4>
  <div class="switchColumnGrid">
    <div class="switchColumn">
      <FtToggleSwitch
        :label="t('Settings.Distraction Free Settings.Show Player Controls')"
        :compact="true"
        :default-value="showPlayerControlsWhenPaused"
        setting-key="showPlayerControlsWhenPaused"
        @change="store.dispatch('updateShowPlayerControlsWhenPaused', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.Distraction Free Settings.Show Video Title')"
        :compact="true"
        :disabled="hideFullscreenVideoTitle"
        :default-value="showVideoTitleWhenPaused && !hideFullscreenVideoTitle"
        setting-key="showVideoTitleWhenPaused"
        @change="store.dispatch('updateShowVideoTitleWhenPaused', $event)"
      />
    </div>
    <div class="switchColumn">
      <FtToggleSwitch
        :label="t('Settings.Distraction Free Settings.Show Bottom Right Actions Dock')"
        :compact="true"
        :default-value="showFullscreenActionsWhenPaused"
        setting-key="showFullscreenActionsWhenPaused"
        @change="store.dispatch('updateShowFullscreenActionsWhenPaused', $event)"
      />
    </div>
  </div>
  <FtFlexBox>
    <FtSlider
      :label="t('Settings.Distraction Free Settings.Paused Interface Hide Delay')"
      :default-value="store.getters.getPausedInterfaceHideDelay"
      setting-key="pausedInterfaceHideDelay"
      :min-value="0.5"
      :max-value="10"
      :step="0.5"
      value-extension="s"
      :disabled="pausedInterfaceVisibilityUnchanged"
      @change="store.dispatch('updatePausedInterfaceHideDelay', $event)"
    />
  </FtFlexBox>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'

const { t } = useI18n()

const showPlayerControlsWhenPaused = computed(() => store.getters.getShowPlayerControlsWhenPaused)
const showVideoTitleWhenPaused = computed(() => store.getters.getShowVideoTitleWhenPaused)
const hideFullscreenVideoTitle = computed(() => store.getters.getHideFullscreenVideoTitle)
const showFullscreenActionsWhenPaused = computed(() => store.getters.getShowFullscreenActionsWhenPaused)

// The paused delay only applies once pausing hides some of the interface.
const pausedInterfaceVisibilityUnchanged = computed(() => {
  return showPlayerControlsWhenPaused.value &&
    (showVideoTitleWhenPaused.value || hideFullscreenVideoTitle.value) &&
    showFullscreenActionsWhenPaused.value
})
</script>
