import { randomUUID } from 'crypto'

// Previews are lossy tolerant screenshots, and JPEG stores them at roughly a
// third of the PNG size, which pays for capturing them at a sharp resolution.
export const TAB_PREVIEW_JPEG_QUALITY = 82
export const TAB_PREVIEW_FILE_EXTENSION = '.jpg'
// `.png` is still accepted so caches written by older versions keep working.
const TAB_PREVIEW_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png)$/i
const TAB_PREVIEW_DATA_URL_PATTERN = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/
const PNG_MAGIC = 0x89504e47

/**
 * @param {unknown} value
 * @returns {string | null} the file name, or null when it is not one of ours
 */
export function normalizeTabPreviewFileName(value) {
  return typeof value === 'string' && TAB_PREVIEW_FILE_PATTERN.test(value)
    ? value
    : null
}

/**
 * @returns {string}
 */
export function createTabPreviewFileName() {
  return randomUUID() + TAB_PREVIEW_FILE_EXTENSION
}

/**
 * Whether a cached file can be overwritten in place, which is only true when
 * its extension matches what this version writes.
 * @param {string | null} fileName
 * @returns {boolean}
 */
export function isReusableTabPreviewFileName(fileName) {
  return typeof fileName === 'string' && fileName.toLowerCase().endsWith(TAB_PREVIEW_FILE_EXTENSION)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTabPreviewDataUrl(value) {
  return typeof value === 'string' && TAB_PREVIEW_DATA_URL_PATTERN.test(value)
}

/**
 * @param {unknown} dataUrl
 * @returns {Buffer | null}
 */
export function tabPreviewDataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return null
  }

  const match = dataUrl.match(TAB_PREVIEW_DATA_URL_PATTERN)
  return match ? Buffer.from(match[1], 'base64') : null
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
export function tabPreviewBufferToDataUrl(buffer) {
  // Caches can hold PNGs written by older versions, so the type comes from the
  // file's magic bytes rather than from what this version writes.
  const isPng = buffer.length >= 4 && buffer.readUInt32BE(0) === PNG_MAGIC
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,` + buffer.toString('base64')
}

/**
 * Picks the cached previews that no tab refers to any more. Tabs delete their
 * own preview when they close, so these are the ones left behind by a crash or
 * a forced quit, with nothing left to point at them.
 *
 * Anything that is not a preview file name is left alone rather than deleted,
 * so an unrelated file that ends up in the directory survives.
 * @param {Iterable<string>} fileNames directory listing
 * @param {Iterable<unknown>} referencedFileNames names still in use
 * @returns {string[]}
 */
export function selectOrphanedTabPreviews(fileNames, referencedFileNames) {
  const referenced = new Set()
  for (const fileName of referencedFileNames) {
    const normalized = normalizeTabPreviewFileName(fileName)
    if (normalized != null) {
      referenced.add(normalized.toLowerCase())
    }
  }

  return Array.from(fileNames).filter(fileName => (
    normalizeTabPreviewFileName(fileName) != null && !referenced.has(fileName.toLowerCase())
  ))
}
