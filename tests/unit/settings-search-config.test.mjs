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
  findSettingsSearchTarget,
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
    isCapacitor: false,
  }).get('appearance')
  const mobileValues = createSettingsSearchIndex({
    ...options,
    usingElectron: false,
    isCapacitor: true,
  }).get('appearance')

  assert.ok(desktopValues.some(({ label }) => label === 'Show thumbnail previews'))
  assert.ok(desktopValues.some(({ label }) => label === 'Navigation'))
  assert.ok(desktopValues.some(({ label }) => label === 'UI Scale'))
  assert.ok(!webValues.some(({ label }) => label === 'UI Scale'))
  assert.ok(mobileValues.some(({ label }) => label === 'Mobile layout'))
  assert.ok(mobileValues.some(({ label }) => label === 'Use Fixed Tab Width in Horizontal Mode'))
  assert.ok(mobileValues.some(({ label }) => label === 'Show Tab Icons'))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings'].Font['App Font']))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings']['Move Settings to App Header']))
  assert.ok(mobileValues.some(({ label }) => label === locale.Settings['Theme Settings']['UI Scale']))
  assert.ok(!mobileValues.some(({ label }) => label === 'Show progress as notification'))
  const mobileSearchLabel = locale.Settings['Theme Settings']['Always Show Mobile Search Bar']
  assert.ok(mobileValues.some(({ label }) => label === mobileSearchLabel))
  assert.ok(!desktopValues.some(({ label }) => label === mobileSearchLabel))
  assert.ok(!webValues.some(({ label }) => label === mobileSearchLabel))
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
      title: locale.Settings['Data Settings']['Data And Storage'],
      description: locale.Settings.Categories['Data And Storage Description'],
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

test('distraction free search results open the tab of their setting', () => {
  const store = { getters: new Proxy({}, { get: () => false }) }
  const values = createSettingsSearchIndex({
    sections: [{ type: 'focus', title: 'Focus', description: '' }],
    tm: path => getAtPath(locale, path),
    store,
    usingElectron: true,
    supportsLocalApi: true,
    isMac: false,
    isLinuxWayland: false,
    systemUsesDarkTheme: true,
  }).get('focus')
  const tabOf = label => findSettingsSearchTab(values.find(match => match.label === label))

  assert.equal(tabOf('Hide Video Views'), 'distraction')
  assert.equal(tabOf('Digital Wellbeing'), 'wellbeing')
  assert.equal(tabOf('Daily Watch Time Limit'), 'wellbeing')
  assert.equal(tabOf('Silence Upload Notifications at Bedtime'), 'wellbeing')
  assert.equal(tabOf('Count Watch Time From'), 'wellbeing')
  assert.equal(tabOf("When It's Time for a Break"), 'wellbeing')
  assert.equal(tabOf('Hide Unsubscribe Button'), 'parental')
  assert.equal(values.filter(match => match.label === 'Digital Wellbeing').length, 1)
  // Select options are not settings of their own.
  assert.equal(values.some(match => match.label === 'Pause Playback'), false)
})

for (const [platform, usingElectron, isCapacitor] of [
  ['mobile', false, true],
]) {
  test(`${platform} general settings search matches tab support`, () => {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'general', title: 'General', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: {} },
      usingElectron,
      isCapacitor,
    }).get('general')
    for (const path of [
      'New Tab Position.New Tab Position',
      'Tab Close Focus.Tab Close Focus',
      'Startup Behavior.Startup Behavior',
    ]) {
      const label = getAtPath(locale, `Settings.General Settings.${path}`)
      assert.equal(entries.some(entry => entry.label === label), usingElectron || isCapacitor, label)
    }
    assert.equal(entries.some(entry => entry.label === 'Enable Tabs'), isCapacitor)
  })
}

for (const [platform, usingElectron, isCapacitor] of [
  ['desktop', true, false],
]) {
  test(`${platform} privacy search matches navigation history setting visibility`, () => {
    const entries = createSettingsSearchIndex({
      sections: [{ type: 'privacy', title: 'Privacy', description: '' }],
      tm: path => getAtPath(locale, path),
      store: { getters: {} },
      usingElectron,
      isCapacitor,
    }).get('privacy')
    assert.equal(entries.some(({ label }) => label === 'Remember Tab Navigation History'), usingElectron || isCapacitor)
  })
}

test('settings search retains the subpage containing each control', () => {
  const values = createSettingsSearchIndex({
    sections: [
      { type: 'appearance', title: 'Appearance', description: '' },
      { type: 'playback', title: 'Playback', description: '' }
    ],
    tm: path => getAtPath(locale, path),
    store: { getters: { getUseQuickPlaybackSpeedBar: true } },
    usingElectron: true,
  })
  for (const [section, label, subpage, subpageTab] of [
    ['appearance', 'Show active subscriptions in sidebar', 'customize-interface', 'navigation'],
    ['appearance', "Always show navigation bar when it's at the bottom", 'customize-interface', 'navigation'],
    ['appearance', "Compact navigation bar when it's at the bottom", 'customize-interface', 'navigation'],
    ['appearance', 'Add item', 'customize-interface', 'navigation'],
    ['appearance', 'Customize navigation', 'customize-interface', 'navigation'],
    ['appearance', 'Add setting', 'customize-interface', 'quickSettings'],
    ['appearance', 'Customize control bar', 'customize-interface', 'controlBar'],
    ['appearance', 'Add action', 'customize-interface', 'fullscreenActions'],
    ['appearance', 'Customize interface', undefined, undefined],
    ['playback', 'Add Playback Speed', 'quick-playback-speed', undefined],
    ['playback', 'Playback Speed', 'quick-playback-speed', undefined],
    ['playback', 'Default Playback Rate', undefined, undefined]
  ]) {
    const match = values.get(section).find(match => match.label === label)
    assert.ok(match, label)
    assert.equal(match.subpage, subpage, label)
    assert.equal(match.subpageTab, subpageTab, label)
  }
})

test('activity links retain search tabs and subpages and reject unavailable or ambiguous labels', () => {
  const match = { label: 'Playback Speed', tab: 'player', subpage: 'quick-playback-speed' }
  const index = new Map([
    ['playback', [{ label: 'Player' }, match, { label: 'Auto Update' }]],
    ['general', [{ label: 'Auto Update' }]],
  ])
  assert.deepEqual(findSettingsSearchTarget(index, ['Playback Speed', 'Auto Update']), { section: 'playback', match })
  assert.equal(findSettingsSearchTarget(index, ['Unavailable setting']), null)
  assert.equal(findSettingsSearchTarget(index, ['Auto Update']), null)
  assert.equal(findSettingsSearchTarget(index, []), null)
  assert.deepEqual(findSettingsSearchTarget(index, ['Playback Speed', 'Auto Update'], 'defaultPlayback'), {
    section: 'playback', match: { ...match, settingKey: 'defaultPlayback' }
  })
})

test('subscription activity resolves to its control even with a partially translated Channel group', () => {
  const index = createSettingsSearchIndex({
    sections: [{ type: 'subscriptions', title: 'Subscription', description: '' }],
    tm: path => path === 'Channel' ? {} : getAtPath(locale, path),
    store: { getters: {} },
    usingElectron: true,
  })
  assert.deepEqual(findSettingsSearchTarget(index, ['Subscription settings'], 'subscriptionChannelSettings'), {
    section: 'subscriptions', match: { label: 'Subscription settings', settingKey: 'subscriptionChannelSettings' },
  })
})
