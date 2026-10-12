/**
 * @typedef {object} VideoData
 * @prop {string | null} videoId
 * @prop {string | null} playlistItemId
 * @prop {string | null} [_libraryMemberId]
 * @prop {boolean} [pointerDragging]
 */

/**
 * @callback DragVideo
 * @param {DragEvent} event
 * @param {VideoData} video
 */

/**
 * @callback MoveDraggedVideo
 * @param {VideoData} video
 * @param {VideoData} draggedVideo
 */

/**
 * @callback AfterDrag
 */

/**
 * @typedef {object} EventHandlers
 * @prop {DragVideo} dragVideo
 * @prop {MoveDraggedVideo} moveDraggedVideo
 * @prop {AfterDrag} afterDrag
 */

/**
 * @param {VideoData} left
 * @param {VideoData} right
 * @returns {boolean}
 */
export function isSamePlaylistMember(left, right) {
  // A missing normalized identity cannot identify an occurrence in a list of
  // duplicate legacy pairs. Both sides must carry the same member identity.
  if (left._libraryMemberId != null || right._libraryMemberId != null) return left._libraryMemberId != null && left._libraryMemberId === right._libraryMemberId
  return left.videoId === right.videoId && left.playlistItemId === right.playlistItemId
}

/**
 * @param {(event: string, ...args: object[]) => void} emit
 * @returns {EventHandlers} eventHandlers
 */
export const handleDragAndDrop = (emit) => {
  /**
   * @type {DragVideo}
   */
  const dragVideo = (event, video) => {
    // Use correct drag cursor.
    event.dataTransfer.effectAllowed = 'move'

    // Provide a payload for browsers that require drag data.
    event.dataTransfer.setData('text/plain', '_')

    emit('drag-video', { videoId: video.videoId, playlistItemId: video.playlistItemId, _libraryMemberId: video._libraryMemberId })
  }

  /**
   * @type {MoveDraggedVideo}
   */
  const moveDraggedVideo = (video, draggedVideo) => {
    if (!isSamePlaylistMember(video, draggedVideo)) {
      emit('move-dragged-video', video, draggedVideo)
    }
  }

  /**
   * @type {AfterDrag}
   */
  const afterDrag = () => {
    emit('drag-video-end')
  }

  return {
    dragVideo,
    moveDraggedVideo,
    afterDrag,
  }
}
