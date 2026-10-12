import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const component = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const functions = ['exportUnifiedBackup', 'promptAndWriteToFile'].map(name => component.match(new RegExp(`async function ${name}\\([\\s\\S]*?^\\}`, 'm'))[0])
const writer = utils.match(/export async function writeFileWithPicker\([\s\S]*?^\}/m)[0].replace('export ', '')

function loadExport({ cancel = false, sections = ['settings', 'profiles', 'playlists', 'history', 'searchHistory', 'watchStats'], fail = false } = {}) {
  let active = true
  const events = []
  const toasts = []
  const read = () => new Promise(resolve => setImmediate(() => {
    active = false
    events.push('read')
    resolve([])
  }))
  const exportBackup = vm.runInNewContext(`${writer}\n${functions.join('\n')}\nexportUnifiedBackup`, {
    process: { env: { IS_ELECTRON: true } },
    window: { showSaveFilePicker: async () => {
      events.push('picker')
      if (!active) throw new DOMException("Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.", 'SecurityError')
      if (cancel) throw new DOMException('Canceled', 'AbortError')
      return { createWritable: async () => ({ write: async content => events.push(content), close: async () => events.push('close') }) }
    } },
    backupBusy: { value: false },
    showBackupExport: { value: true },
    selectedExportSections: { value: sections },
    transferableSettings: { value: {} },
    DBProfileHandlers: { find: read },
    DBPlaylistHandlers: { find: read },
    DBHistoryHandlers: { find: read },
    DBSearchHistoryHandlers: { find: read },
    DBWatchStatsHandlers: { find: read, getHistoricalAdjustment: read },
    deepCopy: value => value,
    createUnifiedBackup: data => {
      if (fail) throw new Error('Backup archive is too large')
      events.push(Object.keys(data))
      return 'archive bytes'
    },
    getTodayDateStrLocalTimezone: () => '2026-10-12',
    START_IN_DIRECTORY: 'downloads',
    t: key => key,
    showToast: toast => toasts.push(toast.message),
  })
  return { exportBackup, events, toasts }
}

test('backup export opens the save picker while the click gesture is active, before database reads', async () => {
  const state = loadExport()
  await state.exportBackup()
  assert.deepEqual(state.toasts, ['Settings.Data Settings.Backup exported'])
  assert.equal(state.events[0], 'picker')
  assert.ok(state.events.includes('archive bytes'))
  assert.equal(state.events.at(-1), 'close')
})

test('canceling backup export does not read the databases or show a success toast', async () => {
  const state = loadExport({ cancel: true })
  await state.exportBackup()
  assert.deepEqual(state.events, ['picker'])
  assert.deepEqual(state.toasts, [])
})

test('export reads only the selected categories', async () => {
  const state = loadExport({ sections: ['searchHistory'] })
  await state.exportBackup()
  assert.equal(state.events.filter(event => event === 'read').length, 1)
  assert.deepEqual(Array.from(state.events.find(Array.isArray)), ['searchHistory'])
})

test('failed backup preparation leaves the destination untouched and reports the error', async () => {
  const state = loadExport({ fail: true })
  await state.exportBackup()
  assert.equal(state.events.includes('archive bytes'), false)
  assert.equal(state.events.includes('close'), false)
  assert.deepEqual(state.toasts, ['Settings.Data Settings.Unable to write file: Error: Backup archive is too large'])
})
