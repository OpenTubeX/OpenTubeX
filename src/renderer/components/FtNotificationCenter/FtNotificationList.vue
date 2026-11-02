<template>
  <ul
    v-if="entries.length > 0"
    class="notificationList"
  >
    <li
      v-for="entry in entries"
      :key="entry.id"
      class="notificationRow"
      :class="{ unread: !entry.read }"
    >
      <button
        type="button"
        class="notificationEntry"
        @click="emit('open', entry)"
      >
        <span
          v-if="entry.thumbnail && showThumbnails"
          class="notificationThumbnail"
        >
          <FtRetryImage
            :src="entry.thumbnail"
            :class="{ blur: blurThumbnails }"
            :fallback-icon="NOTIFICATION_KIND_ICONS[entry.kind]"
            loading="lazy"
            alt=""
          />
          <FtIcon
            class="thumbnailKind"
            :icon="NOTIFICATION_KIND_ICONS[entry.kind]"
            aria-hidden="true"
          />
        </span>
        <FtIcon
          v-else
          class="notificationKind"
          :icon="NOTIFICATION_KIND_ICONS[entry.kind]"
          aria-hidden="true"
        />
        <span class="notificationText">
          <strong dir="auto">{{ entry.title }}</strong>
          <span
            class="notificationBody"
            dir="auto"
          >{{ entry.body }}</span>
          <time
            :datetime="new Date(entry.createdAt).toISOString()"
            :title="new Date(entry.createdAt).toLocaleString(locale)"
          >{{ getRelativeTimeFromDate(entry.createdAt, true, true, now) }}</time>
        </span>
      </button>
      <button
        v-if="!entry.read"
        type="button"
        class="markRead"
        :aria-label="t('Notification Center.Mark as Read')"
        :title="t('Notification Center.Mark as Read')"
        @click="emit('mark-read', entry, $event)"
      >
        <FtIcon
          :icon="['fas', 'check']"
          aria-hidden="true"
        />
      </button>
    </li>
  </ul>
  <div
    v-else
    class="notificationsEmpty"
  >
    <FtIcon
      :icon="['fas', 'bell']"
      aria-hidden="true"
    />
    <strong>{{ t('Notification Center.Empty') }}</strong>
    <span>{{ t('Notification Center.Empty Hint') }}</span>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtRetryImage from '../FtRetryImage.vue'
import store from '../../store/index'

import { getRelativeTimeFromDate } from '../../helpers/utils'
import { NOTIFICATION_KIND_ICONS } from '../../helpers/notificationHistory'

defineProps({
  /** @type {import('vue').PropType<import('../../../notificationHistory').NotificationHistoryEntry[]>} */
  entries: { type: Array, required: true },
  now: { type: Number, required: true }
})
const emit = defineEmits(['open', 'mark-read'])
const { locale, t } = useI18n()
// Entries keep the thumbnails they were shown with; current settings still apply.
const showThumbnails = computed(() => store.getters.getThumbnailPreference !== 'hidden')
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)
</script>

<style scoped src="./FtNotificationList.css" />
