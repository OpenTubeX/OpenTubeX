<template>
  <div
    :id="`comment${threadIndex}-${node.index}`"
    class="commentReplyBranch"
    :class="{
      commentReplyBranchRoot: rootLevel,
      highlightedCommentBranch: reply.id === highlightedCommentId
    }"
  >
    <span
      class="commentReplyConnector"
      aria-hidden="true"
    />
    <div
      class="comment commentReplyContent"
      :class="{ highlightedComment: reply.id === highlightedCommentId }"
    >
      <p
        v-if="reply.id === highlightedCommentId"
        class="highlightedCommentBadge"
      >
        {{ $t('Comments.Highlighted reply') }}
      </p>
      <span
        v-if="node.children.length > 0 || (reply.dataType === 'local' && reply.hasReplyToken) || loadingReplyIds.has(reply.id)"
        class="commentReplyChildStem"
        aria-hidden="true"
      />
      <component
        :is="enableChannelLinks ? 'router-link' : 'div'"
        :to="`/channel/${reply.authorLink}`"
        tabindex="-1"
      >
        <div
          v-if="!reply.authorThumb || (hideCommentPhotos && !reply.isOwner)"
          class="commentThumbnailHidden"
          dir="auto"
        >
          {{ reply.author.substring(1, 2) }}
        </div>
        <FtRetryImage
          v-else
          :src="reply.authorThumb"
          class="commentThumbnail"
        />
      </component>
      <p
        v-if="isPersonallyPinned"
        class="commentPinned commentPersonalPin"
      >
        <FtIcon
          :icon="['fas', 'thumbtack']"
          aria-hidden="true"
        />
        {{ $t('Comments.Pinned by you') }}
      </p>
      <p class="commentAuthorWrapper">
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          class="commentAuthor"
          dir="auto"
          :class="{ commentOwner: reply.isOwner }"
          :to="`/channel/${reply.authorLink}`"
        >
          <template
            v-for="(segment, segmentIndex) in authorSearchSegments"
            :key="segmentIndex"
          >
            <mark v-if="segment.highlighted">{{ segment.text }}</mark>
            <template v-else>
              {{ segment.text }}
            </template>
          </template>
        </component>
        <img
          v-if="reply.isMember"
          :src="reply.memberIconUrl"
          class="commentMemberIcon"
          alt=""
        >
        <img
          v-if="subscribedChannelIds.has(reply.authorId)"
          :title="$t('Comments.Subscribed')"
          :aria-label="$t('Comments.Subscribed')"
          class="commentSubscribedIcon"
          alt=""
        >
        <span class="commentDate">
          {{ formatCommentTime(reply) }}
          <template v-if="reply.isEdited">
            {{ $t("Comments.Edited") }}
          </template>
        </span>
        <button
          type="button"
          class="commentPinButton"
          :class="{ active: isPersonallyPinned }"
          :title="personalPinActionLabel"
          :aria-label="personalPinActionLabel"
          :aria-pressed="isPersonallyPinned"
          @click="emit('toggle-personal-pin', reply.id)"
        >
          <FtIcon
            :icon="['fas', isPersonallyPinned ? 'thumbtack-slash' : 'thumbtack']"
          />
        </button>
        <button
          type="button"
          class="commentCopyLink"
          :title="$t('Comments.Copy YouTube Link')"
          :aria-label="$t('Comments.Copy YouTube Link')"
          @click="emit('copy-youtube-link', reply.id)"
        >
          <FtIcon :icon="['fas', 'link']" />
        </button>
      </p>
      <FtTimestampCatcher
        class="commentText"
        :input-html="reply.showTranslated && reply.translatedLanguage === translationLanguage
          ? reply.translatedText
          : reply.text"
        :highlight="highlight"
        @timestamp-event="emit('timestamp-event', $event)"
      />
      <CommentTranslationButton
        v-if="translationEnabled && reply.translationText"
        :comment="reply"
        :loading="loadingTranslationIds.has(reply.id)"
        :target-language="translationLanguage"
        :target-language-name="translationLanguageName"
        @translate-comment="emit('translate-comment', $event)"
      />
      <p class="commentLikeCount">
        <template v-if="!hideCommentLikes">
          <FtIcon :icon="['fas', 'thumbs-up']" />
          {{ formatViewCount(reply.likes, shortenViewCounts) }}
        </template>
        <span
          v-if="reply.isHearted"
          class="commentHeartBadge"
        >
          <img
            :src="channelThumbnail"
            :title="$t('Comments.Hearted')"
            :aria-label="$t('Comments.Hearted')"
            class="commentHeartBadgeImg"
            alt=""
          >
          <FtIcon
            :icon="['fas', 'heart']"
            class="commentHeartBadgeWhite"
          />
          <FtIcon
            :icon="['fas', 'heart']"
            class="commentHeartBadgeRed"
          />
        </span>
      </p>
    </div>
    <div
      v-if="node.children.length > 0 || (!filtering && ((reply.dataType === 'local' && reply.hasReplyToken) || loadingReplyIds.has(reply.id)))"
      class="commentReplyChildren"
    >
      <CommentReply
        v-for="child in node.children"
        :key="child.reply.id"
        :node="child"
        :thread-index="threadIndex"
        :enable-channel-links="enableChannelLinks"
        :hide-comment-likes="hideCommentLikes"
        :hide-comment-photos="hideCommentPhotos"
        :subscribed-channel-ids="subscribedChannelIds"
        :channel-thumbnail="channelThumbnail"
        :loading-reply-ids="loadingReplyIds"
        :loading-translation-ids="loadingTranslationIds"
        :translation-enabled="translationEnabled"
        :translation-language="translationLanguage"
        :translation-language-name="translationLanguageName"
        :highlighted-comment-id="highlightedCommentId"
        :highlight="highlight"
        :personal-pinned-comment-ids="personalPinnedCommentIds"
        :filtering="filtering"
        :shorten-view-counts="shortenViewCounts"
        @copy-youtube-link="emit('copy-youtube-link', $event)"
        @get-more-replies="emit('get-more-replies', $event)"
        @toggle-personal-pin="emit('toggle-personal-pin', $event)"
        @timestamp-event="emit('timestamp-event', $event)"
        @translate-comment="emit('translate-comment', $event)"
      />
      <div
        v-if="!filtering && (loadingReplyIds.has(reply.id) || (reply.dataType === 'local' && reply.hasReplyToken))"
        class="commentReplyContinuation"
      >
        <button
          type="button"
          class="commentReplyContinuationButton"
          :disabled="loadingReplyIds.has(reply.id)"
          @click="emit('get-more-replies', reply.id)"
        >
          <FtSpinner
            v-if="loadingReplyIds.has(reply.id)"
            inline
            size="18px"
            border-width="2px"
            :label="$t('Comments.Getting comment replies, please wait')"
          />
          <template v-else>
            <span>{{ $t("Comments.Show More Replies") }}</span>
            <FtIcon
              :icon="['fas', 'angle-down']"
              aria-hidden="true"
            />
          </template>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtTimestampCatcher from '../FtTimestampCatcher.vue'
import CommentTranslationButton from './CommentTranslationButton.vue'
import FtRetryImage from '../FtRetryImage.vue'
import FtSpinner from '../FtSpinner/FtSpinner.vue'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatViewCount, getRelativeTimeFromDate } from '../../helpers/utils'

const { t } = useI18n()

const props = defineProps({
  node: {
    type: Object,
    required: true
  },
  threadIndex: {
    type: Number,
    required: true
  },
  rootLevel: {
    type: Boolean,
    default: false
  },
  enableChannelLinks: {
    type: Boolean,
    required: true
  },
  hideCommentLikes: {
    type: Boolean,
    required: true
  },
  hideCommentPhotos: {
    type: Boolean,
    required: true
  },
  subscribedChannelIds: {
    type: Set,
    required: true
  },
  channelThumbnail: {
    type: String,
    required: true
  },
  loadingReplyIds: {
    type: Set,
    required: true
  },
  loadingTranslationIds: {
    type: Set,
    required: true
  },
  translationEnabled: {
    type: Boolean,
    required: true
  },
  translationLanguage: {
    type: String,
    required: true
  },
  translationLanguageName: {
    type: String,
    required: true
  },
  highlightedCommentId: {
    type: String,
    default: null
  },
  highlight: {
    type: String,
    default: ''
  },
  personalPinnedCommentIds: {
    type: Set,
    required: true
  },
  filtering: {
    type: Boolean,
    required: true
  },
  shortenViewCounts: {
    type: Boolean,
    required: true
  }
})

const relativeTimeNow = useRelativeTimeClock()

function formatCommentTime(comment) {
  return comment.published
    ? getRelativeTimeFromDate(comment.published, false, true, relativeTimeNow.value)
    : comment.time
}

const reply = props.node.reply
const isPersonallyPinned = computed(() => props.personalPinnedCommentIds.has(reply.id))
const personalPinActionLabel = computed(() => {
  return isPersonallyPinned.value
    ? t('Comments.Unpin comment by author', { author: reply.author })
    : t('Comments.Pin comment by author', { author: reply.author })
})
const authorSearchSegments = computed(() => {
  const query = props.highlight
  if (query === '') {
    return [{ text: reply.author, highlighted: false }]
  }

  const normalizedAuthor = reply.author.toLocaleLowerCase()
  const segments = []
  let start = 0
  let matchIndex = normalizedAuthor.indexOf(query)

  while (matchIndex !== -1) {
    if (matchIndex > start) {
      segments.push({ text: reply.author.slice(start, matchIndex), highlighted: false })
    }
    segments.push({
      text: reply.author.slice(matchIndex, matchIndex + query.length),
      highlighted: true
    })
    start = matchIndex + query.length
    matchIndex = normalizedAuthor.indexOf(query, start)
  }

  if (start < reply.author.length) {
    segments.push({ text: reply.author.slice(start), highlighted: false })
  }

  return segments
})

const emit = defineEmits([
  'copy-youtube-link',
  'get-more-replies',
  'timestamp-event',
  'toggle-personal-pin',
  'translate-comment'
])
</script>

<style scoped src="./CommentSection.css" />
<style scoped src="./CommentReply.css" />
