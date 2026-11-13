<template>
  <div
    ref="root"
    class="commentComposer"
    :class="{ topLevelComposer: isTopLevel }"
    @keydown.stop
  >
    <!-- Shows which channel the comment will be posted as. -->
    <FtRetryImage
      v-if="isTopLevel"
      :src="profile?.thumbnail ?? ''"
      :fallback-icon="['fas', 'circle-user']"
      class="commentComposerAvatar"
      alt=""
    />
    <button
      v-if="!expanded"
      type="button"
      class="commentComposerTrigger"
      @click="expand"
    >
      {{ t('YouTube Account.Add a comment') }}
    </button>
    <form
      v-else
      class="commentComposerForm"
      @submit.prevent="submit"
    >
      <FtInput
        ref="input"
        :label="editComment ? t('YouTube Account.Edit Comment') : parentId ? t('YouTube Account.Add a reply') : t('YouTube Account.Add a comment')"
        :icon="['fas', editComment ? 'edit' : parentId ? 'reply' : 'comment']"
        :value="text"
        :maxlength="10000"
        :disabled="posting"
        :show-action-button="false"
        multiline
        @input="text = $event"
      />
      <div class="commentComposerActions">
        <FtButton
          type="button"
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          variant="text"
          :disabled="posting"
          @click="cancel"
        />
        <FtButton
          type="submit"
          :label="editComment ? t('YouTube Account.Save') : parentId ? t('YouTube Account.Reply') : t('YouTube Account.Comment')"
          :icon="['fas', editComment ? 'check' : parentId ? 'reply' : 'comment']"
          :disabled="posting || text.trim() === '' || (editComment !== null && text.trim() === originalText.trim())"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { getSelectedYouTubeProfile } from '../../helpers/youtube-account-state'

import { ERROR_TOAST_ICON, showToast } from '../../helpers/utils'
import { editYouTubeComment, postYouTubeComment } from '../../helpers/api/youtube-account'
import { getCommentEditText, youTubeCommentsKey } from './youTubeComments'

const props = defineProps({
  // Posts a reply to this top-level comment instead of a new comment.
  parentId: { type: String, default: null },
  // Starts a reply to a reply with a mention of its author.
  initialText: { type: String, default: '' },
  // Edits this comment or reply of the account instead of posting a new one.
  editComment: { type: Object, default: null }
})
const emit = defineEmits(['done'])
const { t } = useI18n()
const comments = inject(youTubeCommentsKey)

const originalText = props.editComment ? getCommentEditText(props.editComment) : props.initialText
const text = ref(originalText)
const posting = ref(false)
const input = useTemplateRef('input')
const profile = computed(() => getSelectedYouTubeProfile(store.getters.getYouTubeAccount))
const isTopLevel = !props.parentId && !props.editComment
// Like on YouTube, a new comment starts as a single line that opens the
// editor. Replies and edits open from their buttons, so they start open.
const expanded = ref(!isTopLevel)

async function expand() {
  expanded.value = true
  await nextTick()
  input.value?.focus?.()
}

function cancel() {
  text.value = ''
  if (isTopLevel) {
    expanded.value = false
  } else {
    emit('done')
  }
}

async function submit() {
  const commentText = text.value.trim()
  if (commentText === '' || posting.value) return
  if (props.editComment) {
    await saveEdit(commentText)
    return
  }

  posting.value = true
  // The comment belongs to the channel in use now, even after a switch while it posts.
  const account = store.getters.getYouTubeAccount
  try {
    const posted = await postYouTubeComment(comments.videoId.value, commentText, props.parentId ?? undefined, account)
    comments.addComment(posted, commentText, props.parentId, account)
    text.value = ''
    if (!props.parentId) expanded.value = false
    showToast({
      message: props.parentId ? t('YouTube Account.Reply Posted') : t('YouTube Account.Comment Posted'),
      icon: ['fas', 'comment']
    })
    emit('done')
  } catch (error) {
    console.error(error)
    showToast({
      message: t('YouTube Account.Comment Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    posting.value = false
  }
}

/** @param {string} commentText */
async function saveEdit(commentText) {
  posting.value = true
  const commentId = props.editComment.id
  try {
    await editYouTubeComment(comments.videoId.value, commentId, commentText, store.getters.getYouTubeAccount)
    comments.updateComment(commentId, commentText)
    showToast({ message: t('YouTube Account.Comment Edited'), icon: ['fas', 'edit'] })
    emit('done')
  } catch (error) {
    console.error(error)
    showToast({
      message: t('YouTube Account.Edit Comment Failed', { error: error?.message ?? String(error) }),
      icon: ERROR_TOAST_ICON
    })
  } finally {
    posting.value = false
  }
}

// A shorter text shrinks the auto-sized box and with it the comment list.
const root = useTemplateRef('root')
let lastHeight = 0
const resizeObserver = new ResizeObserver(([entry]) => {
  const height = entry.contentRect.height
  if (height < lastHeight) comments.clampScroll()
  lastHeight = height
})

onMounted(async () => {
  if (root.value) resizeObserver.observe(root.value)
  if (isTopLevel) return
  await nextTick()
  input.value?.focus?.()
})

onBeforeUnmount(() => resizeObserver.disconnect())
</script>

<style scoped>
.commentComposer {
  --input-bottom-spacing: 0;

  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-block: 8px 16px;
}

/* With the first comment's 15px top padding, this matches the visible gap
   between comment threads. */
.topLevelComposer {
  margin-block: 16px 34px;
}

.commentComposerAvatar {
  block-size: 40px;
  border-radius: 50%;
  flex: none;
  font-size: 40px;
  inline-size: 40px;
  object-fit: cover;
}

.commentComposerTrigger {
  flex: 1;
  min-inline-size: 0;
  min-block-size: 40px;
  padding-block: 8px;
  padding-inline: 4px;
  border: 0;
  border-block-end: 1px solid var(--secondary-text-color);
  background: none;
  color: var(--secondary-text-color);
  cursor: text;
  font: inherit;
  text-align: start;
}

.commentComposerTrigger:hover,
.commentComposerTrigger:focus-visible {
  border-block-end-color: var(--primary-text-color);
  color: var(--primary-text-color);
}

.commentComposerTrigger:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.commentComposerForm {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-inline-size: 0;
}

.commentComposerForm :deep(.ft-input-component) {
  inline-size: 100%;
}

.commentComposerForm :deep(.ft-input.multiline) {
  min-block-size: 5rem;
}

.commentComposerActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
