import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DOWNLOAD_TEMPLATES,
  downloadTemplateName,
  getDownloadTemplateOptions,
  replaceAutomaticDownloadTemplateReferences
} from '../../src/renderer/helpers/downloadTemplates.js'

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

test('resolves built-in, current custom, and legacy custom template options', () => {
  assert.deepEqual(getDownloadTemplateOptions('audio:mp3'), {
    mode: 'audio',
    audioFormat: 'mp3',
    embedThumbnail: true,
    embedMetadata: true
  })
  assert.deepEqual(getDownloadTemplateOptions('template:Podcast', [{
    name: 'Podcast',
    options: { mode: 'audio', audioFormat: 'opus' }
  }]), { mode: 'audio', audioFormat: 'opus' })
  assert.deepEqual(getDownloadTemplateOptions('template:Legacy', [{
    name: 'Legacy',
    args: '--write-description'
  }]), { mode: 'video', customArgs: '--write-description' })
  assert.equal(getDownloadTemplateOptions('template:Missing', []), null)
})

test('moves automatic download rules away from renamed or deleted templates', () => {
  const rules = JSON.stringify({
    first: { template: 'template:Old', includeVideos: true },
    second: { template: 'video:720', includeVideos: true }
  })

  assert.deepEqual(JSON.parse(replaceAutomaticDownloadTemplateReferences(
    rules,
    'template:Old',
    'template:New'
  )), {
    first: { template: 'template:New', includeVideos: true },
    second: { template: 'video:720', includeVideos: true }
  })
  assert.equal(replaceAutomaticDownloadTemplateReferences(rules, 'template:Missing', 'video:best'), rules)
})

test('every template has a unique value and a translatable label', () => {
  const values = DEFAULT_DOWNLOAD_TEMPLATES.map(template => template.value)
  assert.equal(new Set(values).size, values.length)

  for (const template of DEFAULT_DOWNLOAD_TEMPLATES) {
    assert.equal(typeof template.label(t), 'string')
    assert.notEqual(template.label(t), '')
  }
})
