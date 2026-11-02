import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

// The handler reads the bundled player map relative to the webpack output
globalThis.__dirname = fileURLToPath(new URL('../../', import.meta.url))

const settingValues = new Map()
const [{ handleOpenInExternalPlayer }, { IpcChannels }] = await importWithStubs(
  [sourceUrl('src/main/externalPlayer.js'), sourceUrl('src/constants.js')],
  {
    [sourceUrl('src/datastores/handlers/base.js')]: {
      settings: { _findOne: async id => settingValues.has(id) ? { value: settingValues.get(id) } : null }
    },
    [sourceUrl('src/main/utils.js')]: { isOpenTubeXUrl: () => true },
  }
)

function createEvent() {
  const replies = []
  return {
    replies,
    senderFrame: { url: 'app://bundle/index.html' },
    sender: { isFocused: () => true, isDestroyed: () => false },
    reply: (channel, ...args) => replies.push([channel, ...args]),
  }
}

test('a missing external player executable is reported instead of crashing the main process', async () => {
  settingValues.set('externalPlayer', 'mpv')
  settingValues.set('externalPlayerExecutable', fileURLToPath(new URL('./missing-external-player', import.meta.url)))
  const uncaught = []
  const onUncaught = error => uncaught.push(error)
  process.prependListener('uncaughtException', onUncaught)
  try {
    const event = createEvent()
    await handleOpenInExternalPlayer(event, { videoId: 'dQw4w9WgXcQ' })
    // A spawn error is emitted on a later tick
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(uncaught, [])
    assert.deepEqual(event.replies, [[IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, 'mpv', [], false, true]])
  } finally {
    process.removeListener('uncaughtException', onUncaught)
  }
})

test('a started external player is reported as opening', async () => {
  settingValues.set('externalPlayer', 'mpv')
  settingValues.set('externalPlayerExecutable', process.execPath)
  settingValues.set('externalPlayerCustomArgs', JSON.stringify(['--eval', '']))
  try {
    const event = createEvent()
    await handleOpenInExternalPlayer(event, { videoId: 'dQw4w9WgXcQ' })

    assert.deepEqual(event.replies, [[IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, 'mpv', [], false, false]])
  } finally {
    settingValues.delete('externalPlayerCustomArgs')
  }
})
