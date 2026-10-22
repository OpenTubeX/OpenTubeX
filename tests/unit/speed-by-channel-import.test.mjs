import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { parseSpeedByChannelValues, resolveSpeedByChannelValues } from '../../src/renderer/helpers/speed-by-channel-import.js'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'

test('reads channel speeds and skips the userscript settings and invalid values', () => {
  const values = {
    '_YSC-DEFAULT_SPEED': 1.5,
    '_YSC-BUTTON_TEMPLATES': '[["Normal",1]]',
    '@handle': 1.75,
    'Channel Name ': 2,
    [CHANNEL_ID]: 1.25,
    zero: 0,
    text: '2',
    infinite: Infinity,
  }

  const expected = [
    { key: '@handle', speed: 1.75 },
    { key: 'Channel Name', speed: 2 },
    { key: CHANNEL_ID, speed: 1.25 },
  ]
  assert.deepEqual(parseSpeedByChannelValues(values), expected)
  // Tampermonkey's storage export
  assert.deepEqual(parseSpeedByChannelValues({ ts: 1, data: values }), expected)
  assert.deepEqual(parseSpeedByChannelValues([]), [])
  assert.deepEqual(parseSpeedByChannelValues(null), [])
  assert.deepEqual(parseSpeedByChannelValues({ data: 1.5 }), [{ key: 'data', speed: 1.5 }])
})

test('resolves handles over the network and lets them win over names', async (t) => {
  t.mock.method(console, 'error', () => {})
  const resolved = []
  const progress = []
  const { speeds, notFound } = await resolveSpeedByChannelValues([
    { key: 'Subscribed', speed: 1.25 },
    { key: '@subscribed', speed: 2 },
    { key: '@unsubscribed', speed: 1.5 },
    { key: 'Unsubscribed', speed: 1.5 },
    { key: '@deleted', speed: 3 },
    { key: '@offline', speed: 3 },
  ], {
    subscriptions: [{ id: CHANNEL_ID, name: 'Subscribed' }],
    resolveHandle: async (handle) => {
      resolved.push(handle)
      if (handle === '@offline') throw new Error('offline')
      const ids = { '@subscribed': CHANNEL_ID, '@unsubscribed': OTHER_CHANNEL_ID }
      return ids[handle] ?? null
    },
    onProgress: (count, total) => progress.push([count, total]),
  })

  assert.deepEqual(speeds, { [CHANNEL_ID]: 2, [OTHER_CHANNEL_ID]: 1.5 })
  // Names duplicate the handles of newer versions, so only handles are reported
  assert.deepEqual(notFound, ['@deleted', '@offline'])
  assert.deepEqual(resolved.toSorted(), ['@deleted', '@offline', '@subscribed', '@unsubscribed'])
  assert.deepEqual(progress.map(([count]) => count), [1, 2, 3, 4])
  assert.ok(progress.every(([, total]) => total === 4))
})

test('matches names from older versions against the subscriptions', async () => {
  const { speeds, notFound } = await resolveSpeedByChannelValues([
    { key: 'subscribed channel', speed: 1.5 },
    { key: 'Shared', speed: 2 },
    { key: 'Unknown', speed: 2 },
    { key: OTHER_CHANNEL_ID, speed: 1.25 },
  ], {
    subscriptions: [
      { id: CHANNEL_ID, name: 'Subscribed Channel ' },
      { id: 'UCcccccccccccccccccccccc', name: 'Shared' },
      { id: 'UCdddddddddddddddddddddd', name: 'shared' },
    ],
    resolveHandle: () => assert.fail('There are no handles to resolve'),
  })

  assert.deepEqual(speeds, { [CHANNEL_ID]: 1.5, [OTHER_CHANNEL_ID]: 1.25 })
  assert.deepEqual(notFound, ['Shared', 'Unknown'])
})

const dataSettings = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
const importer = dataSettings.slice(
  dataSettings.indexOf('const channelPlaybackSpeedsBusy'),
  dataSettings.indexOf('// #endregion channel playback speeds')
)

async function importFile(values, { failingSettings = [] } = {}) {
  const settings = { channelPlaybackSpeeds: '{}' }
  const toasts = []
  const run = vm.runInNewContext(`${importer}\nimportChannelPlaybackSpeeds`, {
    ref: value => ({ value }),
    readFileWithPicker: async () => ({ content: JSON.stringify(values) }),
    parseImportedJson: content => JSON.parse(content),
    parseSpeedByChannelValues,
    resolveSpeedByChannelValues,
    parseChannelPreferences: value => JSON.parse(value),
    resolveChannelId: async () => null,
    runWithDataImportProgress: callback => callback({ update() {} }),
    primaryProfile: { value: { subscriptions: [] } },
    store: {
      getters: {
        get getChannelPlaybackSpeeds() { return settings.channelPlaybackSpeeds },
        getBackendPreference: 'local',
      },
      // Like the settings store, a failed update is only logged
      dispatch: async (action, value) => {
        const setting = action[6].toLowerCase() + action.slice(7)
        if (!failingSettings.includes(setting)) settings[setting] = value
      },
    },
    showToast: toast => toasts.push(toast.message),
    t: (key, named) => named ? `${key}: ${named.count}` : key,
    IMPORT_DIRECTORY_ID: 'test',
    START_IN_DIRECTORY: 'downloads',
  })
  await run()
  return { settings, toasts }
}

test('saves the imported speeds', async () => {
  const { settings, toasts } = await importFile({ [CHANNEL_ID]: 1.5 })

  assert.deepEqual(settings, { channelPlaybackSpeeds: JSON.stringify({ [CHANNEL_ID]: 1.5 }) })
  assert.deepEqual(toasts, ['Settings.Data Settings.Channel playback speeds imported: 1'])
})

test('reports a failed save instead of a successful import', async () => {
  const { settings, toasts } = await importFile(
    { [CHANNEL_ID]: 1.5, Unknown: 2 },
    { failingSettings: ['channelPlaybackSpeeds'] }
  )
  assert.deepEqual(settings, { channelPlaybackSpeeds: '{}' })
  // Channels that weren't found are reported either way
  assert.deepEqual(toasts, [
    'Channel.Failed to save subscription settings',
    'Settings.Data Settings.Channels not found: 1',
  ])
})
