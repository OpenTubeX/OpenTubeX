/**
 * YouTube serves both flat and nested comment replies. youtubei.js expects
 * nested threads, including in continuation responses, for both variants.
 * @param {object} data
 */
export function normalizeCommentResponse(data) {
  if (!data || typeof data !== 'object') return

  const replies = data.commentRepliesRenderer
  if (replies && !replies.subThreads && Array.isArray(replies.contents)) {
    replies.subThreads = replies.contents.map(asThread)
    delete replies.contents
  }
  for (const key of ['appendContinuationItemsAction', 'reloadContinuationItemsCommand']) {
    const action = data[key]
    if (Array.isArray(action?.continuationItems)) {
      action.continuationItems = action.continuationItems.map(asThread)
    }
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) value.forEach(normalizeCommentResponse)
    else if (value && typeof value === 'object') normalizeCommentResponse(value)
  }
}

function asThread(item) {
  return item.commentViewModel ? { commentThreadRenderer: { commentViewModel: item } } : item
}

/** @param {Response} response */
export async function normalizeCommentFetchResponse(response) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response
  const data = await response.json()
  normalizeCommentResponse(data)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers })
}
