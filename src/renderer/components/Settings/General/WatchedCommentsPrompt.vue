<template>
  <FtPrompt
    :label="t('Settings.General Settings.Watched Comments')"
    theme="readable-width"
    fixed-layout
    @click="emit('close')"
  >
    <ul
      v-if="threads.length > 0"
      class="watchedComments"
    >
      <li
        v-for="thread in threads"
        :key="`${thread.videoId}/${thread.threadId}/${thread.channelId}`"
        class="watchedCommentRow"
      >
        <component
          :is="opensTabs ? RouterLink : 'button'"
          :type="opensTabs ? null : 'button'"
          :to="opensTabs ? getWatchedCommentTarget(thread) : null"
          :data-tab-title="opensTabs ? thread.videoTitle || undefined : null"
          class="watchedComment"
          @click.capture="open(thread, $event)"
        >
          <span
            v-if="showThumbnails"
            class="watchedCommentThumbnail"
          >
            <FtIcon
              v-if="isPostWatchedComment(thread)"
              class="watchedCommentPostIcon"
              :icon="NOTIFICATION_KIND_ICONS.post"
              aria-hidden="true"
            />
            <FtRetryImage
              v-else
              :src="thumbnailUrl(thread.videoId)"
              :class="{ blur: blurThumbnails }"
              loading="lazy"
              alt=""
            />
          </span>
          <span class="watchedCommentText">
            <strong
              v-if="!isOwnWatchedComment(thread) && thread.handle"
              dir="auto"
            >{{ thread.handle }}</strong>
            <span
              class="watchedCommentBody"
              dir="auto"
            >{{ thread.text || t('Settings.General Settings.Your Comment') }}</span>
            <span
              v-if="thread.videoTitle"
              class="watchedCommentVideo"
              dir="auto"
            >{{ thread.videoTitle }}</span>
            <time
              :datetime="new Date(thread.postedAt).toISOString()"
              :title="new Date(thread.postedAt).toLocaleString(locale)"
            >{{ getRelativeTimeFromDate(thread.postedAt, true, true, now) }}</time>
          </span>
        </component>
        <button
          type="button"
          class="stopWatching"
          :aria-label="t('Settings.General Settings.Stop Watching')"
          :title="t('Settings.General Settings.Stop Watching')"
          @click="stopWatching(thread)"
        >
          <FtIcon
            :icon="['fas', 'bell-slash']"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
    <div
      v-else-if="loaded"
      class="watchedCommentsEmpty"
    >
      <FtIcon
        :icon="['fas', 'comment']"
        aria-hidden="true"
      />
      <span>{{ t('Settings.General Settings.No Watched Comments') }}</span>
    </div>

    <template #footer>
      <FtFlexBox>
        <FtButton
          :label="t('Close')"
          :icon="['fas', 'xmark']"
          @click="emit('close')"
        />
      </FtFlexBox>
    </template>
  </FtPrompt>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import FtButton from '../../FtButton/FtButton.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import FtPrompt from '../../FtPrompt/FtPrompt.vue'
import FtRetryImage from '../../FtRetryImage.vue'

import store from '../../../store/index'
import { getWatchedComments, unwatchComment, watchedComments } from '../../../helpers/commentReplyNotifications'
import { NOTIFICATION_KIND_ICONS } from '../../../helpers/notificationHistory'
import { getRelativeTimeFromDate, getVideoThumbnailUrl, openInternalPath } from '../../../helpers/utils'
import { getWatchedCommentTarget, isOwnWatchedComment, isPostWatchedComment } from '../../../../commentReplyTracking.js'

const emit = defineEmits(['close'])
const { locale, t } = useI18n()

// The desktop app opens middle clicks on internal links in background tabs,
// which leave this list open.
const opensTabs = !!process.env.IS_ELECTRON

const loaded = ref(false)
const now = Date.now()

// Listed by when they were watched, which each shows, rather than by activity.
const threads = computed(() => watchedComments.value.toSorted((left, right) => right.postedAt - left.postedAt))
const showThumbnails = computed(() => store.getters.getThumbnailPreference !== 'hidden')
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

onMounted(async () => {
  try {
    await getWatchedComments()
  } catch (error) {
    console.error('Failed to list the watched comments', error)
  }
  loaded.value = true
})

/** @param {string} videoId */
function thumbnailUrl(videoId) {
  // Some videos lack the default maximum resolution image; the medium one fits the list.
  return getVideoThumbnailUrl(videoId, store.getters.getBackendPreference,
    store.getters.getCurrentInvidiousInstanceUrl, store.getters.getThumbnailPreference)
    ?.replace(/\/maxresdefault\.jpg$/, '/mqdefault.jpg') ?? ''
}

/** @param {import('../../../../commentReplyTracking.js').TrackedCommentThread} thread */
function stopWatching(thread) {
  // Saved on this device, so this fails only when storage does.
  unwatchComment(thread).catch(error => console.error('Failed to stop watching a comment', error))
}

/**
 * Opens Ctrl or Cmd clicks in a new tab here, not through the app's link
 * shortcuts, so they close the settings window like plain clicks. Middle
 * clicks go through those shortcuts and leave the list open.
 * @param {import('../../../../commentReplyTracking.js').TrackedCommentThread} thread
 * @param {MouseEvent} event
 */
function open(thread, event) {
  event.preventDefault()
  const ctrlOrCmdPressed = process.platform === 'darwin' ? event.metaKey : event.ctrlKey
  const opensElsewhere = opensTabs && ctrlOrCmdPressed && !event.altKey
  const doCreateNewWindow = opensElsewhere && event.shiftKey
  // A new window leaves this one's settings open.
  if (!doCreateNewWindow) {
    emit('close')
    store.dispatch('hideSettingsWindow')
  }
  openInternalPath({
    ...getWatchedCommentTarget(thread),
    title: thread.videoTitle || undefined,
    doCreateNewWindow,
    doCreateNewTab: opensElsewhere && !event.shiftKey
  })
}
</script>

<style scoped>
.watchedComments {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.watchedCommentRow {
  display: flex;
  align-items: flex-start;
  border-radius: var(--shape-corner-medium);
}

/* Highlight the whole row, including the button beside the entry. */
.watchedCommentRow:hover,
.watchedCommentRow:has(.watchedComment:focus-visible) {
  background-color: var(--side-nav-hover-color);
  color: var(--side-nav-hover-text-color);
}

.watchedComment {
  display: flex;
  flex: 1;
  align-items: flex-start;
  gap: 12px;
  min-inline-size: 0;
  padding: 10px;
  border: 0;
  border-radius: var(--shape-corner-medium);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.4;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.watchedComment:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

.watchedCommentThumbnail {
  flex-shrink: 0;
  inline-size: 112px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--shape-corner-small);
  background-color: var(--side-nav-color);
}

.watchedCommentThumbnail:has(.watchedCommentPostIcon) {
  display: grid;
  place-items: center;
}

.watchedCommentPostIcon {
  font-size: 1.5em;
  opacity: 0.7;
}

.watchedCommentThumbnail :deep(img) {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.watchedCommentThumbnail :deep(.blur) {
  filter: blur(20px) var(--content-filter,);
}

.watchedCommentText {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.watchedCommentBody {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: pre-line;
}

.watchedCommentVideo {
  overflow: hidden;
  color: var(--secondary-text-color);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watchedCommentText time {
  color: var(--secondary-text-color);
  font-size: 12px;
}

.stopWatching {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  inline-size: 36px;
  block-size: 36px;
  margin-block-start: 6px;
  margin-inline-end: 4px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--secondary-text-color);
  font-size: 16px;
  cursor: pointer;
}

/* Translucent so it stands out on the row's hover background. */
.stopWatching:hover,
.stopWatching:focus-visible {
  background-color: color-mix(in srgb, currentcolor 12%, transparent);
}

/* Secondary text can match the hover background, as in Hot Pink. */
.watchedCommentRow:is(:hover, :has(.watchedComment:focus-visible)) :is(.watchedCommentVideo, time, .stopWatching) {
  color: inherit;
}

.watchedCommentsEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-block: 24px;
  padding-inline: 16px;
  color: var(--secondary-text-color);
  text-align: center;
}

.watchedCommentsEmpty .ft-icon {
  font-size: 28px;
  opacity: 0.6;
}
</style>
