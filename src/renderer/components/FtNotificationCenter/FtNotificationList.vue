<template>
  <Transition
    name="notificationList"
    mode="out-in"
    @enter="finishTransition"
    @before-leave="makeInert"
    @leave="finishTransition"
  >
    <TransitionGroup
      v-if="entries.length > 0"
      tag="ul"
      name="notificationRow"
      class="notificationList"
      @before-leave="makeInert"
      @leave="finishTransition"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="notificationRow"
        :class="{ unread: !entry.read }"
      >
        <component
          :is="opensTab(entry) ? RouterLink : 'button'"
          :type="opensTab(entry) ? null : 'button'"
          :to="opensTab(entry) ? { path: entry.path, query: entry.query } : null"
          :data-tab-title="opensTab(entry) ? getNotificationTabTitle(entry) : null"
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
              sizes="112px"
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
    </TransitionGroup>
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
  </Transition>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import FtRetryImage from '../FtRetryImage.vue'
import store from '../../store/index'

import { finishTransition } from '../../helpers/animationSpeed'
import { getRelativeTimeFromDate, openInternalPath } from '../../helpers/utils'
import { getNotificationTabTitle, NOTIFICATION_KIND_ICONS } from '../../helpers/notificationHistory'
import { VIEW_NOTIFICATION_PATHS } from '../../../notificationHistory'

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

/**
 * The desktop app opens middle clicks on internal links in background tabs.
 * Entries that lead to a view of the app, like the downloads, have no page to open.
 * @param {import('../../../notificationHistory').NotificationHistoryEntry} entry
 */
function opensTab(entry) {
  return !!process.env.IS_ELECTRON && !VIEW_NOTIFICATION_PATHS.includes(entry.path)
}

/**
 * Keeps dismissed notifications out of reach while they animate away.
 * @param {HTMLElement} element
 */
function makeInert(element) {
  element.inert = true
}

/**
 * Opens Ctrl or Cmd clicks in a new tab, like the app's link shortcuts, which
 * never see clicks inside the dropdown.
 * @param {import('../../../notificationHistory').NotificationHistoryEntry} entry
 * @param {MouseEvent} event
 */
function handleClick(entry, event) {
  const ctrlOrCmdPressed = process.platform === 'darwin' ? event.metaKey : event.ctrlKey
  if (opensTab(entry) && ctrlOrCmdPressed && !event.altKey) {
    event.preventDefault()
    // Like plain clicks, but a new window leaves this one's settings open.
    if (!event.shiftKey) store.dispatch('hideSettingsWindow')
    openInternalPath({ path: entry.path, query: entry.query, title: getNotificationTabTitle(entry), doCreateNewWindow: event.shiftKey, doCreateNewTab: !event.shiftKey })
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
  if (opensTab(entry) && event.button === 1) emit('opened-in-tab', entry, event)
}
</script>

<style scoped src="./FtNotificationList.css" />
