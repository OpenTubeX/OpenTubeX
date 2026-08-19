import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_SOURCES,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
} from '../../src/renderer/helpers/settings-search-config.js'

const locale = loadYaml(await readFile(
  new URL('../../static/locales/en-US.yaml', import.meta.url),
  'utf8'
))
const getAtPath = (value, path) => path.split('.').reduce((nested, key) => nested?.[key], value)

test('settings search paths match the canonical locale structure', () => {
  for (const sources of Object.values(SETTINGS_SEARCH_SOURCES)) {
    for (const source of sources) {
      const messages = getAtPath(locale, source.key)
      assert.equal(typeof messages, 'object', `${source.key} must resolve to an object`)

      for (const key of [...source.include ?? [], ...source.exclude ?? []]) {
        assert.ok(Object.hasOwn(messages, key), `${source.key}.${key} must exist`)
      }

      for (const [groupPath, retainedKeys] of Object.entries(
        SETTINGS_SEARCH_SELECT_GROUP_LABELS[source.type] ?? {}
      )) {
        const group = groupPath === '' ? messages : getAtPath(messages, groupPath)
        const fullGroupPath = [source.key, groupPath].filter(Boolean).join('.')
        assert.equal(typeof group, 'object', `${fullGroupPath} must resolve to an object`)
        for (const retainedKey of retainedKeys) {
          assert.ok(
            Object.hasOwn(group, retainedKey),
            `${fullGroupPath}.${retainedKey} must exist`
          )
        }
      }

      for (const excludedPath of SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[source.type] ?? []) {
        assert.notEqual(
          getAtPath(messages, excludedPath),
          undefined,
          `${source.key}.${excludedPath} must exist`
        )
      }
    }
  }
})

test('playback search retains caption controls without caption option values', () => {
  const captionSource = SETTINGS_SEARCH_SOURCES.playback.find(
    ({ type }) => type === 'caption-appearance'
  )
  assert.equal(captionSource?.key, 'Settings.Player Settings.Caption Appearance')
  assert.deepEqual(SETTINGS_SEARCH_SELECT_GROUP_LABELS['caption-appearance'].Anchor, ['Anchor'])
  assert.ok(
    SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS['caption-appearance'].has('Application Language')
  )
})
