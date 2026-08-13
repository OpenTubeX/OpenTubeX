<template>
  <FtCard
    class="card"
    :class="{ fullscreenCommentCard: fullscreenOverlay }"
  >
    <header
      v-if="fullscreenOverlay"
      class="fullscreenCommentHeader"
    >
      <h3>
        <FontAwesomeIcon :icon="['fas', 'comment']" />
        {{ commentsTitle }}
      </h3>
      <div
        class="fullscreenCommentActions"
        @focusout="handleFullscreenActionsFocusout"
        @keydown.esc.stop.prevent="sortMenuOpen = false"
      >
        <button
          v-if="showSortBy && !commentsDisabled"
          type="button"
          class="fullscreenCommentAction"
          :class="{ active: sortMenuOpen }"
          :aria-label="$t('Global.Sort By')"
          :title="$t('Global.Sort By')"
          :aria-expanded="String(sortMenuOpen)"
          @click="sortMenuOpen = !sortMenuOpen"
        >
          <FontAwesomeIcon :icon="['fas', 'arrow-down-short-wide']" />
        </button>
        <button
          v-if="!commentsDisabled"
          type="button"
          class="fullscreenCommentAction"
          :aria-label="$t('Comments.Reload Comments')"
          :title="$t('Comments.Reload Comments')"
          @click="reloadCommentData"
        >
          <FontAwesomeIcon :icon="['fas', 'sync']" />
        </button>
        <button
          type="button"
          class="fullscreenCommentAction"
          :aria-label="$t('Comments.Hide Comments')"
          :title="$t('Comments.Hide Comments')"
          @click="emit('close-comments')"
        >
          <FontAwesomeIcon :icon="['fas', 'xmark']" />
        </button>
        <div
          v-if="sortMenuOpen"
          class="fullscreenSortMenu"
        >
          <button
            v-for="(name, index) in sortNames"
            :key="sortValues[index]"
            type="button"
            :class="{ selected: currentSortValue === sortValues[index] }"
            @click="handleSortChange(sortValues[index])"
          >
            <span>{{ name }}</span>
            <FontAwesomeIcon
              v-if="currentSortValue === sortValues[index]"
              :icon="['fas', 'check']"
            />
          </button>
        </div>
      </div>
    </header>
    <div
      ref="commentsContentWrapper"
      v-overlay-scrollbars
      class="commentsContentWrapper"
    >
      <div
        v-if="!fullscreenOverlay && showComments && !isLoading && commentData.length > 0"
        class="commentHeader"
      >
        <h3
          v-if="commentData.length > 0"
          class="commentsTitle"
        >
          <span>{{ commentsTitle }}</span>
          <span
            class="commentTitleAction"
            role="button"
            tabindex="0"
            @click="showComments = false"
            @keydown.space.prevent="showComments = false"
            @keydown.enter.prevent="showComments = false"
          >
            {{ $t("Comments.Hide Comments") }}
          </span>
        </h3>
        <div
          class="commentHeaderActions"
          :class="{ commentHeaderActionsEmpty: !showSortBy }"
        >
          <FtSelect
            v-if="showSortBy"
            :placeholder="$t('Global.Sort By')"
            :value="currentSortValue"
            :select-names="sortNames"
            :select-values="sortValues"
            :icon="['fas', 'arrow-down-short-wide']"
            @change="handleSortChange"
          />
          <FtIconButton
            :title="$t('Comments.Reload Comments')"
            :icon="['fas', 'sync']"
            :size="12"
            :padding="8"
            :use-shadow="false"
            class="reloadComments"
            :class="{ reloadCommentsAligned: showSortBy }"
            @click="reloadCommentData"
          />
        </div>
      </div>
      <h4
        v-if="canPerformInitialCommentLoading"
        class="getCommentsTitle"
        role="button"
        tabindex="0"
        @click="getCommentData"
        @keydown.space.prevent="getCommentData"
        @keydown.enter.prevent="getCommentData"
      >
        {{ $t("Comments.Click to View Comments") }}
      </h4>
      <h4
        v-if="commentData.length > 0 && !isLoading && !showComments"
        class="getCommentsTitle"
        role="button"
        tabindex="0"
        @click="showComments = true"
        @keydown.space.prevent="showComments = true"
        @keydown.enter.prevent="showComments = true"
      >
        {{ $t("Comments.Click to View Comments") }}
      </h4>
      <div
        v-if="commentData.length > 0 && showComments"
      >
        <div
          v-for="(comment, index) in commentData"
          :id="'comment' + index"
          :key="comment.id"
          class="comment commentThread"
          :class="{
            commentThreadExpanded: comment.showReplies,
            commentThreadCollapsed: comment.numReplies > 0 && !comment.showReplies,
            highlightedComment: comment.id === highlightedCommentId
          }"
        >
          <p
            v-if="comment.id === highlightedCommentId"
            class="highlightedCommentBadge"
          >
            {{ $t('Comments.Highlighted comment') }}
          </p>
          <component
            :is="enableChannelLinks ? 'router-link' : 'div'"
            :to="`/channel/${comment.authorLink}`"
            tabindex="-1"
          >
            <!-- Hide comment photo only if it isn't the video uploader -->
            <div
              v-if="!comment.authorThumb || (hideCommentPhotos && !comment.isOwner)"
              class="commentThumbnailHidden"
              dir="auto"
            >
              {{ comment.author.substring(1, 2) }}
            </div>
            <FtRetryImage
              v-else
              :src="comment.authorThumb"
              class="commentThumbnail"
            />
          </component>
          <p
            v-if="comment.isPinned"
            class="commentPinned"
          >
            <FontAwesomeIcon
              :icon="['fas', 'thumbtack']"
            />
            {{ $t("Comments.Pinned by") }} <bdi>{{ channelName }}</bdi>
          </p>
          <p
            class="commentAuthorWrapper"
          >
            <component
              :is="enableChannelLinks ? 'router-link' : 'span'"
              class="commentAuthor"
              dir="auto"
              :class="{
                commentOwner: comment.isOwner
              }"
              :to="`/channel/${comment.authorLink}`"
            >
              {{ comment.author }}
            </component>
            <img
              v-if="comment.isMember"
              :src="comment.memberIconUrl"
              :title="$t('Comments.Member')"
              :aria-label="$t('Comments.Member')"
              class="commentMemberIcon"
              alt=""
            >
            <img
              v-if="isSubscribedToChannel(comment.authorId)"
              :title="$t('Comments.Subscribed')"
              :aria-label="$t('Comments.Subscribed')"
              class="commentSubscribedIcon"
              alt=""
            >
            <span class="commentDate">
              {{ formatCommentTime(comment) }}
              <template v-if="comment.isEdited">
                {{ $t("Comments.Edited") }}
              </template>
            </span>
            <button
              type="button"
              class="commentCopyLink"
              :title="$t('Comments.Copy YouTube Link')"
              :aria-label="$t('Comments.Copy YouTube Link')"
              @click="copyCommentYoutubeLink(comment.id)"
            >
              <FontAwesomeIcon
                :icon="['fas', 'link']"
              />
            </button>
          </p>
          <FtTimestampCatcher
            class="commentText"
            :input-html="comment.text"
            @timestamp-event="onTimestamp"
          />
          <p class="commentLikeCount">
            <template
              v-if="!hideCommentLikes"
            >
              <FontAwesomeIcon
                :icon="['fas', 'thumbs-up']"
              />
              {{ comment.likes }}
            </template>
            <span
              v-if="comment.isHearted"
              class="commentHeartBadge"
            >
              <img
                :src="channelThumbnail"
                :title="$t('Comments.Hearted')"
                :aria-label="$t('Comments.Hearted')"
                class="commentHeartBadgeImg"
                alt=""
              >
              <FontAwesomeIcon
                :icon="['fas', 'heart']"
                class="commentHeartBadgeWhite"
              />
              <FontAwesomeIcon
                :icon="['fas', 'heart']"
                class="commentHeartBadgeRed"
              />
            </span>
          </p>
          <div
            v-if="comment.numReplies > 0 && !comment.showReplies"
            class="commentReplyContinuation commentReplyRootToggle"
          >
            <button
              type="button"
              class="commentReplyContinuationButton"
              aria-expanded="false"
              :disabled="isReplyLoading(comment.id)"
              @click="toggleCommentReplies(index)"
            >
              <FtSpinner
                v-if="isReplyLoading(comment.id)"
                inline
                size="18px"
                border-width="2px"
                :label="$t('Comments.Getting comment replies, please wait')"
              />
              <template v-else>
                <span>{{ toggleCommentRepliesLinkText(comment) }}</span>
                <FontAwesomeIcon
                  :icon="['fas', 'angle-down']"
                  aria-hidden="true"
                />
              </template>
            </button>
          </div>
          <div
            v-if="comment.showReplies"
            class="commentReplies"
          >
            <CommentReply
              v-for="node in replyTrees[index]"
              :key="node.reply.id"
              :node="node"
              :thread-index="index"
              root-level
              :enable-channel-links="enableChannelLinks"
              :hide-comment-likes="hideCommentLikes"
              :hide-comment-photos="hideCommentPhotos"
              :subscribed-channel-ids="subscribedChannelIds"
              :channel-thumbnail="channelThumbnail"
              :loading-reply-ids="loadingReplyIds"
              :highlighted-comment-id="highlightedCommentId"
              @copy-youtube-link="copyCommentYoutubeLink"
              @get-more-replies="getCommentReplies(index, $event)"
              @timestamp-event="onTimestamp"
            />
            <div
              v-if="isReplyLoading(comment.id) || comment.hasReplyToken"
              class="commentReplyContinuation"
            >
              <button
                type="button"
                class="commentReplyContinuationButton"
                :disabled="isReplyLoading(comment.id)"
                @click="getCommentReplies(index)"
              >
                <FtSpinner
                  v-if="isReplyLoading(comment.id)"
                  inline
                  size="18px"
                  border-width="2px"
                  :label="$t('Comments.Getting comment replies, please wait')"
                />
                <template v-else>
                  <span>{{ $t("Comments.Show More Replies") }}</span>
                  <FontAwesomeIcon
                    :icon="['fas', 'angle-down']"
                    aria-hidden="true"
                  />
                </template>
              </button>
            </div>
            <div
              v-if="comment.numReplies > 0"
              class="commentReplyContinuation"
            >
              <button
                type="button"
                class="commentReplyContinuationButton"
                aria-expanded="true"
                @click="toggleCommentReplies(index)"
              >
                <span>{{ toggleCommentRepliesLinkText(comment) }}</span>
                <FontAwesomeIcon
                  :icon="['fas', 'angle-up']"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        v-else-if="commentsDisabled || (showComments && !isLoading)"
        class="noComments"
        :class="{ noCommentsMessageOnly: commentsDisabled || fullscreenOverlay }"
      >
        <h3
          v-if="commentsDisabled"
          class="noCommentMsg"
        >
          {{ $t("Comments.Comments are turned off") }}
        </h3>
        <h3
          v-else-if="isPostComments"
          class="noCommentMsg"
        >
          {{ $t("Comments.There are no comments available for this post") }}
        </h3>
        <h3
          v-else
          class="noCommentMsg"
        >
          {{ $t("Comments.There are no comments available for this video") }}
        </h3>
        <div
          v-if="!fullscreenOverlay && !commentsDisabled"
          class="noCommentActions"
        >
          <FtSelect
            v-if="showSortBy"
            :placeholder="$t('Global.Sort By')"
            :value="currentSortValue"
            :select-names="sortNames"
            :select-values="sortValues"
            :icon="['fas', 'arrow-down-short-wide']"
            @change="handleSortChange"
          />
          <FtIconButton
            :title="$t('Comments.Reload Comments')"
            :icon="['fas', 'sync']"
            :size="12"
            :padding="8"
            :use-shadow="false"
            class="reloadComments"
            :class="{ reloadCommentsAligned: showSortBy }"
            @click="reloadCommentData"
          />
        </div>
      </div>
      <FtSpinner
        v-if="shouldShowAutoLoadMoreCommentsSpinner"
        label="Loading more comments"
      />
      <h4
        v-else-if="canPerformMoreCommentLoading"
        class="getMoreComments"
        role="button"
        tabindex="0"
        @click="getMoreComments"
        @keydown.space.prevent="getMoreComments"
        @keydown.enter.prevent="getMoreComments"
      >
        {{ $t("Comments.Load More Comments") }}
      </h4>
      <FtLoader
        v-if="isLoading"
      />
      <div
        v-if="!isLoading && !isLoadingMoreComments"
        v-observe-visibility="observeVisibilityOptions"
        class="commentAutoLoadSentinel"
      >
      <!--
        Dummy element to be observed by Intersection Observer
      -->
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import CommentReply from './CommentReply.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtRetryImage from '../FtRetryImage.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSpinner from '../FtSpinner/FtSpinner.vue'
import FtTimestampCatcher from '../FtTimestampCatcher.vue'

import store from '../../store/index'
import { useTabContext } from '../../tabs/TabContext'

import { copyToClipboard, formatNumber, getRelativeTimeFromDate, showApiErrorToast, showToast } from '../../helpers/utils'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import {
  getReplyContinuationToken,
  getReplyLoadState,
  isEmptyReplyContinuation,
  isMissingReplyResponseError,
  shouldLoadInitialReplies
} from '../../helpers/comment-replies'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getYoutubeCommunityPostCommentUrl, getYoutubeVideoCommentUrl } from '../../helpers/share'
import {
  getLocalCommunityPostComments,
  getLocalComments,
  parseLocalComment,
  parseLocalSubscriberCount
} from '../../helpers/api/local'
import {
  getInvidiousCommunityPostCommentReplies,
  getInvidiousCommunityPostComments,
  invidiousGetCommentReplies,
  invidiousGetComments
} from '../../helpers/api/invidious'

const { t } = useI18n()
const { isTabPresented } = useTabContext()
const relativeTimeNow = useRelativeTimeClock()

function formatCommentTime(comment) {
  return comment.published
    ? getRelativeTimeFromDate(comment.published, false, true, relativeTimeNow.value)
    : comment.time
}

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    required: true
  },
  isPostComments: {
    type: Boolean,
    default: false,
  },
  commentsDisabled: {
    type: Boolean,
    default: false,
  },
  postAuthorId: {
    type: String,
    default: null
  },
  showSortBy: {
    type: Boolean,
    default: true,
  },
  initialCommentCount: {
    type: Number,
    default: null,
  },
  fullscreenOverlay: {
    type: Boolean,
    default: false,
  },
  highlightedCommentId: {
    type: String,
    default: null,
  }
})

const isLoading = ref(false)
const isLoadingMoreComments = ref(false)
const loadingReplyIds = ref(new Set())
const showComments = ref(false)
const nextPageToken = shallowRef(null)

// Has to be ref not shallowRef, as the replies are stored in a property on the comments
// we need to react to new replies and showReplies being toggled
const commentData = ref([])
const commentCount = ref(props.initialCommentCount)
const commentsContentWrapper = useTemplateRef('commentsContentWrapper')
let fullscreenScrollTop = 0
let highlightedTargetGeneration = 0
const MAX_HIGHLIGHTED_REPLY_PAGES = 20

watch(() => props.fullscreenOverlay, (fullscreenOverlay, wasFullscreenOverlay) => {
  if (wasFullscreenOverlay) {
    fullscreenScrollTop = commentsContentWrapper.value?.scrollTop ?? 0
  }

  if (fullscreenOverlay) {
    nextTick(() => {
      if (commentsContentWrapper.value != null) {
        commentsContentWrapper.value.scrollTop = fullscreenScrollTop
      }
    })
  }
})

/**
 * Sends the fullscreen dock back to the first comment, for the reloads and sort
 * changes that replace the whole list. The old offset points at comments that
 * are gone, and OverlayScrollbars restores it over the shorter list once that
 * has rendered, leaving the dock parked past its end until it is scrolled up.
 */
function resetCommentsScroll() {
  fullscreenScrollTop = 0

  if (commentsContentWrapper.value != null) {
    restoreOverlayScrollTop(commentsContentWrapper.value, 0)
  }
}

const replyTrees = computed(() => commentData.value.map(buildReplyTree))

function normalizeCommentAuthor(author) {
  return String(author)
    .replaceAll(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
}

/**
 * YouTube represents replies to replies as a leading channel mention rather
 * than exposing their parent comment ID through the comments APIs.
 *
 * @param {string} html
 * @returns {{ channelId: string, handle: string, author: string } | null}
 */
function getLeadingMention(html) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const firstAnchor = document.body.querySelector('a')

  if (!firstAnchor) {
    return null
  }

  const precedingContent = document.createRange()
  precedingContent.setStart(document.body, 0)
  precedingContent.setEndBefore(firstAnchor)

  if (normalizeCommentAuthor(precedingContent.toString()) !== '') {
    return null
  }

  const href = firstAnchor.getAttribute('href') ?? ''
  const channelId = /\/channel\/([^/?#]+)/.exec(href)?.[1] ?? ''
  // Mentions can link via a handle URL (`/@handle`) rather than `/channel/…`,
  // in which case the anchor text is often the display name, not the handle
  const handle = /\/@([^/?#]+)/.exec(href)?.[1] ?? ''

  return {
    channelId,
    handle: normalizeCommentAuthor(handle),
    author: normalizeCommentAuthor(firstAnchor.textContent)
  }
}

/**
 * @param {Comment} comment
 * @param {{ channelId: string, handle: string, author: string }} mention
 */
function commentMatchesMention(comment, mention) {
  const channelIds = [comment.authorId, comment.authorLink].filter(Boolean)
  const author = normalizeCommentAuthor(comment.author)

  return (mention.channelId !== '' && channelIds.includes(mention.channelId)) ||
    (mention.handle !== '' && author === mention.handle) ||
    author === mention.author
}

/**
 * @param {Comment} comment
 */
function buildReplyTree(comment) {
  if (comment.dataType === 'local') {
    return comment.replies.map((reply, index) => {
      return {
        reply,
        index,
        children: buildReplyTree(reply)
      }
    })
  }

  const roots = []
  const previousNodes = []

  comment.replies.forEach((reply, index) => {
    const node = { reply, index, children: [] }
    const mention = getLeadingMention(reply.text)
    let parent = null

    if (mention && !commentMatchesMention(comment, mention)) {
      for (let previousIndex = previousNodes.length - 1; previousIndex >= 0; previousIndex--) {
        if (commentMatchesMention(previousNodes[previousIndex].reply, mention)) {
          parent = previousNodes[previousIndex]
          break
        }
      }
    }

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }

    previousNodes.push(node)
  })

  return roots
}

/** @type {import('youtubei.js').YT.Comments | undefined} */
let localCommentsInstance

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideCommentLikes = computed(() => {
  return store.getters.getHideCommentLikes
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideCommentPhotos = computed(() => {
  return store.getters.getHideCommentPhotos
})

/** @type {import('vue').ComputedRef<boolean>} */
const generalAutoLoadMorePaginatedItemsEnabled = computed(() => {
  return store.getters.getGeneralAutoLoadMorePaginatedItemsEnabled
})

const canPerformInitialCommentLoading = computed(() => {
  return !props.commentsDisabled && commentData.value.length === 0 && !isLoading.value && !showComments.value
})

watch(() => props.highlightedCommentId, (commentId, previousCommentId) => {
  const targetChanged = previousCommentId !== undefined && previousCommentId !== commentId
  if (targetChanged) {
    highlightedTargetGeneration++
    isLoading.value = false
    isLoadingMoreComments.value = false
    loadingReplyIds.value = new Set()
    showComments.value = false
    commentData.value = []
    nextPageToken.value = null
    localCommentsInstance = undefined
    replyTokens.clear()
    resetCommentsScroll()
  }

  if ((commentId || targetChanged) && canPerformInitialCommentLoading.value) {
    getCommentData()
  }
}, { immediate: true })

watch(
  [generalAutoLoadMorePaginatedItemsEnabled, () => isTabPresented?.value],
  ([autoLoadEnabled, presented]) => {
    // Background tabs have no layout, so their visibility observer cannot
    // trigger the initial load.
    if (autoLoadEnabled && presented === false && canPerformInitialCommentLoading.value) {
      getCommentData()
    }
  },
  { immediate: true }
)

const canPerformMoreCommentLoading = computed(() => {
  return commentData.value.length > 0 && !isLoading.value && !isLoadingMoreComments.value && showComments.value && !!nextPageToken.value
})

const shouldShowAutoLoadMoreCommentsSpinner = computed(() => {
  return commentData.value.length > 0 &&
    !isLoading.value &&
    showComments.value &&
    isLoadingMoreComments.value
})

const observeVisibilityOptions = computed(() => {
  if (!generalAutoLoadMorePaginatedItemsEnabled.value) {
    return false
  }

  return {
    /**
     * @param {boolean} isVisible
     */
    callback: (isVisible) => {
      // This is also fired when **hidden**
      // No point doing anything if not visible
      if (!isVisible) { return }
      // It's possible the comments are being loaded/already loaded
      if (canPerformInitialCommentLoading.value) {
        getCommentData()
      } else if (canPerformMoreCommentLoading.value) {
        getMoreComments()
      }
    },
    intersection: {
      root: props.fullscreenOverlay ? commentsContentWrapper.value : null,
      // Only when it intersects with N% above bottom
      rootMargin: '0% 0% 0% 0%',
    },
    // Callback responsible for loading multiple comment pages
    once: false,
  }
})

const sortNames = computed(() => [
  t('Comments.Top comments'),
  t('Comments.Newest first')
])

const sortValues = [
  'top',
  'newest'
]

const sortNewest = ref(false)
const sortMenuOpen = ref(false)

const currentSortValue = computed(() => sortNewest.value ? 'newest' : 'top')

function handleSortChange(value) {
  const newest = value === 'newest'
  sortMenuOpen.value = false

  if (sortNewest.value === newest) {
    return
  }

  sortNewest.value = newest
  commentData.value = []
  nextPageToken.value = null
  resetCommentsScroll()
  getCommentData()
}

function reloadCommentData() {
  commentData.value = []
  nextPageToken.value = null
  localCommentsInstance = undefined
  replyTokens.clear()
  resetCommentsScroll()
  getCommentData({ preserveSort: true })
}

function handleFullscreenActionsFocusout(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    sortMenuOpen.value = false
  }
}

const emit = defineEmits(['timestamp-event', 'close-comments'])

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

/**
 * @param {number} timestamp
 */
function onTimestamp(timestamp) {
  emit('timestamp-event', timestamp)
}

/**
 * @param {number} count
 */
function setCommentCount(count) {
  if (typeof count === 'number' && !isNaN(count)) {
    commentCount.value = count
  }
}

/**
 * @param {any} text
 */
function getCommentCountText(text) {
  if (text == null) {
    return ''
  }

  return text.text ?? text.toString()
}

/**
 * @param {import('youtubei.js').YT.Comments} comments
 */
function setLocalCommentCount(comments) {
  const countText = getCommentCountText(comments.header?.comments_count ?? comments.header?.count)
  const count = parseLocalSubscriberCount(countText)

  setCommentCount(count)
}

const formattedCommentCount = computed(() => {
  if (commentCount.value == null) {
    return ''
  }

  return formatNumber(commentCount.value)
})

const commentsTitle = computed(() => {
  if (!formattedCommentCount.value) {
    return t('Comments.Comments')
  }

  return t('Comments.Comment Count', { count: formattedCommentCount.value }, commentCount.value)
})

watch(() => props.initialCommentCount, (value) => {
  if (value == null) {
    commentCount.value = null
    return
  }

  setCommentCount(value)
})

/** @type {import('vue').ComputedRef<Set<string>>} */
const subscribedChannelIds = computed(() => {
  return store.getters.getActiveProfile.subscriptions.reduce((set, channel) => {
    return set.add(channel.id)
  }, new Set())
})

/**
 * @param {string} channelId
 */
function isSubscribedToChannel(channelId) {
  return subscribedChannelIds.value.has(channelId)
}

/**
 * @param {string} commentId
 */
function getCommentYoutubeLink(commentId) {
  if (props.isPostComments) {
    return getYoutubeCommunityPostCommentUrl(props.id, commentId)
  }

  return getYoutubeVideoCommentUrl(props.id, commentId)
}

/**
 * @param {string} commentId
 */
function copyCommentYoutubeLink(commentId) {
  copyToClipboard(getCommentYoutubeLink(commentId), {
    messageOnSuccess: t('Comments.YouTube comment link copied to clipboard')
  })
}

function getCommentData({ preserveSort = false } = {}) {
  isLoading.value = true

  const useInvidious = !process.env.SUPPORTS_LOCAL_API || backendPreference.value === 'invidious'

  if (useInvidious) {
    if (!props.isPostComments) {
      getCommentDataInvidious()
    } else {
      getPostCommentsInvidious()
    }
  } else {
    getCommentDataLocal(false, preserveSort)
  }
}

function getMoreComments() {
  if (commentData.value.length === 0 || nextPageToken.value == null) {
    showToast({ message: t('Comments.There are no more comments for this video'), icon: ['fas', 'comment'] })
  } else {
    isLoadingMoreComments.value = true
    let commentLoadPromise

    if (typeof nextPageToken.value === 'string') {
      if (!props.isPostComments) {
        commentLoadPromise = getCommentDataInvidious()
      } else {
        commentLoadPromise = getPostCommentsInvidious()
      }
    } else {
      commentLoadPromise = getCommentDataLocal(true)
    }

    commentLoadPromise?.finally(() => {
      isLoadingMoreComments.value = false
    })
  }
}

/** @typedef {import('../../helpers/api/local').LocalComment | import('../../helpers/api/invidious').InvidiousComment} Comment */
/**
 * @param {Comment} comment
 */
function toggleCommentRepliesLinkText(comment) {
  if (comment.showReplies) {
    return t('Comments.Hide {replyCount} replies', { replyCount: comment.numReplies }, comment.numReplies)
  }

  return t('Comments.Reply Count', { replyCount: comment.numReplies }, comment.numReplies)
}

/**
 * @param {number} index
 */
function toggleCommentReplies(index) {
  if (commentData.value[index].showReplies || commentData.value[index].replies.length > 0) {
    commentData.value[index].showReplies = !commentData.value[index].showReplies
  } else {
    getCommentReplies(index)
  }
}

/**
 * @param {number} index
 * @param {string | null} commentId
 */
async function getCommentReplies(index, commentId = null) {
  const replyId = commentId ?? commentData.value[index].id
  const targetGeneration = highlightedTargetGeneration
  if (loadingReplyIds.value.has(replyId)) {
    return
  }

  loadingReplyIds.value = new Set(loadingReplyIds.value).add(replyId)

  try {
    const comment = findComment(commentData.value[index], commentId)
    const replyToken = comment && replyTokens.get(comment.id)
    const useInvidious = !process.env.SUPPORTS_LOCAL_API ||
      commentData.value[index].dataType === 'invidious' ||
      typeof replyToken === 'string'

    if (useInvidious) {
      if (!props.isPostComments) {
        await getCommentRepliesInvidious(index, commentId)
      } else {
        await getPostCommentRepliesInvidious(index)
      }
    } else {
      await getCommentRepliesLocal(index, commentId)
    }
  } finally {
    if (targetGeneration === highlightedTargetGeneration) {
      const nextLoadingReplyIds = new Set(loadingReplyIds.value)
      nextLoadingReplyIds.delete(replyId)
      loadingReplyIds.value = nextLoadingReplyIds
    }
  }
}

function isReplyLoading(commentId) {
  return loadingReplyIds.value.has(commentId)
}

/** @type {Map<string, (import('youtubei.js').YTNodes.CommentThread | import('youtubei.js').Misc.CommentsContinuation | string)>} */
const replyTokens = new Map()

/**
 * @param {import('youtubei.js').YTNodes.CommentThread} commentThread
 * @param {boolean} showReplies
 * @returns {import('../../helpers/api/local').LocalComment | null}
 */
function parseLocalCommentThread(commentThread, showReplies = true) {
  if (!commentThread.comment) {
    return null
  }

  const { replyToken, ...comment } = parseLocalComment(commentThread.comment, commentThread)
  comment.replies = (commentThread.replies ?? [])
    .map(reply => parseLocalCommentThread(reply))
    .filter(Boolean)
  const containsHighlightedComment = props.highlightedCommentId && (
    findComment(comment, props.highlightedCommentId) !== null ||
    comment.id === getHighlightedRootCommentId()
  )
  comment.showReplies = (showReplies || containsHighlightedComment) && comment.replies.length > 0

  const hasReplyToken = commentThread.has_replies &&
    (!commentThread.replies || commentThread.has_continuation)

  comment.hasReplyToken = hasReplyToken
  if (hasReplyToken) {
    replyTokens.set(comment.id, commentThread)
  } else {
    replyTokens.delete(comment.id)
  }

  return comment
}

/**
 * @param {Comment} comment
 * @param {string | null} commentId
 */
function findComment(comment, commentId) {
  if (commentId === null || comment.id === commentId) {
    return comment
  }

  for (const reply of comment.replies) {
    const match = findComment(reply, commentId)
    if (match) {
      return match
    }
  }

  return null
}

function getHighlightedRootCommentId() {
  return props.highlightedCommentId?.split('.')[0] ?? null
}

/**
 * Keep pinned comments at the top, followed by the thread containing the
 * highlighted comment or reply.
 *
 * @param {Comment[]} comments
 * @returns {Comment[]}
 */
function prioritizeHighlightedComment(comments) {
  if (!props.highlightedCommentId) {
    return comments
  }

  const pinnedComments = comments.filter(comment => comment.isPinned)
  const unpinnedComments = comments.filter(comment => !comment.isPinned)
  const highlightedIndex = unpinnedComments.findIndex(comment => {
    return findComment(comment, props.highlightedCommentId) !== null ||
      comment.id === getHighlightedRootCommentId()
  })

  if (highlightedIndex > 0) {
    const [highlightedComment] = unpinnedComments.splice(highlightedIndex, 1)
    unpinnedComments.unshift(highlightedComment)
  }

  return pinnedComments.concat(unpinnedComments)
}

async function loadHighlightedReply() {
  const highlightedCommentId = props.highlightedCommentId
  const rootCommentId = getHighlightedRootCommentId()
  if (!highlightedCommentId?.includes('.') || !rootCommentId) {
    return
  }

  const threadIndex = commentData.value.findIndex(comment => comment.id === rootCommentId)
  const thread = commentData.value[threadIndex]
  if (!thread) {
    return
  }

  let loadedPageCount = 0
  while (
    !findComment(thread, highlightedCommentId) &&
    thread.hasReplyToken &&
    loadedPageCount < MAX_HIGHLIGHTED_REPLY_PAGES
  ) {
    const previousReplyCount = thread.replies.length
    const previousReplyToken = replyTokens.get(thread.id)

    if (highlightedCommentId !== props.highlightedCommentId || commentData.value[threadIndex] !== thread) {
      return
    }

    await getCommentReplies(threadIndex)
    loadedPageCount++

    if (thread.replies.length === previousReplyCount && replyTokens.get(thread.id) === previousReplyToken) {
      break
    }
  }
}

/**
 * @param {boolean | undefined} more
 * @param {boolean} preserveSort
 */
async function getCommentDataLocal(more = false, preserveSort = false) {
  const requestedHighlightedCommentId = props.highlightedCommentId

  try {
    /** @type {import('youtubei.js').YT.Comments} */
    let comments
    if (more) {
      comments = await nextPageToken.value.getContinuation()
    } else if (localCommentsInstance && !props.highlightedCommentId) {
      comments = await localCommentsInstance.applySort(sortNewest.value ? 'NEWEST_FIRST' : 'TOP_COMMENTS')
    } else {
      if (props.isPostComments) {
        comments = await getLocalCommunityPostComments(props.id, props.postAuthorId)
      } else {
        const sortBy = preserveSort ? (sortNewest.value ? 'NEWEST_FIRST' : 'TOP_COMMENTS') : undefined
        comments = await getLocalComments(props.id, sortBy, getHighlightedRootCommentId() ?? undefined)
      }

      if (preserveSort && (props.isPostComments || !props.highlightedCommentId)) {
        comments = await comments.applySort(sortNewest.value ? 'NEWEST_FIRST' : 'TOP_COMMENTS')
      } else {
        sortNewest.value = comments.header?.sort_menu?.sub_menu_items?.[1].selected ?? false
      }
    }

    if (requestedHighlightedCommentId !== props.highlightedCommentId) {
      return
    }

    if (!more) {
      localCommentsInstance = comments
    }

    setLocalCommentCount(comments)

    const parsedComments = prioritizeHighlightedComment(
      comments.contents
        .map(commentThread => parseLocalCommentThread(commentThread, false))
        .filter(Boolean)
    )

    if (more) {
      commentData.value = commentData.value.concat(parsedComments)
    } else {
      commentData.value = parsedComments
    }

    nextPageToken.value = comments.has_continuation ? comments : null
    isLoading.value = false
    showComments.value = true

    if (!more) {
      await loadHighlightedReply()
    }
  } catch (err) {
    if (requestedHighlightedCommentId !== props.highlightedCommentId) {
      return
    }

    // region No comment detection
    // No comment related info when video info requested earlier in parent component
    if (err.message.includes('Comments page did not have any content')) {
      // For videos without any comment (comment disabled?)
      // e.g. https://youtu.be/8NBSwDEf8a8
      commentData.value = []
      nextPageToken.value = null
      setCommentCount(0)
      isLoading.value = false
      showComments.value = true
      localCommentsInstance = undefined
      return
    }
    // endregion No comment detection

    console.error(err)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (backendFallback.value && backendPreference.value === 'local') {
      localCommentsInstance = undefined
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      if (props.isPostComments) {
        return getPostCommentsInvidious()
      } else {
        return getCommentDataInvidious()
      }
    } else {
      isLoading.value = false
    }
  }
}

/**
 * @param {number} index
 * @param {string | null} commentId
 */
async function getCommentRepliesLocal(index, commentId = null) {
  const targetGeneration = highlightedTargetGeneration
  const rootComment = commentData.value[index]
  const comment = rootComment ? findComment(rootComment, commentId) : null
  const continuation = comment && replyTokens.get(comment.id)
  const invidiousReplyToken = continuation && typeof continuation !== 'string'
    ? getReplyContinuationToken(continuation)
    : null

  try {
    if (!comment || continuation == null || typeof continuation === 'string') {
      if (comment) {
        replyTokens.delete(comment.id)
        comment.hasReplyToken = false
      }
      return
    }

    let replyThreads
    let nextContinuation
    const hasLoadedReplyBatch = !!continuation.replies
    const loadInitialReplies = 'getReplies' in continuation &&
      shouldLoadInitialReplies(
        hasLoadedReplyBatch,
        comment.replies.length > 0,
        hasLoadedReplyBatch && continuation.has_continuation
      )

    if (loadInitialReplies) {
      await continuation.getReplies()
      replyThreads = continuation.replies ?? []
      nextContinuation = continuation.has_continuation ? continuation : null
    } else {
      const response = await continuation.getContinuation()
      replyThreads = response.replies
      nextContinuation = response.has_continuation ? response : null
    }

    if (targetGeneration !== highlightedTargetGeneration) {
      return
    }

    const parsedReplies = replyThreads
      .map(reply => parseLocalCommentThread(reply))
      .filter(Boolean)

    if (isEmptyReplyContinuation(parsedReplies.length, nextContinuation !== null)) {
      replyTokens.delete(comment.id)
      comment.hasReplyToken = false
      comment.numReplies = comment.replies.length
      comment.showReplies = comment.replies.length > 0
      showToast({
        message: t('Comments.YouTube did not provide advertised replies'),
        time: 10000,
        icon: ['fas', 'comment']
      })
      return
    }

    comment.replies = comment.replies.concat(parsedReplies)

    const replyLoadState = getReplyLoadState(
      comment.replies.length,
      comment.numReplies,
      nextContinuation !== null
    )

    if (replyLoadState.hasMore) {
      replyTokens.set(comment.id, nextContinuation ?? continuation)
      comment.hasReplyToken = true
    } else {
      replyTokens.delete(comment.id)
      comment.hasReplyToken = false
    }

    if (replyLoadState.hasMissingReplies) {
      comment.numReplies = comment.replies.length
    }

    comment.showReplies = replyLoadState.showReplies
  } catch (err) {
    if (targetGeneration !== highlightedTargetGeneration) {
      return
    }

    console.error(err)

    if (isMissingReplyResponseError(err)) {
      if (
        !props.isPostComments &&
        backendFallback.value &&
        backendPreference.value === 'local' &&
        invidiousReplyToken &&
        comment &&
        replyTokens.get(comment.id) === continuation
      ) {
        showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
        await getCommentRepliesInvidious(index, commentId, invidiousReplyToken, comment, continuation)
        return
      }

      if (comment && replyTokens.get(comment.id) === continuation) {
        replyTokens.delete(comment.id)
        comment.hasReplyToken = false
        comment.numReplies = comment.replies.length
        comment.showReplies = comment.replies.length > 0
      }

      showToast({
        message: t('Comments.YouTube did not provide advertised replies'),
        time: 10000,
        icon: ['fas', 'comment']
      })
      return
    }

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)
    if (backendFallback.value && backendPreference.value === 'local') {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      getCommentDataInvidious()
    } else {
      isLoading.value = false
    }
  }
}

async function getCommentDataInvidious() {
  const requestedHighlightedCommentId = props.highlightedCommentId

  try {
    let { response, commentData: comments } = await invidiousGetComments({
      id: props.id,
      nextPageToken: nextPageToken.value,
      sortNewest: sortNewest.value
    })

    if (requestedHighlightedCommentId !== props.highlightedCommentId) {
      return
    }

    setCommentCount(response.commentCount)

    comments = comments.map(({ replyToken, ...comment }) => {
      if (comment.hasReplyToken) {
        replyTokens.set(comment.id, replyToken)
      } else {
        replyTokens.delete(comment.id)
      }

      return comment
    })
    comments = prioritizeHighlightedComment(comments)

    commentData.value = commentData.value.concat(comments)
    nextPageToken.value = response.continuation
    isLoading.value = false
    showComments.value = true
  } catch (err) {
    if (requestedHighlightedCommentId !== props.highlightedCommentId) {
      return
    }

    // region No comment detection
    // No comment related info when video info requested earlier in parent component
    if (err.message.includes('Comments not found')) {
      // For videos without any comment (comment disabled?)
      // e.g. https://youtu.be/8NBSwDEf8a8
      commentData.value = []
      nextPageToken.value = null
      setCommentCount(0)
      isLoading.value = false
      showComments.value = true
      return
    }
    // endregion No comment detection

    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (process.env.SUPPORTS_LOCAL_API && backendFallback.value && backendPreference.value === 'invidious') {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      return getCommentDataLocal()
    } else {
      isLoading.value = false
    }
  }
}

/**
 * @param {number} index
 * @param {string | null} commentId
 * @param {string | null} replyTokenOverride
 * @param {Comment | null} commentOverride
 * @param {import('youtubei.js').YTNodes.CommentThread | null} expectedReplyToken
 */
async function getCommentRepliesInvidious(
  index,
  commentId = null,
  replyTokenOverride = null,
  commentOverride = null,
  expectedReplyToken = null
) {
  const targetGeneration = highlightedTargetGeneration
  const rootComment = commentData.value[index]
  const comment = commentOverride ?? (rootComment ? findComment(rootComment, commentId) : null)
  if (!comment) {
    return
  }

  const replyToken = replyTokenOverride ?? replyTokens.get(comment.id)

  try {
    const { commentData, continuation } = await invidiousGetCommentReplies({ id: props.id, replyToken })

    if (
      targetGeneration !== highlightedTargetGeneration ||
      (expectedReplyToken && replyTokens.get(comment.id) !== expectedReplyToken)
    ) {
      return
    }

    comment.replies = comment.replies.concat(commentData)
    const replyLoadState = getReplyLoadState(
      comment.replies.length,
      comment.numReplies,
      continuation !== null
    )
    comment.showReplies = replyLoadState.showReplies

    if (replyLoadState.hasMore) {
      replyTokens.set(comment.id, continuation ?? replyToken)
      comment.hasReplyToken = true
    } else {
      replyTokens.delete(comment.id)
      comment.hasReplyToken = false
    }

    if (replyLoadState.hasMissingReplies) {
      comment.numReplies = comment.replies.length
    }

    isLoading.value = false
  } catch (error) {
    if (targetGeneration !== highlightedTargetGeneration) {
      return
    }

    console.error(error)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    isLoading.value = false
  }
}

function getPostCommentsInvidious() {
  const fetchComments = nextPageToken.value == null
    ? getInvidiousCommunityPostComments({ postId: props.id, authorId: props.postAuthorId })
    : getInvidiousCommunityPostCommentReplies({ postId: props.id, replyToken: nextPageToken.value, authorId: props.postAuthorId })

  return fetchComments.then(({ response, commentData: comments, continuation }) => {
    setCommentCount(response?.commentCount)

    comments = comments.map(({ replyToken, ...comment }) => {
      if (comment.hasReplyToken) {
        replyTokens.set(comment.id, replyToken)
      } else {
        replyTokens.delete(comment.id)
      }

      return comment
    })

    commentData.value = commentData.value.concat(comments)
    nextPageToken.value = response?.continuation ?? continuation
    isLoading.value = false
    showComments.value = true
  }).catch((err) => {
    console.error(err)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (process.env.SUPPORTS_LOCAL_API && backendFallback.value && backendPreference.value === 'invidious') {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      return getCommentDataLocal()
    } else {
      isLoading.value = false
    }
  })
}

async function getPostCommentRepliesInvidious(index) {
  const targetGeneration = highlightedTargetGeneration
  const comment = commentData.value[index]
  const replyToken = replyTokens.get(comment.id)

  try {
    const { commentData: comments, continuation } = await getInvidiousCommunityPostCommentReplies({
      postId: props.id,
      replyToken: replyToken,
      authorId: props.postAuthorId
    })

    if (targetGeneration !== highlightedTargetGeneration) {
      return
    }

    comment.replies = comment.replies.concat(comments)
    const replyLoadState = getReplyLoadState(
      comment.replies.length,
      comment.numReplies,
      continuation !== null
    )
    comment.showReplies = replyLoadState.showReplies

    if (replyLoadState.hasMore) {
      replyTokens.set(comment.id, continuation ?? replyToken)
      comment.hasReplyToken = true
    } else {
      replyTokens.delete(comment.id)
      comment.hasReplyToken = false
    }

    if (replyLoadState.hasMissingReplies) {
      comment.numReplies = comment.replies.length
    }

    isLoading.value = false
  } catch (error) {
    if (targetGeneration !== highlightedTargetGeneration) {
      return
    }

    console.error(error)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    isLoading.value = false
  }
}
</script>

<style scoped src="./CommentSection.css" />
