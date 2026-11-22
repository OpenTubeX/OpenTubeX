/**
 * Keeps the comment UI and saved pins on the same attachment shape.
 * @param {import('youtubei.js').YTNodes.CommentImageAttachmentView | null | undefined} attachment
 */
export function parseLocalCommentImageAttachment(attachment) {
  if (!attachment) return undefined

  return {
    width: attachment.width,
    height: attachment.height,
    image: { sources: attachment.image },
    unavailableText: attachment.unavailable_text,
    rendererContext: {
      accessibilityContext: { label: attachment.renderer_context?.accessibility_context?.label }
    }
  }
}

/**
 * Marks the threads made from flat replies. Unlike nested replies, they come
 * in one list without their parents, so they nest by their mentions instead.
 */
export const FLAT_REPLY_RENDERING_PRIORITY = 'RENDERING_PRIORITY_FLAT_REPLY'

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
  return item.commentViewModel
    ? { commentThreadRenderer: { commentViewModel: item, renderingPriority: FLAT_REPLY_RENDERING_PRIORITY } }
    : item
}

/**
 * @param {Response} response
 * @param {(data: object) => void} [onResponse] receives the JSON response before it is normalized
 */
export async function normalizeCommentFetchResponse(response, onResponse = undefined) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // The session data (`/sw.js_data`) is JSON behind a `)]}'` prefix. Failing
    // here would make youtubei.js generate the session locally, and YouTube
    // serves such sessions their replies flat, without the replied-to reply.
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  onResponse?.(data)
  normalizeCommentResponse(data)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers })
}

/**
 * Only the mobile apps offer the Timed sort, so web sessions have no sort
 * button to follow and the comment section's continuation has to be built
 * (GetCommentsSectionParams with sort 2).
 * @param {string} videoId
 */
export function getTimedCommentsContinuation(videoId) {
  const field = (tag, bytes) => [tag, bytes.length, ...bytes]
  const text = value => Array.from(new TextEncoder().encode(value))
  const options = [...field(0x22, text(videoId)), 0x30, 2, 0x78, 2]
  const params = [...field(0x22, options), ...field(0x42, text('comments-section'))]
  const bytes = [...field(0x12, field(0x12, text(videoId))), 0x18, 6, ...field(0x32, params)]
  return encodeURIComponent(btoa(String.fromCharCode(...bytes)))
}

/**
 * Pairs the comments of a Timed response with the video time they belong to.
 * The timed list also holds welcome and end messages, which have no comment.
 * @param {object} data
 * @returns {{ seconds: number, comment: object, toolbarState: object | undefined }[]}
 */
export function getTimedCommentPayloads(data) {
  const payloads = (data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? []).map(mutation => mutation.payload ?? {})
  const comments = new Map()
  const toolbarStates = new Map()
  for (const payload of payloads) {
    if (payload.commentEntityPayload) comments.set(payload.commentEntityPayload.properties?.commentId, payload.commentEntityPayload)
    if (payload.engagementToolbarStateEntityPayload) toolbarStates.set(payload.engagementToolbarStateEntityPayload.key, payload.engagementToolbarStateEntityPayload)
  }

  return payloads
    .flatMap(payload => payload.timedMarkersListSyncEntity?.timedListData?.sections ?? [])
    .flatMap(section => section.timedSyncDataList ?? [])
    .filter(item => comments.has(item.syncItemId))
    .map(item => {
      const comment = comments.get(item.syncItemId)
      for (const run of comment.properties.content?.commandRuns ?? []) {
        addWebCommandMetadata(run.onTap?.innertubeCommand)
      }
      return {
        seconds: Number(item.videoTimeMs) / 1000,
        comment,
        toolbarState: toolbarStates.get(comment.properties.toolbarStateKey)
      }
    })
    .sort((first, second) => first.seconds - second.seconds)
}

/**
 * Android comment links lack the web metadata that youtubei.js reads link
 * types and URLs from. External links keep their URL in the urlEndpoint.
 * @param {object | undefined} command
 */
function addWebCommandMetadata(command) {
  if (!command || command.commandMetadata) return

  let webCommandMetadata
  if (command.watchEndpoint) {
    const { videoId, startTimeSeconds } = command.watchEndpoint
    webCommandMetadata = {
      url: `/watch?v=${videoId}${startTimeSeconds ? `&t=${startTimeSeconds}s` : ''}`,
      webPageType: 'WEB_PAGE_TYPE_WATCH'
    }
  } else if (command.browseEndpoint) {
    const { browseId, canonicalBaseUrl } = command.browseEndpoint
    webCommandMetadata = {
      url: canonicalBaseUrl ?? `/channel/${browseId}`,
      webPageType: browseId?.startsWith('UC') ? 'WEB_PAGE_TYPE_CHANNEL' : 'WEB_PAGE_TYPE_BROWSE'
    }
  }
  if (webCommandMetadata) command.commandMetadata = { webCommandMetadata }
}
