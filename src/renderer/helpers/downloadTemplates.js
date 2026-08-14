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
 * Resolves the options stored by a built-in or custom template. Automatic
 * downloads use the same templates as the download prompt, without needing to
 * duplicate their interpretation.
 * @param {string} value
 * @param {{ name?: string, options?: object, args?: string }[]} customTemplates
 * @returns {object | null}
 */
export function getDownloadTemplateOptions(value, customTemplates = []) {
  const defaultTemplate = DEFAULT_DOWNLOAD_TEMPLATES.find(template => template.value === value)
  if (defaultTemplate) {
    return { mode: 'video', ...defaultTemplate.options }
  }

  const customTemplate = customTemplates.find(template => `template:${template.name}` === value)
  if (customTemplate?.options && typeof customTemplate.options === 'object') {
    return { mode: 'video', ...customTemplate.options }
  }
  if (typeof customTemplate?.args === 'string') {
    return { mode: 'video', customArgs: customTemplate.args }
  }

  return null
}

/**
 * Moves per-channel automatic download rules away from a renamed or deleted
 * custom template.
 * @param {string} rulesValue
 * @param {string} oldTemplate
 * @param {string} replacementTemplate
 * @returns {string}
 */
export function replaceAutomaticDownloadTemplateReferences(rulesValue, oldTemplate, replacementTemplate) {
  let rules
  try {
    rules = JSON.parse(rulesValue || '{}')
  } catch {
    return rulesValue
  }
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
    return rulesValue
  }

  let changed = false
  for (const rule of Object.values(rules)) {
    if (rule?.template === oldTemplate) {
      rule.template = replacementTemplate
      changed = true
    }
  }

  return changed ? JSON.stringify(rules) : rulesValue
}

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
