<template>
  <div
    :id="`comment${threadIndex}-${node.index}`"
    class="commentReplyBranch"
    :class="{ commentReplyBranchRoot: rootLevel }"
  >
    <span
      class="commentReplyConnector"
      aria-hidden="true"
    />
    <div class="comment commentReplyContent">
      <span
        v-if="node.children.length > 0"
        class="commentReplyChildStem"
        aria-hidden="true"
      />
      <component
        :is="enableChannelLinks ? 'router-link' : 'div'"
        :to="`/channel/${reply.authorLink}`"
        tabindex="-1"
      >
        <div
          v-if="hideCommentPhotos && !reply.isOwner"
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
      <p class="commentAuthorWrapper">
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          class="commentAuthor"
          dir="auto"
          :class="{ commentOwner: reply.isOwner }"
          :to="`/channel/${reply.authorLink}`"
        >
          {{ reply.author }}
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
          {{ reply.time }}
          <template v-if="reply.isEdited">
            {{ $t("Comments.Edited") }}
          </template>
        </span>
        <button
          type="button"
          class="commentCopyLink"
          :title="$t('Comments.Copy YouTube Link')"
          :aria-label="$t('Comments.Copy YouTube Link')"
          @click="emit('copy-youtube-link', reply.id)"
        >
          <FontAwesomeIcon :icon="['fas', 'link']" />
        </button>
      </p>
      <FtTimestampCatcher
        class="commentText"
        :input-html="reply.text"
        @timestamp-event="emit('timestamp-event', $event)"
      />
      <p class="commentLikeCount">
        <template v-if="!hideCommentLikes">
          <FontAwesomeIcon :icon="['fas', 'thumbs-up']" />
          {{ reply.likes }}
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
        v-if="reply.dataType === 'local' && reply.hasReplyToken"
        class="showMoreReplies"
        role="button"
        tabindex="0"
        @click="emit('get-more-replies', reply.id)"
        @keydown.space.prevent="emit('get-more-replies', reply.id)"
        @keydown.enter.prevent="emit('get-more-replies', reply.id)"
      >
        <span>{{ $t("Comments.Show More Replies") }}</span>
      </div>
    </div>
    <div
      v-if="node.children.length > 0"
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
        @copy-youtube-link="emit('copy-youtube-link', $event)"
        @get-more-replies="emit('get-more-replies', $event)"
        @timestamp-event="emit('timestamp-event', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

import FtTimestampCatcher from '../FtTimestampCatcher.vue'
import FtRetryImage from '../FtRetryImage.vue'

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
  }
})

const reply = props.node.reply

const emit = defineEmits(['copy-youtube-link', 'get-more-replies', 'timestamp-event'])
</script>

<style scoped src="./CommentSection.css" />
<style scoped src="./CommentReply.css" />
