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
        @pointerdown="startSwipe(entry, $event)"
        @pointermove="moveSwipe"
        @pointerup="finishSwipe"
        @pointercancel="cancelSwipe"
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
              :title="entry.body"
              data-title-tooltip-truncated
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
 * Touch swipes dismiss a notification sideways, like the system's do. Vertical
 * movement keeps scrolling the list.
 * @type {{ entry: import('../../../notificationHistory').NotificationHistoryEntry, id: number, x: number, y: number, time: number, offset: number, velocity: number, locked: boolean } | null}
 */
let swipe = null
/**
 * The row whose swipe just ended. The released finger can still click the
 * entry or button under it, so the row drops its next click, until the next press.
 * @type {HTMLElement | null}
 */
let swipedRow = null

/**
 * @param {import('../../../notificationHistory').NotificationHistoryEntry} entry
 * @param {PointerEvent} event
 */
function startSwipe(entry, event) {
  swipedRow?.removeEventListener('click', suppressSwipeClick, true)
  swipedRow = null
  // A new primary pointer replaces a swipe that lost its row, as when the
  // entry was removed elsewhere during it.
  if (event.pointerType !== 'touch' || !event.isPrimary) return
  swipe = { entry, id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp, offset: 0, velocity: 0, locked: false }
}

/** @param {PointerEvent} event */
function moveSwipe(event) {
  if (swipe?.id !== event.pointerId) return
  const row = /** @type {HTMLElement} */ (event.currentTarget)
  const offset = event.clientX - swipe.x
  if (!swipe.locked) {
    const vertical = Math.abs(event.clientY - swipe.y)
    if (vertical > 10 && vertical >= Math.abs(offset)) {
      swipe = null
      return
    }
    if (Math.abs(offset) < 10) return
    swipe.locked = true
    row.setPointerCapture(event.pointerId)
    row.dataset.swipe = 'dragging'
  }
  // Flicks dismiss by the speed of the last movement.
  swipe.velocity = (offset - swipe.offset) / Math.max(1, event.timeStamp - swipe.time)
  swipe.time = event.timeStamp
  swipe.offset = offset
  row.style.translate = `${offset}px 0`
  row.style.opacity = String(Math.max(0.2, 1 - Math.abs(offset) / row.offsetWidth))
}

/** @param {PointerEvent} event */
function finishSwipe(event) {
  if (swipe?.id !== event.pointerId) return
  const { entry, locked, offset, velocity, time } = swipe
  swipe = null
  if (!locked) return
  const row = /** @type {HTMLElement} */ (event.currentTarget)
  swipedRow = row
  row.addEventListener('click', suppressSwipeClick, true)
  // A finger held still before release is no longer flicking.
  const flicked = event.timeStamp - time < 100 && Math.abs(offset) > 24 &&
    Math.abs(velocity) > 0.5 && Math.sign(velocity) === Math.sign(offset)
  if (Math.abs(offset) > row.offsetWidth * 0.35 || flicked) {
    // The row leaves from where the finger released it, in the swiped direction.
    row.style.setProperty('--dismiss-direction', String(Math.sign(offset)))
    delete row.dataset.swipe
    emit('remove', entry, event)
  } else {
    settle(row)
  }
}

/** @param {PointerEvent} event */
function cancelSwipe(event) {
  if (swipe?.id !== event.pointerId) return
  const { locked } = swipe
  swipe = null
  if (locked) settle(/** @type {HTMLElement} */ (event.currentTarget))
}

/** @param {HTMLElement} row */
function settle(row) {
  row.dataset.swipe = 'settling'
  row.style.translate = ''
  row.style.opacity = ''
  row.addEventListener('transitionend', () => { if (row.dataset.swipe === 'settling') delete row.dataset.swipe }, { once: true })
}

/** @param {MouseEvent} event */
function suppressSwipeClick(event) {
  event.currentTarget.removeEventListener('click', suppressSwipeClick, true)
  swipedRow = null
  event.preventDefault()
  event.stopPropagation()
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
