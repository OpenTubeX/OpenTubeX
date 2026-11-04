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
      <component
        :is="opensTabs ? RouterLink : 'button'"
        :type="opensTabs ? null : 'button'"
        :to="opensTabs ? { path: entry.path, query: entry.query } : null"
        class="notificationEntry"
        @click.capture="handleClick(entry, $event)"
        @auxclick="handleAuxClick(entry, $event)"
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
      </component>
      <button
        v-if="!entry.read"
        type="button"
        class="entryAction"
        :aria-label="t('Notification Center.Mark as Read')"
        :title="t('Notification Center.Mark as Read')"
        @click="emit('mark-read', entry, $event)"
      >
        <FtIcon
          :icon="['fas', 'check']"
          aria-hidden="true"
        />
      </button>
      <button
        v-else
        type="button"
        class="entryAction"
        :aria-label="t('Notification Center.Clear')"
        :title="t('Notification Center.Clear')"
        @click="emit('remove', entry, $event)"
      >
        <FtIcon
          :icon="['fas', 'xmark']"
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
      :icon="['fas', 'bell-outline']"
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
import { RouterLink } from 'vue-router'

import FtRetryImage from '../FtRetryImage.vue'
import store from '../../store/index'

import { getRelativeTimeFromDate, openInternalPath } from '../../helpers/utils'
import { NOTIFICATION_KIND_ICONS } from '../../helpers/notificationHistory'

defineProps({
  /** @type {import('vue').PropType<import('../../../notificationHistory').NotificationHistoryEntry[]>} */
  entries: { type: Array, required: true },
  now: { type: Number, required: true }
})
const emit = defineEmits(['open', 'opened-in-tab', 'mark-read', 'remove'])
const { locale, t } = useI18n()
// Entries keep the thumbnails they were shown with; current settings still apply.
const showThumbnails = computed(() => store.getters.getThumbnailPreference !== 'hidden')
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

// The desktop app opens middle clicks on internal links in background tabs.
const opensTabs = !!process.env.IS_ELECTRON

/**
 * Opens Ctrl or Cmd clicks in a new tab, like the app's link shortcuts, which
 * never see clicks inside the dropdown.
 * @param {import('../../../notificationHistory').NotificationHistoryEntry} entry
 * @param {MouseEvent} event
 */
function handleClick(entry, event) {
  const ctrlOrCmdPressed = process.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (opensTabs && ctrlOrCmdPressed && !event.altKey) {
    event.preventDefault()
    // Like plain clicks, but a new window leaves this one's settings open.
    if (!event.shiftKey) store.dispatch('hideSettingsWindow')
    openInternalPath({ path: entry.path, query: entry.query, doCreateNewWindow: event.shiftKey, doCreateNewTab: !event.shiftKey })
    emit('opened-in-tab', entry, event)
    return
  }
  event.preventDefault()
  emit('open', entry)
}

/**
 * @param {import('../../../notificationHistory').NotificationHistoryEntry} entry
 * @param {MouseEvent} event
 */
function handleAuxClick(entry, event) {
  if (opensTabs && event.button === 1) emit('opened-in-tab', entry, event)
}
</script>

<style scoped src="./FtNotificationList.css" />
