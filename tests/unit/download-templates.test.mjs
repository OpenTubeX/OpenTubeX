import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getDownloadTemplateOptions,
  replaceAutomaticDownloadTemplateReferences
} from '../../src/renderer/helpers/downloadTemplates.js'

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
