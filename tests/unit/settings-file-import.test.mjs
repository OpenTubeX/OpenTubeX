import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parseLineDelimitedJson } from '../../src/renderer/helpers/line-delimited-json.js'

const source = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function parseImportedLineDelimitedJson('), source.indexOf('const SUBSCRIPTIONS_PROMPT_VALUES'))
const importer = source.slice(source.indexOf('async function importSettings()'), source.indexOf('async function exportSettings('))

async function importFile(content) {
  const changes = {}
  const toasts = []
  const settings = { uiScale: 100, rememberHistory: true, syncServerToken: 'private' }
  const run = vm.runInNewContext(`${helpers}\n${importer}\nimportSettings`, {
    parseLineDelimitedJson,
    readFileWithPicker: async () => content === null ? null : { content },
    migrateLegacySettings: value => value,
    defaultUpdaterId: key => key,
    NON_TRANSFERABLE_SETTINGS: new Set(['syncServerToken']),
    transferableSettings: { value: { uiScale: 100, rememberHistory: true } },
    store: { state: { settings }, dispatch: async (key, value) => { changes[key] = value } },
    showToast: toast => toasts.push(toast),
    t: key => key,
    console: { error() {} },
    IMPORT_DIRECTORY_ID: 'test', START_IN_DIRECTORY: 'documents',
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

test('valid settings that already match still count as a successful import', async () => {
  const result = await importFile('{"uiScale":100}')
  assert.deepEqual(result.applied, [])
  assert.equal(result.toasts.at(-1).icon[1], 'sliders-h')
})

test('canceling settings import leaves settings and notifications alone', async () => {
  assert.deepEqual(await importFile(null), { applied: [], toasts: [] })
})
