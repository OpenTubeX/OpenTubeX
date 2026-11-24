<template>
  <FtSettingsSection
    :title="t('Settings.Player Settings.yt-dlp Streaming')"
    :icon="['fas', 'terminal']"
  >
    <FtFlexBox>
      <FtToggleSwitch
        :label="t('Settings.Player Settings.Ask Before Preloading Large Playlists')"
        compact
        :default-value="confirmLargePlaylistPreload"
        setting-key="confirmLargePlaylistPreload"
        :tooltip="t('Tooltips.Player Settings.Ask Before Preloading Large Playlists', { count: PLAYLIST_PRELOAD_CONFIRM_THRESHOLD })"
        @change="store.dispatch('updateConfirmLargePlaylistPreload', $event)"
      />
    </FtFlexBox>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Player Settings.Parallel Segment Loading')"
        :default-value="segmentPrefetchLimit"
        setting-key="segmentPrefetchLimit"
        :min-value="DEFAULT_SEGMENT_PREFETCH_LIMIT"
        :max-value="MAX_SEGMENT_PREFETCH_LIMIT"
        :step="1"
        :tooltip="t('Tooltips.Player Settings.Parallel Segment Loading')"
        @change="updateSegmentPrefetchLimit"
      />
      <FtSlider
        :label="t('Settings.Player Settings.Upcoming Videos to Preload')"
        :default-value="ytDlpPreloadCount"
        setting-key="ytDlpPreloadCount"
        :min-value="0"
        :max-value="MAX_YT_DLP_PRELOAD_COUNT"
        :step="1"
        :min-value-label="t('Global.Off')"
        :tooltip="t('Tooltips.Player Settings.Upcoming Videos to Preload')"
        @change="updateYtDlpPreloadCount"
      />
    </FtSliderGrid>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSliderGrid from '../../FtSliderGrid/FtSliderGrid.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { PLAYLIST_PRELOAD_CONFIRM_THRESHOLD } from '../../../../constants'
import {
  DEFAULT_SEGMENT_PREFETCH_LIMIT,
  MAX_SEGMENT_PREFETCH_LIMIT,
} from '../../../helpers/player/segmentPrefetch'
import { MAX_YT_DLP_PRELOAD_COUNT } from '../../../helpers/player/ytDlpPlaybackPreload'

const { t } = useI18n()

const segmentPrefetchLimit = computed(() => store.getters.getSegmentPrefetchLimit)
const confirmLargePlaylistPreload = computed(() => store.getters.getConfirmLargePlaylistPreload)
const ytDlpPreloadCount = computed(() => store.getters.getYtDlpPreloadCount)

function updateSegmentPrefetchLimit(value) {
  store.dispatch('updateSegmentPrefetchLimit', value)
}

function updateYtDlpPreloadCount(value) {
  store.dispatch('updateYtDlpPreloadCount', value)
}
</script>
