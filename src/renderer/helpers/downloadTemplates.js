/**
 * The download templates that ship with the app. Shared between the download
 * prompt, which applies them, and the downloads page, which names the one a
 * finished download was started with.
 *
 * @typedef DownloadTemplate
 * @property {string} value
 * @property {(t: (key: string, values?: object) => string) => string} label
 * @property {object} options the options that differ from the defaults
 */

/** @type {DownloadTemplate[]} */
export const DEFAULT_DOWNLOAD_TEMPLATES = [
  { value: 'video:best', label: t => t('Downloads.Templates.Video Best'), options: {} },
  { value: 'video:best:mp4', label: t => `${t('Downloads.Templates.Video Best')} (MP4)`, options: { videoFormat: 'mp4' } },
  { value: 'video:1080', label: t => t('Downloads.Templates.Video Resolution', { resolution: '1080p' }), options: { quality: '1080' } },
  { value: 'video:1080:mp4', label: t => `${t('Downloads.Templates.Video Resolution', { resolution: '1080p' })} (MP4)`, options: { quality: '1080', videoFormat: 'mp4' } },
  { value: 'video:720', label: t => t('Downloads.Templates.Video Resolution', { resolution: '720p' }), options: { quality: '720' } },
  { value: 'video:720:mp4', label: t => `${t('Downloads.Templates.Video Resolution', { resolution: '720p' })} (MP4)`, options: { quality: '720', videoFormat: 'mp4' } },
  { value: 'video:480', label: t => t('Downloads.Templates.Video Resolution', { resolution: '480p' }), options: { quality: '480' } },
  { value: 'video:480:mp4', label: t => `${t('Downloads.Templates.Video Resolution', { resolution: '480p' })} (MP4)`, options: { quality: '480', videoFormat: 'mp4' } },
  { value: 'audio:best', label: t => t('Downloads.Templates.Audio Best'), options: { mode: 'audio', embedThumbnail: true, embedMetadata: true } },
  { value: 'audio:mp3', label: t => t('Downloads.Templates.Audio Format', { format: 'MP3' }), options: { mode: 'audio', audioFormat: 'mp3', embedThumbnail: true, embedMetadata: true } },
  { value: 'subtitles:srt', label: t => t('Downloads.Templates.Subtitles Format', { format: 'SRT' }), options: { mode: 'subtitles', subtitleFormat: 'srt' } },
  { value: 'subtitles:vtt', label: t => t('Downloads.Templates.Subtitles Format', { format: 'VTT' }), options: { mode: 'subtitles', subtitleFormat: 'vtt' } }
]

/**
 * @param {string} value
 * @param {(key: string, values?: object) => string} t
 * @returns {string} empty when the download wasn't started from a template
 */
export function downloadTemplateName(value, t) {
  if (typeof value !== 'string' || value === '') {
    return ''
  }

  const defaultTemplate = DEFAULT_DOWNLOAD_TEMPLATES.find(template => template.value === value)
  if (defaultTemplate) {
    return defaultTemplate.label(t)
  }

  // custom templates are stored as `template:<the name the user gave it>`
  return value.startsWith('template:') ? value.slice('template:'.length) : ''
}
