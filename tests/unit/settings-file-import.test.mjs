import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parseLineDelimitedJson } from '../../src/renderer/helpers/line-delimited-json.js'

const source = await readFile(new URL('../../src/renderer/components/Settings/Data/DataSettings.vue', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function parseImportedLineDelimitedJson('), source.indexOf('const SUBSCRIPTIONS_PROMPT_VALUES'))
const importer = source.slice(source.indexOf('async function importSettings()'), source.indexOf('async function exportSettings('))

async function importFile(content, failingKeys = [], authorizedRulesWrite = null) {
  const changes = {}
  const toasts = []
  const settings = { uiScale: 100, rememberHistory: true, ytDlpAutomaticDownloadRules: '{}', syncServerToken: 'private' }
  const run = vm.runInNewContext(`${helpers}\n${importer}\nimportSettings`, {
    parseLineDelimitedJson,
    authorizeAutomaticDownloadRulesWrite: () => authorizedRulesWrite,
    readFileWithPicker: async () => {
      // The click's activation expires while the file dialog is open.
      authorizedRulesWrite = null
      return content === null ? null : { content }
    },
    migrateLegacySettings: value => value,
    defaultUpdaterId: key => key,
    NON_TRANSFERABLE_SETTINGS: new Set(['syncServerToken']),
    transferableSettings: { value: { uiScale: 100, rememberHistory: true, ytDlpAutomaticDownloadRules: '{}' } },
    store: {
      state: { settings },
      dispatch: async (key, value) => {
        if (failingKeys.includes(key)) return false
        changes[key] = value
        return true
      },
    },
    showToast: toast => toasts.push(toast),
    t: (key, values) => values ? `${key} ${JSON.stringify(values)}` : key,
    console: { error() {} },
    IMPORT_DIRECTORY_ID: 'test',
    START_IN_DIRECTORY: 'documents',
  })
  await run()
  return { applied: Object.keys(changes).length ? [changes] : [], toasts }
}

test('imports a settings object and a one-row settings database', async () => {
  for (const content of ['{"uiScale":125}', '\uFEFF{"uiScale":125}', '{"_id":"uiScale","value":125}\n']) {
    const result = await importFile(content)
    assert.deepEqual(result.applied, [{ uiScale: 125 }])
    assert.equal(result.toasts.at(-1).icon[1], 'sliders-h')
  }
})

test('settings database import skips malformed rows and preserves valid values', async () => {
  const result = await importFile([
    '{"_id":"uiScale","value":125}',
    '{truncated',
    'null',
    '{"_id":"theme"}',
    '{"_id":"rememberHistory","value":false}',
  ].join('\n'))
  assert.deepEqual(result.applied, [{ uiScale: 125, rememberHistory: false }])
  assert.ok(result.toasts.some(toast => toast.message.includes('Invalid JSON row')))
  assert.ok(result.toasts.some(toast => toast.message.includes('insufficient data')))
})

test('invalid settings files report failure without applying settings or announcing success', async () => {
  for (const content of ['', '{truncated', 'null', '[]', '42', '"settings"',
    '{"_id":"uiScale"}', '{"value":125}', '{"_id":"","value":125}',
    '{"unknownSetting":true}', '{"syncServerToken":"replacement"}']) {
    const result = await importFile(content)
    assert.deepEqual(result.applied, [], content)
    assert.ok(result.toasts.length > 0, content)
    assert.ok(result.toasts.every(toast => toast.icon[1] === 'circle-exclamation'), content)
  }
})

test('settings that fail to save are reported instead of announcing success', async () => {
  const toastText = toasts => toasts.map(toast => `${toast.icon[1]}: ${toast.message}`)
  const partial = await importFile('{"uiScale":125,"rememberHistory":false}', ['uiScale'])
  assert.deepEqual(partial.applied, [{ rememberHistory: false }])
  assert.deepEqual(toastText(partial.toasts), [
    'circle-exclamation: Settings.Data Settings.Some settings could not be imported {"failed":1,"total":2}',
  ])

  const failed = await importFile('{"uiScale":125}', ['uiScale'])
  assert.deepEqual(toastText(failed.toasts), ['circle-exclamation: Settings.Data Settings.Settings could not be imported'])
})

test('imported automatic download rules use the write authorized by the import click', async () => {
  const authorizedWrite = async () => null
  const result = await importFile('{"ytDlpAutomaticDownloadRules":"{\\"UC1\\":{}}"}', [], authorizedWrite)
  assert.equal(result.applied[0].ytDlpAutomaticDownloadRules.value, '{"UC1":{}}')
  assert.equal(result.applied[0].ytDlpAutomaticDownloadRules.authorizedWrite, authorizedWrite)
})
