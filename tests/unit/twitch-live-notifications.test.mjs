import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTwitchLiveNotifier } from '../../src/main/twitchLiveNotifications.js'

const CHANNEL = { id: '1001', login: 'streamer', name: 'Streamer' }
const OTHER = { id: '1002', login: 'other', name: 'Other' }

function user({ id, login, name }, stream) {
  return { id, login, displayName: name, stream: stream ? { id: stream, title: `${name} stream`, previewImageURL: 'https://cdn.example.test/live.jpg' } : null }
}

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'twitch-live-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const state = { streams: {}, shown: [], live: [], checks: 0, waiters: [] }
  const file = path.join(directory, 'twitch-live-notifications.json')
  const create = () => createTwitchLiveNotifier({
    file,
    intervalMs: 60_000,
    configureDelayMs: 0,
    fetch: async (_url, options) => {
      const { variables } = JSON.parse(options.body)
      return Response.json({ data: { users: variables.ids.map(id => user(id === CHANNEL.id ? CHANNEL : OTHER, state.streams[id])) } })
    },
    show: async notification => { state.shown.push(notification) },
    onLive: live => {
      state.live = live
      state.checks++
      state.waiters.splice(0).forEach(resolve => resolve())
    }
  })
  // Waits for a check to load the live streams. It saves them and shows its
  // notifications after that.
  const checked = () => new Promise(resolve => state.waiters.push(resolve))
  const readKnown = async () => {
    try {
      return JSON.parse(await readFile(file, 'utf8')).known
    } catch {
      return null
    }
  }
  return { state, file, create, checked, readKnown }
}

/**
 * @param {() => unknown} condition
 */
async function until(condition) {
  for (let attempt = 0; !(await condition()); attempt++) {
    if (attempt >= 1000) throw new Error('The condition never held')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('announces each broadcast once, starting from the streams live at the first check', async t => {
  const { state, file, create, checked, readKnown } = await setup(t)
  let notifier = create()
  t.after(() => notifier.stop())
  const configuration = { enabled: true, channels: [CHANNEL], title: '{channel} is live' }

  state.streams = { [CHANNEL.id]: 's1' }
  notifier.configure(configuration)
  await checked()
  await until(async () => (await readKnown())?.[CHANNEL.id]?.includes('s1'))
  // Live before the first check, so not news
  assert.deepEqual(state.shown, [])
  assert.deepEqual(state.live.map(stream => stream.id), ['s1'])

  // A later broadcast, after a restart, is announced once
  notifier.stop()
  state.streams = { [CHANNEL.id]: 's2' }
  notifier = create()
  notifier.configure(configuration)
  await until(() => state.shown.length > 0)
  assert.deepEqual(state.shown, [{
    title: 'Streamer is live',
    body: 'Streamer stream',
    url: 'https://www.twitch.tv/streamer',
    thumbnail: 'https://cdn.example.test/live.jpg',
    target: { kind: 'live', path: '/external-media', query: { url: 'https://www.twitch.tv/streamer', stream: 's2' } }
  }])
  // Nor again after another restart
  notifier.stop()
  notifier = create()
  notifier.configure(configuration)
  await checked()

  // A newly followed channel that is live is not news either. Checks run one
  // at a time, so once this one saved, the one before has finished too.
  state.streams = { [CHANNEL.id]: 's2', [OTHER.id]: 'o1' }
  notifier.configure({ ...configuration, channels: [CHANNEL, OTHER] })
  await until(async () => (await readKnown())?.[OTHER.id])
  assert.equal(state.shown.length, 1)
  assert.deepEqual(await readKnown(), { [CHANNEL.id]: ['s2', 's1'], [OTHER.id]: ['o1'] })

  // Turning notifications off forgets the streams, and stops the checks
  const checks = state.checks
  await notifier.configure({ ...configuration, enabled: false })
  await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(state.checks, checks)
})

test('accepts only valid channels and a title for the channel name', async t => {
  const { state, create, checked } = await setup(t)
  const notifier = create()
  t.after(() => notifier.stop())
  state.streams = {}
  notifier.configure({ enabled: true, title: 'Live', channels: [CHANNEL, { id: 'x', login: 'bad' }, { id: '1003', login: '../x' }] })
  await checked()
  state.streams = { [CHANNEL.id]: 's1' }
  notifier.configure({ enabled: true, title: 'Live!', channels: [CHANNEL, OTHER] })
  await until(() => state.shown.length > 0)
  // Titles without the channel fall back to its name
  assert.deepEqual(state.shown.map(notification => notification.title), ['Streamer'])
})
