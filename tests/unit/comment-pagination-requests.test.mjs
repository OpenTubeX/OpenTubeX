import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const component = await readFile(new URL('../../src/renderer/components/CommentSection/CommentSection.vue', import.meta.url), 'utf8')

function slice(start, end) {
  const from = component.indexOf(start)
  const to = component.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `Update the harness after changing the boundaries of ${start}`)
  return component.slice(from, to)
}

const handlers = [
  slice('function handleSortChange(', 'function handleFullscreenActionsFocusout('),
  slice('async function getCommentData()', '/** @typedef'),
  slice('async function getCommentDataInvidious()', '/**\n * @param {number} index\n * @param {string | null} commentId\n * @param {string | null} replyTokenOverride')
].join('\n')

function deferred() {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function createComments() {
  const requests = []
  const notices = []
  const state = {
    sortNewest: { value: false },
    commentData: { value: [] },
    nextPageToken: { value: null },
    moreCommentsLoadFailed: { value: false },
    isLoading: { value: false },
    isLoadingMoreComments: { value: false },
    loadingReplyIds: { value: new Set() },
    showComments: { value: false },
    areCommentsDisabled: { value: false }
  }
  const context = {
    ...state,
    props: { id: 'video', offline: false, isPostComments: false },
    canPerformInitialCommentLoading: { get value() { return state.commentData.value.length === 0 && !state.isLoading.value } },
    backendPreference: { value: 'invidious' },
    backendFallback: { value: true },
    replyTokens: new Map(),
    closeCommentMenus: () => {},
    resetCommentsScroll: () => {},
    armHighlightedCommentScroll: async () => {},
    setCommentCount: () => {},
    prioritizeHighlightedComment: comments => comments,
    withLocalCommentChanges: comments => comments,
    invidiousGetComments: (options) => {
      const request = deferred()
      requests.push({ options, request })
      return request.promise
    },
    getCommentDataLocal: async () => notices.push('local fallback'),
    getPostCommentsInvidious: async () => {},
    usesInvidiousApi: backend => backend === 'invidious',
    getInvidiousApiErrorMessage: () => 'Invidious API Error',
    showApiErrorToast: () => notices.push('error toast'),
    showInvidiousFallbackToast: () => notices.push('fallback toast'),
    showToast: () => {},
    t: text => text,
    console: { error: () => {} },
    process: { env: { SUPPORTS_LOCAL_API: true } }
  }
  const api = vm.runInNewContext(`
    let commentListGeneration = 0
    let automaticInitialLoadFailed = false
    let localCommentsInstance
    ${handlers}
    ;({ getCommentData, getMoreComments, handleSortChange })
  `, context)
  const page = (ids, continuation) => ({ response: { commentCount: 10, continuation }, commentData: ids.map(id => ({ id })) })
  return { ...api, state, requests, notices, page }
}

const ids = comments => comments.value.map(comment => comment.id).join(',')

test('a page of the previous sort order cannot join the new results', async () => {
  const comments = createComments()
  const initial = comments.getCommentData()
  comments.requests[0].request.resolve(comments.page(['top-1'], 'top-page-2'))
  await initial

  comments.getMoreComments()
  const resorted = comments.handleSortChange('newest')
  comments.requests[2].request.resolve(comments.page(['new-1'], 'new-page-2'))
  await resorted
  comments.requests[1].request.resolve(comments.page(['top-2'], 'top-page-3'))
  await new Promise(setImmediate)

  assert.equal(ids(comments.state.commentData), 'new-1')
  assert.equal(comments.state.nextPageToken.value, 'new-page-2')
  assert.equal(comments.state.isLoadingMoreComments.value, false)
})

test('a failed page keeps the loaded comments and waits for a retry', async () => {
  const comments = createComments()
  const initial = comments.getCommentData()
  comments.requests[0].request.resolve(comments.page(['top-1'], 'top-page-2'))
  await initial

  comments.getMoreComments()
  comments.requests[1].request.reject(new Error('Pagination failed'))
  await new Promise(setImmediate)

  assert.equal(ids(comments.state.commentData), 'top-1')
  assert.equal(comments.state.moreCommentsLoadFailed.value, true, 'automatic loading stops')
  assert.deepEqual(comments.notices, ['error toast'], 'no backend fallback restarts the list')

  comments.getMoreComments()
  assert.equal(comments.state.moreCommentsLoadFailed.value, false)
  comments.requests[2].request.resolve(comments.page(['top-2'], null))
  await new Promise(setImmediate)
  assert.equal(ids(comments.state.commentData), 'top-1,top-2')
})
