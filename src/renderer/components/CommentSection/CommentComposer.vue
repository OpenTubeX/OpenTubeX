<template>
  <div
    ref="root"
    class="commentComposer"
    :class="{ topLevelComposer: isTopLevel }"
    @keydown.stop
  >
    <!-- Shows which channel the comment will be posted as, and switches it
         when the account has more than one. -->
    <component
      :is="canSwitchProfile ? 'button' : 'div'"
      v-if="isTopLevel"
      :type="canSwitchProfile ? 'button' : null"
      class="commentComposerAvatar"
      :title="canSwitchProfile ? t('YouTube Account.Switch Channel') : null"
      :aria-label="canSwitchProfile ? t('YouTube Account.Switch Channel') : null"
      :aria-haspopup="canSwitchProfile ? 'menu' : null"
      :disabled="canSwitchProfile && switching ? true : null"
      @click="canSwitchProfile && openProfileMenu($event.currentTarget)"
    >
      <FtRetryImage
        :src="profile?.thumbnail ?? ''"
        :fallback-icon="['fas', 'circle-user']"
        class="commentComposerAvatarImage"
        alt=""
      />
    </component>
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
        :highlights="mentionRanges"
        :input-attributes="{
          'aria-autocomplete': 'list',
          'aria-controls': suggestions.length > 0 ? suggestionsId : null,
          'aria-activedescendant': suggestions.length > 0 ? `${suggestionsId}-${activeSuggestion}` : null
        }"
        multiline
        @input="handleInput"
        @keydown="handleKeydown"
        @keyup="updateCaret"
        @pointerup="updateCaret"
      />
      <!-- The text box keeps the focus, so the options are picked with its keys. -->
      <ul
        v-if="suggestions.length > 0"
        :id="suggestionsId"
        class="commentComposerSuggestions"
        role="listbox"
        :aria-label="t('YouTube Account.Mention Suggestions')"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
        <li
          v-for="(suggestion, index) in suggestions"
          :id="`${suggestionsId}-${index}`"
          :key="suggestion.channelId"
          class="commentComposerSuggestion"
          :class="{ active: index === activeSuggestion }"
          role="option"
          tabindex="-1"
          :aria-selected="index === activeSuggestion"
          @pointerdown.prevent
          @click="insertMention(suggestion)"
        >
          <FtRetryImage
            :src="suggestion.thumbnail"
            :fallback-icon="['fas', 'circle-user']"
            class="commentComposerSuggestionImage"
            alt=""
          />
          <span class="commentComposerSuggestionHandle">{{ suggestion.handle }}</span>
        </li>
      </ul>
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
          :disabled="posting || text.trim() === '' || (editComment !== null && submitText === originalSubmitText)"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtRetryImage from '../FtRetryImage.vue'

import store from '../../store/index'
import { getSelectedYouTubeProfile } from '../../helpers/youtube-account-state'
import { openButtonMenu } from '../../helpers/buttonMenu'
import { useYouTubeProfileSwitch } from '../../composables/useYouTubeProfileSwitch'

import { ERROR_TOAST_ICON, showToast } from '../../helpers/utils'
import { editYouTubeComment, postYouTubeComment } from '../../helpers/api/youtube-account'
import { trackCommentReplies } from '../../helpers/commentReplyNotifications'
import { MENTION_START, findCommentMentions, getCommentEditDraft, getCommentSubmitText, getRootCommentId, youTubeCommentsKey } from './youTubeComments'

const props = defineProps({
  // Posts a reply to this top-level comment instead of a new comment.
  parentId: { type: String, default: null },
  // Starts a reply to a reply with a mention of its author.
  /** @type {import('vue').PropType<import('./youTubeComments').CommentMention | null>} */
  initialMention: { type: Object, default: null },
  // Edits this comment or reply of the account instead of posting a new one.
  editComment: { type: Object, default: null }
})
const emit = defineEmits(['done'])
const { t } = useI18n()
const comments = inject(youTubeCommentsKey)

const draft = props.editComment
  ? getCommentEditDraft(props.editComment)
  : { text: props.initialMention ? `${props.initialMention.handle} ` : '', mentions: props.initialMention ? [props.initialMention] : [] }
const text = ref(draft.text)
/** The channels picked for mentions, which stay mentions while their handles are in the text. */
const mentions = ref(draft.mentions)
const mentionRanges = computed(() => findCommentMentions(text.value, mentions.value))
const submitText = computed(() => getCommentSubmitText(text.value.trim(), mentions.value))
const originalSubmitText = getCommentSubmitText(draft.text.trim(), draft.mentions)
const posting = ref(false)
const input = useTemplateRef('input')
const profile = computed(() => getSelectedYouTubeProfile(store.getters.getYouTubeAccount))
const isTopLevel = !props.parentId && !props.editComment

const { switching, switchProfile } = useYouTubeProfileSwitch()
const profiles = computed(() => store.getters.getYouTubeAccount?.profiles ?? [])
const canSwitchProfile = computed(() => profiles.value.length > 1)
const profileMenuItems = computed(() => profiles.value.map(entry => ({
  label: entry.handle ? `${entry.name} (${entry.handle})` : entry.name,
  // An image, or the fallback icon without one.
  icon: entry.thumbnail ?? '',
  fallbackIcon: ['fas', 'circle-user'],
  roundIcon: true,
  type: 'radio',
  checked: entry === profile.value,
  enabled: !switching.value,
  run: () => { if (entry !== profile.value) switchProfile(entry) }
})))

/** @param {HTMLElement} button */
function openProfileMenu(button) {
  openButtonMenu(button, profileMenuItems, t('YouTube Account.Switch Channel'))
}
// Like on YouTube, a new comment starts as a single line that opens the
// editor. Replies and edits open from their buttons, so they start open.
const expanded = ref(!isTopLevel)

async function expand() {
  expanded.value = true
  await nextTick()
  input.value?.focus?.()
}

// Like on YouTube, typing @ suggests people from the comments, and a picked
// mention is a link that the caret skips and Backspace removes whole.
const suggestionsId = useId()
const caret = ref(text.value.length)
const dismissedQueryStart = ref(-1)
const activeSuggestion = ref(0)
const threadId = props.parentId ?? (props.editComment ? getRootCommentId(props.editComment.id) : null)

const mentionQuery = computed(() => {
  const match = /@([^\s@]{0,30})$/u.exec(text.value.slice(0, caret.value))
  if (!match) return null
  const start = caret.value - match[1].length - 1
  if (!MENTION_START.test(text.value.slice(Math.max(0, start - 1), start))) return null
  if (start === dismissedQueryStart.value || mentionRanges.value.some(range => start >= range.start && start < range.end)) return null
  return { start, query: match[1].toLowerCase() }
})

const suggestions = computed(() => {
  const query = mentionQuery.value?.query
  if (query === undefined) return []
  const matches = comments.getMentionCandidates(threadId)
    .filter(candidate => candidate.handle.slice(1).toLowerCase().includes(query))
  return matches
    .filter(candidate => candidate.handle.slice(1).toLowerCase().startsWith(query))
    .concat(matches.filter(candidate => !candidate.handle.slice(1).toLowerCase().startsWith(query)))
    .slice(0, 6)
})
watch(suggestions, () => { activeSuggestion.value = 0 })

function getTextarea() {
  return root.value?.querySelector('textarea') ?? null
}

/** @param {string} value */
function handleInput(value) {
  text.value = value
  // A deleted mention's handle typed again stays plain text until picked.
  if (mentionRanges.value.length < mentions.value.length) {
    mentions.value = mentions.value.filter(mention => mentionRanges.value.some(range => range.mention === mention))
  }
  // A new @ in place of a dismissed one suggests again.
  if (value[dismissedQueryStart.value] !== '@') dismissedQueryStart.value = -1
  updateCaret()
}

// The caret skips over mentions.
function updateCaret() {
  const textarea = getTextarea()
  if (!textarea) return
  const { selectionStart, selectionEnd } = textarea
  if (selectionStart === selectionEnd) {
    const range = mentionRanges.value.find(({ start, end }) => selectionStart > start && selectionStart < end)
    if (range) {
      const edge = selectionStart - range.start < range.end - selectionStart ? range.start : range.end
      textarea.setSelectionRange(edge, edge)
    }
  }
  caret.value = textarea.selectionEnd
}

/**
 * Edits like typing does, so undo still works.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
function replaceText(textarea, start, end, replacement) {
  textarea.setSelectionRange(start, end)
  if (!document.execCommand(replacement === '' ? 'delete' : 'insertText', false, replacement)) {
    textarea.setRangeText(replacement, start, end, 'end')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/** @param {import('./youTubeComments').MentionCandidate} candidate */
function insertMention({ handle, channelId }) {
  const textarea = getTextarea()
  const query = mentionQuery.value
  if (!textarea || !query) return
  if (!mentions.value.some(mention => mention.handle === handle)) {
    mentions.value = [...mentions.value, { handle, channelId }]
  }
  textarea.focus()
  replaceText(textarea, query.start, caret.value, `${handle} `)
}

/** @param {KeyboardEvent} event */
function handleKeydown(event) {
  const textarea = event.target
  if (event.isComposing || !(textarea instanceof HTMLTextAreaElement)) return

  const count = suggestions.value.length
  if (count > 0) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      activeSuggestion.value = (activeSuggestion.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      insertMention(suggestions.value[activeSuggestion.value])
    } else if (event.key === 'Escape') {
      dismissedQueryStart.value = mentionQuery.value.start
    } else {
      return handleMentionKey(event, textarea)
    }
    event.preventDefault()
    return
  }
  handleMentionKey(event, textarea)
}

/**
 * @param {KeyboardEvent} event
 * @param {HTMLTextAreaElement} textarea
 */
function handleMentionKey(event, textarea) {
  const { selectionStart, selectionEnd } = textarea
  const ranges = mentionRanges.value
  // Deleting part of a mention deletes all of it.
  if (selectionStart !== selectionEnd && (event.key === 'Backspace' || event.key === 'Delete')) {
    const start = ranges.find(range => range.start < selectionStart && range.end > selectionStart)?.start ?? selectionStart
    const end = ranges.find(range => range.start < selectionEnd && range.end > selectionEnd)?.end ?? selectionEnd
    textarea.setSelectionRange(start, end)
    return
  }
  if (selectionStart !== selectionEnd || event.shiftKey || event.altKey || event.metaKey) return
  /** @type {{ start: number, end: number } | undefined} */
  let range
  if (event.key === 'Backspace' && (range = ranges.find(({ end }) => end === selectionStart))) {
    replaceText(textarea, range.start, range.end, '')
  } else if (event.key === 'Delete' && (range = ranges.find(({ start }) => start === selectionStart))) {
    replaceText(textarea, range.start, range.end, '')
  } else if (event.key === 'ArrowLeft' && !event.ctrlKey && (range = ranges.find(({ end }) => end === selectionStart))) {
    textarea.setSelectionRange(range.start, range.start)
  } else if (event.key === 'ArrowRight' && !event.ctrlKey && (range = ranges.find(({ start }) => start === selectionStart))) {
    textarea.setSelectionRange(range.end, range.end)
  } else {
    return
  }
  event.preventDefault()
  caret.value = textarea.selectionEnd
}

function cancel() {
  clearDraft()
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
  const usedMentions = getUsedMentions(commentText)

  posting.value = true
  // The comment belongs to the channel in use now, even after a switch while it posts.
  const account = store.getters.getYouTubeAccount
  try {
    const created = await postYouTubeComment(comments.videoId.value, getCommentSubmitText(commentText, usedMentions), props.parentId ?? undefined, account)
    // Loaded replies are `parentId.replyId`, which a posted reply's ID may lack.
    const posted = props.parentId && !created.id.includes('.') ? { ...created, id: `${props.parentId}.${created.id}` } : created
    comments.addComment(posted, commentText, usedMentions, props.parentId, account)
    trackCommentReplies(comments.videoId.value, props.parentId ?? posted.id, posted.id, account, commentText, comments.videoTitle.value)
    clearDraft()
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

// The top-level comment box stays for the next comment.
function clearDraft() {
  text.value = ''
  mentions.value = []
  dismissedQueryStart.value = -1
}

/** @param {string} commentText */
function getUsedMentions(commentText) {
  return [...new Set(findCommentMentions(commentText, mentions.value).map(range => range.mention))]
}

/** @param {string} commentText */
async function saveEdit(commentText) {
  posting.value = true
  const commentId = props.editComment.id
  try {
    const usedMentions = getUsedMentions(commentText)
    await editYouTubeComment(comments.videoId.value, commentId, getCommentSubmitText(commentText, usedMentions), store.getters.getYouTubeAccount)
    comments.updateComment(commentId, commentText, usedMentions)
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
  display: flex;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
}

button.commentComposerAvatar {
  cursor: pointer;
}

button.commentComposerAvatar:disabled {
  cursor: default;
  opacity: 0.6;
}

button.commentComposerAvatar:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.commentComposerAvatarImage {
  block-size: 40px;
  border-radius: 50%;
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

.commentComposerSuggestions {
  display: flex;
  flex-direction: column;
  max-inline-size: 320px;
  margin: 0;
  padding-block: 4px;
  padding-inline: 4px;
  border-radius: var(--shape-corner-large);
  list-style: none;

  /* Matches the select menus. */
  box-shadow: 0 2px 6px 2px rgb(0 0 0 / 15%), 0 1px 2px rgb(0 0 0 / 30%);
  background-color: color-mix(in srgb, var(--primary-color) 4%, var(--card-bg-color));
}

.commentComposerSuggestion {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-block: 6px;
  padding-inline: 8px;
  border-radius: var(--shape-corner-medium);
  cursor: pointer;
}

.commentComposerSuggestion:hover,
.commentComposerSuggestion.active {
  background-color: var(--dropdown-item-hover-color);
  color: var(--dropdown-item-hover-text-color);
}

.commentComposerSuggestionImage {
  flex: none;
  block-size: 24px;
  border-radius: 50%;
  font-size: 24px;
  inline-size: 24px;
  object-fit: cover;
}

.commentComposerSuggestionHandle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commentComposerActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
