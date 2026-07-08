<template>
  <div
    class="floatingRefreshSection"
    :class="{ embedded: props.embedded }"
  >
    <p
      v-if="lastRefreshTimestamp"
      class="lastRefreshTimestamp"
    >
      {{ t('Feed.Feed Last Updated', { feedName: title, date: lastRefreshTimestamp }) }}
    </p>
    <div class="refreshActions">
      <p
        v-if="nextAutoRefreshTimestamp"
        class="lastRefreshTimestamp nextAutoRefreshTimestamp"
        :title="nextAutoRefreshTooltip"
      >
        {{ t('Feed.Next Auto Refresh', { date: nextAutoRefreshTimestamp }) }}
      </p>
      <FtIconButton
        :disabled="disableRefresh"
        :icon="['fas', 'sync']"
        class="refreshButton"
        :title="refreshFeedButtonTitle"
        :size="12"
        theme="primary"
        @click="click"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'

import { KeyboardShortcuts } from '../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../helpers/utils'

const props = defineProps({
  disableRefresh: {
    type: Boolean,
    default: false
  },
  lastRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTimestamp: {
    type: String,
    default: ''
  },
  nextAutoRefreshTooltip: {
    type: String,
    default: ''
  },
  embedded: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const refreshFeedButtonTitle = computed(() => {
  return addKeyboardShortcutToActionTitle(
    t('Feed.Refresh Feed', { subscriptionName: props.title }),
    KeyboardShortcuts.APP.SITUATIONAL.REFRESH
  )
})

const emit = defineEmits(['click'])

function click() {
  emit('click')
}
</script>

<style scoped lang="scss" src="./FtRefreshWidget.scss" />
