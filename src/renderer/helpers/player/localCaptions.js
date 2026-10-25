/** Subtitle files that can be loaded for a video, as file picker types */
export const LOCAL_CAPTION_FILE_TYPES = Object.freeze({
  'text/vtt': '.vtt',
  'application/x-subrip': '.srt',
})

/** The MIME types Shaka's text parsers are registered for */
const MIME_TYPES_BY_EXTENSION = Object.freeze({
  vtt: 'text/vtt',
  srt: 'text/srt',
})

/**
 * Shaka's SRT parser only reads comma milliseconds and splits cues on empty lines,
 * other players also accept dot milliseconds and blank lines with spaces.
 * @param {string} fileName
 * @param {string} text
 */
export function normalizeLocalCaptionText(fileName, text) {
  if (!fileName.toLowerCase().endsWith('.srt')) {
    return text
  }

  return text
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/^[ \t]+$/gm, '')
    .replaceAll(/^.*-->.*$/gm, line => line.replaceAll(/(\d+:\d{2})\.(\d+)/g, '$1,$2'))
}

/**
 * Creates a caption for a subtitle file the user picked, its contents are kept in a data URL so they never leave the device.
 * @param {string} fileName
 * @param {string} text
 * @param {string[]} usedLabels labels of the video's other caption tracks, the new one gets a distinct label
 * @returns {{ url: string, label: string, language: string, mimeType: string } | null} null for unsupported file types
 */
export function createLocalCaption(fileName, text, usedLabels) {
  const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : ''
  const mimeType = MIME_TYPES_BY_EXTENSION[extension]

  if (!mimeType) {
    return null
  }

  let label = fileName
  for (let copy = 2; usedLabels.includes(label); copy++) {
    label = `${fileName} (${copy})`
  }

  return {
    url: `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`,
    label,
    language: 'und',
    mimeType,
  }
}
