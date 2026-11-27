<template>
  <FtSettingsSection
    :title="t('Comments.Comments')"
    :icon="['fas', 'comment']"
  >
    <div class="settingsRows">
      <FtSettingsRow
        :description="t('Settings.General Settings.Auto Load Comments.Tooltip')"
        :title="t('Settings.General Settings.Auto Load Comments.Label')"
        :icon="['fas', 'comment']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Auto Load Comments.Label')"
          hide-label
          :default-value="store.getters.getAutoLoadComments"
          setting-key="autoLoadComments"
          @change="store.dispatch('updateAutoLoadComments', $event)"
        />
      </FtSettingsRow>
      <FtSettingsRow
        v-if="canNotifyReplies"
        :tooltip="t('Tooltips.General Settings.Reply Notifications')"
        :title="t('Settings.General Settings.Reply Notifications')"
        :icon="['fas', 'bell']"
      >
        <FtToggleSwitch
          :label="t('Settings.General Settings.Reply Notifications')"
          hide-label
          :default-value="store.getters.getCommentReplyNotifications"
          setting-key="commentReplyNotifications"
          @change="updateReplyNotifications"
        />
      </FtSettingsRow>
    </div>
    <FtFlexBox v-if="canNotifyReplies && store.getters.getCommentReplyNotifications">
      <FtButton
        :label="t('Settings.General Settings.Watched Comments')"
        :icon="['fas', 'bell']"
        @click="watchedCommentsOpen = true"
      />
    </FtFlexBox>
    <WatchedCommentsPrompt
      v-if="watchedCommentsOpen"
      @close="watchedCommentsOpen = false"
    />
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtSettingsRow from '../../FtSettingsRow/FtSettingsRow.vue'
import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'
import WatchedCommentsPrompt from './WatchedCommentsPrompt.vue'

import { supportsNotificationHistory } from '../../../helpers/notificationHistory'
import { requestCapacitorNotificationPermission } from '../../../helpers/platformFeed'
import store from '../../../store/index'

const { t } = useI18n()
const watchedCommentsOpen = ref(false)
const canNotifyReplies = computed(() => supportsNotificationHistory && store.getters.getNotificationMode !== 'off')

/** @param {boolean} value */
function updateReplyNotifications(value) {
  store.dispatch('updateCommentReplyNotifications', value)
  if (process.env.IS_CAPACITOR && value) requestCapacitorNotificationPermission()
}
</script>
