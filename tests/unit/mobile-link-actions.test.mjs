import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  resolveExternalLinkAction,
  resolveMobileContextLinkCopyUrl,
} from '../../src/renderer/helpers/mobileLinkActions.js'

const appUrl = 'https://localhost/'

test('mobile link actions copy shareable app routes as YouTube links', () => {
  assert.equal(
    resolveMobileContextLinkCopyUrl(
      `${appUrl}#/watch/jNQXAC9IVRw?playlistId=PL123`,
      appUrl
    ),
    'https://youtu.be/jNQXAC9IVRw?list=PL123'
  )
  assert.equal(
    resolveMobileContextLinkCopyUrl(`${appUrl}#/channel/UC123`, appUrl),
    'https://www.youtube.com/channel/UC123'
  )
})

test('mobile link actions preserve external URLs and reject private app routes', () => {
  assert.equal(
    resolveMobileContextLinkCopyUrl('https://example.com/article', appUrl),
    'https://example.com/article'
  )
  assert.equal(
    resolveMobileContextLinkCopyUrl(`${appUrl}#/history`, appUrl),
    null
  )
})

test('the mobile copy-link action uses the distinct copy icon', async () => {
  const app = await readFile(path.join(process.cwd(), 'src/renderer/App.vue'), 'utf8')
  assert.match(app, /@click="copyMobileContextLink"[\s\S]*?<FtIcon :icon="\['fas', 'copy'\]"/)
})

test('mobile external links respect the configured opening policy', () => {
  assert.equal(resolveExternalLinkAction('doNothing'), 'disabled')
  assert.equal(resolveExternalLinkAction('openLinkAfterPrompt'), 'prompt')
  assert.equal(resolveExternalLinkAction(''), 'open')
})
