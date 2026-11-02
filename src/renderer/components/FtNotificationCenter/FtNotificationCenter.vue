<template>
  <FtIconButton
    ref="button"
    class="notificationCenter"
    :data-unread-count="unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : null"
    :title="buttonLabel"
    :icon="['fas', 'bell']"
    :theme="null"
    :size="20"
    force-dropdown
    mobile-sheet
    dropdown-portal
    dropdown-position-x="left"
    dropdown-class="notificationCenterDropdown"
    @dropdown-open="handleOpen"
  >
    <template #dropdown-header>
      <header class="notificationCenterHeader">
        <h2>{{ t('Notification Center.Notifications') }}</h2>
        <div class="notificationActions">
          <button
            v-for="action in headerActions"
            :key="action.label"
            type="button"
            :aria-label="action.label"
            :title="action.label"
            @click="action.run"
          >
            <FtIcon
              :icon="action.icon"
              aria-hidden="true"
            />
          </button>
        </div>
      </header>
    </template>
    <FtMobileSheet
      v-if="phoneLayout"
      :open="sheetOpen"
      :title="t('Notification Center.Notifications')"
      @close="sheetOpen = false"
      @closed="button?.hideDropdown()"
    >
      <template #actions>
        <button
          v-for="action in headerActions"
          :key="action.label"
          type="button"
          :aria-label="action.label"
          @click="action.run"
        >
          <FtIcon
            :icon="action.icon"
            aria-hidden="true"
          />
        </button>
      </template>
      <div
        ref="sheetScroller"
        v-overlay-scrollbars
        class="notificationSheetScroller"
      >
        <div ref="sheetContent">
          <FtNotificationList
            :entries="entries"
            :now="openedAt"
            @open="openEntry"
            @mark-read="markRead"
          />
        </div>
      </div>
    </FtMobileSheet>
    <FtNotificationList
      v-else
      :entries="entries"
      :now="openedAt"
      @open="openEntry"
      @mark-read="markRead"
    />
  </FtIconButton>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtMobileSheet from '../FtMobileSheet/FtMobileSheet.vue'
import FtNotificationList from './FtNotificationList.vue'

import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useScrollClamp } from '../../composables/useScrollClamp'
import {
  collectNotificationHistory,
  notificationHistory,
  openNotificationEntry,
  showInAppNotification
} from '../../helpers/notificationHistory'

const { t } = useI18n()
const phoneLayout = usePhoneLayout()
const button = useTemplateRef('button')
useScrollClamp(useTemplateRef('sheetScroller'), useTemplateRef('sheetContent'))

/** @type {import('vue').ShallowRef<import('../../../notificationHistory').NotificationHistoryEntry[]>} */
const entries = shallowRef([])
const openedAt = ref(Date.now())
const sheetOpen = ref(true)

const unreadCount = computed(() => entries.value.filter(entry => !entry.read).length)
const buttonLabel = computed(() => unreadCount.value > 0
  ? t('Notification Center.Notifications With Unread', { count: unreadCount.value })
  : t('Notification Center.Notifications'))

const headerActions = computed(() => [
  unreadCount.value > 0 && {
    label: t('Notification Center.Mark All as Read'),
    icon: ['fas', 'check-double'],
    run: event => markRead(null, event)
  },
  entries.value.length > 0 && {
    label: t('Notification Center.Clear All'),
    icon: ['fas', 'trash'],
    run: clear
  }
].filter(Boolean))

/**
 * Buttons disappear once their action is done. Keeping focus inside keeps the dropdown open.
 * @param {MouseEvent} event
 */
function keepFocus(event) {
  event.currentTarget.closest('.iconDropdown, .mobileSheet')?.focus()
}

async function handleOpen() {
  sheetOpen.value = true
  openedAt.value = Date.now()
  await collectNotificationHistory()
}

/**
 * @param {import('../../../notificationHistory').NotificationHistoryEntry | null} entry Null marks every entry read.
 * @param {MouseEvent} event
 */
function markRead(entry, event) {
  keepFocus(event)
  notificationHistory.markRead(entry?.id)
}

/** @param {MouseEvent} event */
function clear(event) {
  keepFocus(event)
  notificationHistory.clear()
}

/** @param {import('../../../notificationHistory').NotificationHistoryEntry} entry */
function openEntry(entry) {
  button.value?.hideDropdown()
  openNotificationEntry(entry)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') collectNotificationHistory()
}

let removeListener = null
let removeInAppListener = null
onMounted(async () => {
  let updated = false
  removeListener = notificationHistory.onUpdated(value => {
    updated = true
    entries.value = value
  })
  if (process.env.IS_ELECTRON) removeInAppListener = window.ftElectron.notificationHistory.onShowInApp(showInAppNotification)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  await collectNotificationHistory()
  const initial = await notificationHistory.list()
  if (!updated) entries.value = initial
})
onBeforeUnmount(() => {
  removeListener?.()
  removeInAppListener?.()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<style scoped src="./FtNotificationCenter.css" />
<style src="./FtNotificationCenterDropdown.css" />
