import { computed, nextTick, ref, toRaw } from 'vue'

import { buildReplyTree } from '../../../helpers/comment-replies'

const COMMENT_TIMESTAMP_PATTERN = /(?:(?:\d+):)?\d+:\d+/

const filteredCommentThreadLineObservers = new WeakMap()

function updateFilteredCommentThreadLine(element, filtering) {
  if (!filtering) {
    element.style.removeProperty('--filtered-comment-thread-line-inset-block-end')
    return
  }

  const connectors = element.querySelectorAll(
    ':scope > .commentReplies > .commentReplyBranchRoot > .commentReplyConnector'
  )
  const lastConnector = connectors.item(connectors.length - 1)
  if (!lastConnector) {
    element.style.removeProperty('--filtered-comment-thread-line-inset-block-end')
    return
  }

  const inset = element.getBoundingClientRect().bottom - lastConnector.getBoundingClientRect().top
  element.style.setProperty('--filtered-comment-thread-line-inset-block-end', `${inset}px`)
}

function observeFilteredCommentThreadLine(element, filtering) {
  const state = filteredCommentThreadLineObservers.get(element)
  if (!state) return

  if (!filtering) {
    state.observer?.disconnect()
    state.observer = null
    updateFilteredCommentThreadLine(element, false)
    return
  }

  if (!state.observer) {
    state.observer = new ResizeObserver(() => {
      updateFilteredCommentThreadLine(element, true)
    })
    state.observer.observe(element)
  }
  updateFilteredCommentThreadLine(element, true)
}

export const vFilteredCommentThreadLine = {
  mounted(element, binding) {
    filteredCommentThreadLineObservers.set(element, { observer: null })
    observeFilteredCommentThreadLine(element, binding.value)
  },
  updated(element, binding) {
    observeFilteredCommentThreadLine(element, binding.value)
  },
  unmounted(element) {
    filteredCommentThreadLineObservers.get(element)?.observer?.disconnect()
    filteredCommentThreadLineObservers.delete(element)
  }
}

/**
 * Search, creator and timestamp filters for the loaded comments, and the
 * threads and replies they leave visible, with personally pinned ones first.
 *
 * @param {{ commentEntries: import('vue').ComputedRef<{ comment: object, index: number | null }[]>, commentFilterMenu: import('vue').ShallowRef<{ focusTrigger: () => void } | null>, commentSearch: import('vue').ShallowRef<HTMLElement | null>, commentTreeHasPersonalPin: (comment: object) => boolean, isReplyLoading: (commentId: string) => boolean, onFiltersChanged: () => void, sortReplyNodesByPersonalPins: (nodes: object[]) => object[] }} options
 */
export function useCommentFilters({
  commentEntries,
  commentFilterMenu,
  commentSearch,
  commentTreeHasPersonalPin,
  isReplyLoading,
  onFiltersChanged,
  sortReplyNodesByPersonalPins
}) {
  const commentSearchOpen = ref(false)
  const commentSearchQuery = ref('')
  const commentFilterMenuOpen = ref(false)
  const creatorCommentsOnly = ref(false)
  const timestampCommentsOnly = ref(false)

  // Filtering re-parses every loaded comment on each keystroke; keep the plain
  // text per comment object until its HTML changes.
  const commentPlainTextCache = new WeakMap()

  function getCommentPlainText(comment) {
    const text = comment.text ?? ''
    const cacheKey = toRaw(comment)
    const cached = commentPlainTextCache.get(cacheKey)
    if (cached !== undefined && cached.text === text) {
      return cached.plainText
    }

    const document = new DOMParser().parseFromString(text, 'text/html')
    const plainText = document.body.textContent ?? ''
    commentPlainTextCache.set(cacheKey, { text, plainText })
    return plainText
  }

  function getCommentSearchText(comment) {
    return `${comment.author ?? ''} ${getCommentPlainText(comment)}`.toLocaleLowerCase()
  }

  const normalizedCommentSearchQuery = computed(() => {
    return commentSearchQuery.value.trim().toLocaleLowerCase()
  })

  const hasActiveCommentFilters = computed(() => {
    return normalizedCommentSearchQuery.value !== '' ||
      creatorCommentsOnly.value ||
      timestampCommentsOnly.value
  })

  function commentMatchesActiveFilters(comment) {
    if (creatorCommentsOnly.value && !comment.isOwner && !comment.hasOwnerReplied) {
      return false
    }

    if (timestampCommentsOnly.value && !COMMENT_TIMESTAMP_PATTERN.test(getCommentPlainText(comment))) {
      return false
    }

    return normalizedCommentSearchQuery.value === '' ||
      getCommentSearchText(comment).includes(normalizedCommentSearchQuery.value)
  }

  function filterReplyNodes(nodes) {
    return sortReplyNodesByPersonalPins(nodes.flatMap(node => {
      const children = filterReplyNodes(node.children)
      if (!commentMatchesActiveFilters(node.reply) && children.length === 0) {
        return []
      }

      return [{ ...node, children }]
    }))
  }

  function getVisibleReplyNodes(comment) {
    const nodes = buildReplyTree(comment)
    return hasActiveCommentFilters.value
      ? filterReplyNodes(nodes)
      : sortReplyNodesByPersonalPins(nodes)
  }

  const visibleCommentEntries = computed(() => {
    return commentEntries.value
      .map(({ comment, index }) => ({
        comment,
        index,
        replyNodes: getVisibleReplyNodes(comment)
      }))
      .filter(({ comment, replyNodes }) => {
        return !hasActiveCommentFilters.value ||
          commentMatchesActiveFilters(comment) ||
          replyNodes.length > 0
      })
      .sort(({ comment: first }, { comment: second }) => {
        return Number(commentTreeHasPersonalPin(second)) - Number(commentTreeHasPersonalPin(first))
      })
  })

  function countLoadedComments(comment) {
    return 1 + comment.replies.reduce((count, reply) => count + countLoadedComments(reply), 0)
  }

  function countMatchingComments(comment) {
    return Number(commentMatchesActiveFilters(comment)) +
      comment.replies.reduce((count, reply) => count + countMatchingComments(reply), 0)
  }

  const loadedCommentCount = computed(() => {
    return commentEntries.value.reduce((count, { comment }) => count + countLoadedComments(comment), 0)
  })

  const matchingCommentCount = computed(() => {
    if (!hasActiveCommentFilters.value) {
      return loadedCommentCount.value
    }

    return commentEntries.value.reduce((count, { comment }) => count + countMatchingComments(comment), 0)
  })

  function shouldLoadFilteredCreatorReplies(comment, replyNodes) {
    return creatorCommentsOnly.value &&
      comment.hasOwnerReplied &&
      replyNodes.length === 0
  }

  function shouldShowCommentReplyToggle(comment, replyNodes) {
    if (comment.numReplies <= 0 || comment.showReplies) {
      return false
    }

    return !hasActiveCommentFilters.value || shouldLoadFilteredCreatorReplies(comment, replyNodes)
  }

  function shouldShowCommentReplyContinuation(comment, replyNodes) {
    const canLoadMore = isReplyLoading(comment.id) || comment.hasReplyToken
    return canLoadMore && (
      !hasActiveCommentFilters.value || shouldLoadFilteredCreatorReplies(comment, replyNodes)
    )
  }

  function shouldShowCommentReplies(comment, replyNodes) {
    return (replyNodes.length > 0 && (comment.showReplies || hasActiveCommentFilters.value)) ||
      (comment.showReplies && shouldShowCommentReplyContinuation(comment, replyNodes))
  }

  function getCommentAuthorSearchSegments(author) {
    const query = normalizedCommentSearchQuery.value
    if (query === '') {
      return [{ text: author, highlighted: false }]
    }

    const normalizedAuthor = author.toLocaleLowerCase()
    const segments = []
    let start = 0
    let matchIndex = normalizedAuthor.indexOf(query)

    while (matchIndex !== -1) {
      if (matchIndex > start) {
        segments.push({ text: author.slice(start, matchIndex), highlighted: false })
      }
      segments.push({
        text: author.slice(matchIndex, matchIndex + query.length),
        highlighted: true
      })
      start = matchIndex + query.length
      matchIndex = normalizedAuthor.indexOf(query, start)
    }

    if (start < author.length) {
      segments.push({ text: author.slice(start), highlighted: false })
    }

    return segments
  }

  function updateCommentSearchQuery(query) {
    commentSearchQuery.value = query
    onFiltersChanged()
  }

  function toggleCommentSearch() {
    commentSearchOpen.value = !commentSearchOpen.value
    commentFilterMenuOpen.value = false

    if (!commentSearchOpen.value) {
      updateCommentSearchQuery('')
      nextTick(() => commentFilterMenu.value?.focusTrigger())
      return
    }

    nextTick(() => commentSearch.value?.querySelector('input')?.focus())
  }

  function closeCommentSearch() {
    commentSearchOpen.value = false
    updateCommentSearchQuery('')
    nextTick(() => commentFilterMenu.value?.focusTrigger())
  }

  function toggleCreatorCommentsFilter() {
    creatorCommentsOnly.value = !creatorCommentsOnly.value
    onFiltersChanged()
  }

  function toggleTimestampCommentsFilter() {
    timestampCommentsOnly.value = !timestampCommentsOnly.value
    onFiltersChanged()
  }

  function resetCommentFilters() {
    commentFilterMenuOpen.value = false
    creatorCommentsOnly.value = false
    timestampCommentsOnly.value = false
    commentSearchOpen.value = false
    commentSearchQuery.value = ''
  }

  return {
    closeCommentSearch,
    commentFilterMenuOpen,
    commentSearchOpen,
    commentSearchQuery,
    creatorCommentsOnly,
    getCommentAuthorSearchSegments,
    hasActiveCommentFilters,
    loadedCommentCount,
    matchingCommentCount,
    normalizedCommentSearchQuery,
    resetCommentFilters,
    shouldShowCommentReplies,
    shouldShowCommentReplyContinuation,
    shouldShowCommentReplyToggle,
    timestampCommentsOnly,
    toggleCommentSearch,
    toggleCreatorCommentsFilter,
    toggleTimestampCommentsFilter,
    updateCommentSearchQuery,
    visibleCommentEntries
  }
}
