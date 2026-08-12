import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_DOWNLOAD_TEMPLATES, downloadTemplateName } from '../../src/renderer/helpers/downloadTemplates.js'

/** the en-US strings the template labels are built from */
const MESSAGES = {
  'Downloads.Templates.Video Best': 'Video - Best Quality',
  'Downloads.Templates.Video Resolution': 'Video - {resolution}',
  'Downloads.Templates.Audio Best': 'Audio - Best Quality',
  'Downloads.Templates.Audio Format': 'Audio - {format}',
  'Downloads.Templates.Subtitles Format': 'Subtitles - {format}'
}

/** stands in for vue-i18n's `t`, which the download history only has at display time */
function t(key, values = {}) {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, value),
    MESSAGES[key] ?? key
  )
}

test('names the template a download was started from', () => {
  assert.equal(downloadTemplateName('subtitles:srt', t), 'Subtitles - SRT')
  assert.equal(downloadTemplateName('video:1080', t), 'Video - 1080p')
  assert.equal(downloadTemplateName('video:1080:mp4', t), 'Video - 1080p (MP4)')
  assert.equal(downloadTemplateName('audio:mp3', t), 'Audio - MP3')
  assert.equal(downloadTemplateName('template:My preset', t), 'My preset')
})

test('has no name for downloads that did not use a template', () => {
  assert.equal(downloadTemplateName('', t), '')
  assert.equal(downloadTemplateName(undefined, t), '')
  // options edited after loading a template are reported as template-less
  assert.equal(downloadTemplateName('unsaved', t), '')
  assert.equal(downloadTemplateName('video:9999', t), '')
})

test('every template has a unique value and a translatable label', () => {
  const values = DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value)
  assert.equal(new Set(values).size, values.length)

  for (const template of DEFAULT_DOWNLOAD_TEMPLATES) {
    assert.equal(typeof template.label(t), 'string')
    assert.notEqual(template.label(t), '')
  }
})
