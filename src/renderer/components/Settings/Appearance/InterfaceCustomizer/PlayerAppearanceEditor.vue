<template>
  <div class="playerAppearanceEditor">
    <section
      v-for="group in groups"
      :key="group.id"
      class="settingGroup"
    >
      <h3>{{ group.label }}</h3>
      <FtToggleSwitch
        v-for="setting in group.settings"
        :key="setting.key"
        :label="setting.label"
        :tooltip="setting.tooltip"
        :default-value="store.state.settings[setting.key]"
        :setting-key="setting.key"
        compact
        @change="store.dispatch(setting.action, $event)"
      />
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtToggleSwitch from '../../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../../store/index'

const { t } = useI18n()

const groups = computed(() => [
  {
    id: 'controls',
    label: t('Settings.Interface Customizer.Controls'),
    settings: [
      !process.env.IS_CAPACITOR && {
        key: 'displayVideoPlayButton',
        action: 'updateDisplayVideoPlayButton',
        label: t('Settings.Player Settings.Display Play Button In Video Player'),
      },
      {
        key: 'useQuickPlaybackSpeedBar',
        action: 'updateUseQuickPlaybackSpeedBar',
        label: t('Settings.Player Settings.Use Quick Playback Speed Bar'),
        tooltip: t('Tooltips.Player Settings.Use Quick Playback Speed Bar'),
      },
    ],
  },
  {
    id: 'paused',
    label: t('Settings.Distraction Free Settings.Sections.Visible While Paused'),
    settings: [
      {
        key: 'showPlayerControlsWhenPaused',
        action: 'updateShowPlayerControlsWhenPaused',
        label: t('Settings.Distraction Free Settings.Show Player Controls'),
      },
      {
        key: 'showVideoTitleWhenPaused',
        action: 'updateShowVideoTitleWhenPaused',
        label: t('Settings.Distraction Free Settings.Show Video Title'),
      },
      {
        key: 'showFullscreenActionsWhenPaused',
        action: 'updateShowFullscreenActionsWhenPaused',
        label: t('Settings.Distraction Free Settings.Show Bottom Right Actions Dock'),
      },
    ],
  },
].map(group => ({ ...group, settings: group.settings.filter(Boolean) })))

</script>

<style scoped>
.playerAppearanceEditor {
  display: grid;
  gap: 20px;
  margin-inline: auto;
  max-inline-size: 720px;
}

.settingGroup {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settingGroup h3 {
  color: var(--secondary-text-color);
  font-size: 14px;
  font-weight: 600;
  margin-block: 0 4px;
  text-transform: uppercase;
}

.settingGroup :deep(.switch-ctn) {
  margin-block: 0;
}
</style>
