import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_KEYS,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
} from '../../src/renderer/helpers/settings-search-config.js'

const locale = loadYaml(await readFile(
  new URL('../../static/locales/en-US.yaml', import.meta.url),
  'utf8'
))
const getAtPath = (value, path) => path.split('.').reduce((nested, key) => nested?.[key], value)

test('settings search paths match the canonical locale structure', () => {
  for (const [section, localePath] of Object.entries(SETTINGS_SEARCH_KEYS)) {
    const messages = getAtPath(locale, localePath)
    assert.equal(typeof messages, 'object', `${localePath} must resolve to an object`)

    for (const [groupPath, retainedKeys] of Object.entries(
      SETTINGS_SEARCH_SELECT_GROUP_LABELS[section] ?? {}
    )) {
      const group = groupPath === '' ? messages : getAtPath(messages, groupPath)
      const fullGroupPath = [localePath, groupPath].filter(Boolean).join('.')
      assert.equal(typeof group, 'object', `${fullGroupPath} must resolve to an object`)
      for (const retainedKey of retainedKeys) {
        assert.ok(
          Object.hasOwn(group, retainedKey),
          `${fullGroupPath}.${retainedKey} must exist`
        )
      }
    }

    for (const excludedPath of SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS[section] ?? []) {
      assert.notEqual(
        getAtPath(messages, excludedPath),
        undefined,
        `${localePath}.${excludedPath} must exist`
      )
    }
  }
})
