import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

const locale = loadYaml(readFileSync(
  path.join(process.cwd(), 'static/locales/en-US.yaml'),
  'utf8'
))

test('settings location references match the current categories', () => {
  assert.match(
    locale.Subscriptions['Your Subscription list is currently empty. Start adding subscriptions to see them here.'],
    /Settings → Data/
  )
  assert.match(
    locale.Downloads['Download Failure Hint'],
    /Settings → Advanced → External Software/
  )
  assert.match(
    locale.Downloads['yt-dlp Not Found'],
    /Settings → Advanced → External Software/
  )
  assert.equal(
    locale['External link opening has been disabled in Settings → Privacy'],
    'External link opening has been disabled in Settings → Privacy'
  )
  assert.equal(locale.Settings['Sort Settings Sections (A-Z)'], undefined)
})
