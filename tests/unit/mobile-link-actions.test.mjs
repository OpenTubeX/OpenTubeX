import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveMobileContextLinkCopyUrl } from '../../src/renderer/helpers/mobileLinkActions.js'

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
