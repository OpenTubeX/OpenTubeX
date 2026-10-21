import assert from 'node:assert/strict'
import test from 'node:test'
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
