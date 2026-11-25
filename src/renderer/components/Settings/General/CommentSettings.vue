<template>
  <FtSettingsSection
    :title="t('Comments.Comments')"
    :icon="['fas', 'comment']"
  >
    <div class="commentSettings">
      <!-- Side by side when there is room, like the general switches. -->
      <div class="commentSwitches switchColumnGrid">
        <div class="switchColumn">
          <FtToggleSwitch
            :label="t('Settings.General Settings.Auto Load Comments.Label')"
            :default-value="store.getters.getAutoLoadComments"
            setting-key="autoLoadComments"
            :compact="true"
            :tooltip="t('Settings.General Settings.Auto Load Comments.Tooltip')"
            @change="store.dispatch('updateAutoLoadComments', $event)"
          />
        </div>
        <div
          v-if="canNotifyReplies"
          class="switchColumn"
        >
          <FtToggleSwitch
            :label="t('Settings.General Settings.Reply Notifications')"
            :default-value="store.getters.getCommentReplyNotifications"
            setting-key="commentReplyNotifications"
            :compact="true"
            :tooltip="t('Tooltips.General Settings.Reply Notifications')"
            @change="updateReplyNotifications"
          />
        </div>
      </div>
      <FtButton
        v-if="canNotifyReplies && store.getters.getCommentReplyNotifications"
        :label="t('Settings.General Settings.Watched Comments')"
        :icon="['fas', 'bell']"
        @click="watchedCommentsOpen = true"
      />
    </div>
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

<style scoped src="./CommentSettings.css" />
