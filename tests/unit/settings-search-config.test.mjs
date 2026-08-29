import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS,
  SETTINGS_SEARCH_SOURCES,
  SETTINGS_SEARCH_SELECT_GROUP_LABELS,
} from '../../src/renderer/helpers/settings-search-config.js'
import {
  createSettingsSearchIndex,
  findSettingsSearchTab,
} from '../../src/renderer/helpers/settingsSearch.js'

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

test('settings search excludes values that only exist in hidden controls', () => {
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.theme['Icon Pack'],
    ['Icon Pack']
  )
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.theme['Custom Theme'],
    ['Create Custom Theme', 'Edit Custom Theme']
  )
  assert.deepEqual(
    SETTINGS_SEARCH_SELECT_GROUP_LABELS.player['Auto Picture in Picture'],
    ['Auto Picture in Picture']
  )
  assert.equal(getAtPath(locale, 'Settings.Password Settings.Password'), undefined)
  assert.equal(typeof getAtPath(locale, 'Settings.Password Dialog.Password'), 'string')
  assert.ok(
    SETTINGS_SEARCH_EXCLUDED_MESSAGE_PATHS['sponsor-block']
      .has('Generated SponsorBlock User ID Copy Button')
  )
})

test('shared settings search index includes only settings available on this platform', () => {
  const store = {
    getters: new Proxy({
      getBaseTheme: 'dark',
      getDefaultCaptionSettings: '{}',
      getSystemDarkTheme: 'dark',
      getSystemLightTheme: 'light',
    }, {
      get(target, key) {
        return target[key] ?? false
      }
    })
  }
  const sections = [{
    type: 'appearance',
    title: locale.Settings.Categories.Appearance,
    description: locale.Settings.Categories['Appearance Description'],
  }]
  const options = {
    sections,
    tm: path => getAtPath(locale, path),
    store,
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const desktopValues = createSettingsSearchIndex({
    ...options,
    usingElectron: true,
  }).get('appearance')
  const webValues = createSettingsSearchIndex({
    ...options,
    usingElectron: false,
  }).get('appearance')

  assert.ok(desktopValues.some(({ label }) => label === 'Show thumbnail previews'))
  assert.ok(desktopValues.some(({ label }) => label === 'UI Scale'))
  assert.ok(!webValues.some(({ label }) => label === 'UI Scale'))
})

test('settings search results retain their source tab', () => {
  const store = {
    getters: new Proxy({}, {
      get() {
        return false
      }
    })
  }
  const values = createSettingsSearchIndex({
    sections: [{
      type: 'data',
      title: locale.Settings.Categories.Data,
      description: locale.Settings.Categories['Data Description'],
    }],
    tm: path => getAtPath(locale, path),
    store,
    usingElectron: true,
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }).get('data')

  const searchHistory = values.filter(({ label }) => label === 'Search history')
  assert.equal(searchHistory.length, 1)
  assert.equal(findSettingsSearchTab(searchHistory[0]), 'data')

  const applicationCaches = values.find(({ label }) => label === 'Application caches')
  assert.equal(findSettingsSearchTab(applicationCaches), 'storage')
})

test('persistent playback cache search results follow desktop visibility', () => {
  const sections = [{
    type: 'data',
    title: locale.Settings.Categories.Data,
    description: locale.Settings.Categories['Data Description'],
  }]
  const options = {
    sections,
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get(target, key) {
          return target[key] ?? false
        }
      })
    },
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const desktopValues = createSettingsSearchIndex({ ...options, usingElectron: true }).get('data')
  const webValues = createSettingsSearchIndex({ ...options, usingElectron: false }).get('data')

  assert.ok(desktopValues.some(({ label }) => label === 'yt-dlp stream URL cache limit'))
  assert.ok(!webValues.some(({ label }) => label === 'yt-dlp stream URL cache limit'))
})

test('comment translation button setting follows local API availability', () => {
  const options = {
    sections: [{
      type: 'focus',
      title: 'Distraction Free',
      description: locale.Settings.Categories['Distraction Free Description'],
    }],
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get() {
          return false
        }
      })
    },
    usingElectron: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const localApiValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: true,
  }).get('focus')
  const webValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: false,
  }).get('focus')

  assert.ok(localApiValues.some(({ label }) => label === 'Hide Comment Translation Buttons'))
  assert.ok(!webValues.some(({ label }) => label === 'Hide Comment Translation Buttons'))
})

test('ignored comment translation languages follow local API availability', () => {
  const options = {
    sections: [{
      type: 'general',
      title: 'General',
      description: locale.Settings.Categories['General Description'],
    }],
    tm: path => getAtPath(locale, path),
    store: {
      getters: new Proxy({}, {
        get() {
          return false
        }
      })
    },
    usingElectron: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }

  const localApiValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: true,
  }).get('general')
  const webValues = createSettingsSearchIndex({
    ...options,
    supportsLocalApi: false,
  }).get('general')

  assert.ok(localApiValues.some(({ label }) => label === 'Never translate comments in'))
  assert.ok(localApiValues.some(({ label }) => label === 'Enable comment translations'))
  assert.ok(localApiValues.some(({ label }) => label === 'Comment translations'))
  assert.ok(localApiValues.some(({ label }) => label === 'Fill missing translations with AI-generated text'))
  assert.ok(webValues.some(({ label }) => label === 'Fill missing translations with AI-generated text'))
  assert.ok(!webValues.some(({ label }) => label === 'Never translate comments in'))
  assert.ok(!webValues.some(({ label }) => label === 'Enable comment translations'))
  assert.ok(!webValues.some(({ label }) => label === 'Comment translations'))
})
