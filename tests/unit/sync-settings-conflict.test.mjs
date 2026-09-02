import assert from 'node:assert/strict'
import test from 'node:test'

import { commitCustomThemesEdit } from '../../src/renderer/helpers/customThemeSync.js'
import { mergeSettingEntry } from '../../src/renderer/helpers/sync-settings-conflict.js'

test('uses the actual local edit time instead of the later sync time', () => {
  const entry = mergeSettingEntry({
    key: 'baseTheme',
    value: 'dark',
    old: { key: 'baseTheme', value: 'system', updatedAt: 10 },
    remoteEntry: { key: 'baseTheme', value: 'light', updatedAt: 30 },
    localUpdatedAt: 20,
    now: 100,
  })

  assert.equal(entry.value, 'light')
  assert.equal(entry.updatedAt, 30)
})

test('keeps a genuinely newer local setting edit', () => {
  const entry = mergeSettingEntry({
    key: 'baseTheme',
    value: 'dark',
    old: { key: 'baseTheme', value: 'system', updatedAt: 10 },
    remoteEntry: { key: 'baseTheme', value: 'light', updatedAt: 30 },
    localUpdatedAt: 40,
    now: 100,
  })

  assert.equal(entry.value, 'dark')
  assert.equal(entry.updatedAt, 40)
})

test('does not treat reordered object keys as a local setting edit', () => {
  const remoteEntry = {
    key: 'homeSections',
    value: { subscriptions: true, trending: false },
    updatedAt: 30,
  }
  const entry = mergeSettingEntry({
    key: 'homeSections',
    value: { trending: true, subscriptions: true },
    old: {
      key: 'homeSections',
      value: { subscriptions: true, trending: true },
      updatedAt: 10,
    },
    remoteEntry,
    localUpdatedAt: 40,
    now: 100,
  })

  assert.deepEqual(entry, remoteEntry)
})

test('records a custom-theme edit before publishing the new theme list', async () => {
  const calls = []
  const themes = [{ id: 'theme-1', name: 'Test theme' }]

  await commitCustomThemesEdit({
    dispatch: async (action, payload) => calls.push(['dispatch', action, payload]),
    commit: (mutation, payload) => calls.push(['commit', mutation, payload]),
  }, themes)

  assert.deepEqual(calls, [
    ['dispatch', 'recordSyncSettingEdit', 'customThemes'],
    ['commit', 'setCustomThemes', themes],
  ])
})

test('uses the custom-theme edit timestamp when resolving a conflict', () => {
  const localThemes = [{ id: 'theme-1', name: 'Local' }]
  const remoteThemes = [{ id: 'theme-1', name: 'Remote' }]
  const entry = mergeSettingEntry({
    key: 'customThemes',
    value: localThemes,
    old: { key: 'customThemes', value: [], updatedAt: 10 },
    remoteEntry: { key: 'customThemes', value: remoteThemes, updatedAt: 30 },
    localUpdatedAt: 20,
    now: 100,
  })

  assert.deepEqual(entry.value, remoteThemes)
  assert.equal(entry.updatedAt, 30)
})
