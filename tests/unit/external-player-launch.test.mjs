import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

// The handler reads the bundled player map relative to the webpack output
globalThis.__dirname = fileURLToPath(new URL('../../', import.meta.url))

const settingValues = new Map()
/** @type {object[]} */
const messageBoxes = []
let messageBoxResponse = 1
const [{ handleOpenInExternalPlayer }, { IpcChannels }] = await importWithStubs(
  [sourceUrl('src/main/externalPlayer.js'), sourceUrl('src/constants.js')],
  {
    electron: {
      BrowserWindow: { fromWebContents: () => null },
      dialog: {
        showMessageBox: async (options) => {
          messageBoxes.push(options)
          return { response: messageBoxResponse }
        }
      },
    },
    [sourceUrl('src/datastores/handlers/base.js')]: {
      settings: {
        _findOne: async id => settingValues.has(id) ? { value: settingValues.get(id) } : null,
        upsert: async (id, value) => { settingValues.set(id, value) },
      }
    },
    [sourceUrl('src/main/mainTranslator.js')]: {
      createMainTranslator: async () => (key, parameters) => parameters ? `${key} ${JSON.stringify(parameters)}` : key,
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

test('custom arguments run only after the user approves them for that player', async () => {
  settingValues.set('externalPlayer', 'mpv')
  settingValues.set('externalPlayerExecutable', process.execPath)
  settingValues.set('externalPlayerCustomArgs', JSON.stringify(['--eval', '']))
  settingValues.delete('externalPlayerApprovedArgs')
  messageBoxes.length = 0
  const launch = async () => {
    const event = createEvent()
    await handleOpenInExternalPlayer(event, { videoId: 'dQw4w9WgXcQ' })
    return event.replies
  }
  try {
    messageBoxResponse = 0
    assert.deepEqual(await launch(), [[IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, 'mpv', [], false, false, true]])
    assert.equal(messageBoxes.length, 1)
    // The dialog shows the program and each argument exactly.
    assert.match(messageBoxes[0].detail, new RegExp(`^${process.execPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n"--eval"\n""\n`))
    assert.equal(settingValues.has('externalPlayerApprovedArgs'), false)

    messageBoxResponse = 1
    assert.deepEqual(await launch(), [[IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, 'mpv', [], false, false]])
    assert.deepEqual(await launch(), [[IpcChannels.OPEN_IN_EXTERNAL_PLAYER_RESULT, 'mpv', [], false, false]])
    assert.equal(messageBoxes.length, 2)

    // Another player or changed arguments need a new approval.
    settingValues.set('externalPlayer', 'vlc')
    await launch()
    settingValues.set('externalPlayer', 'mpv')
    settingValues.set('externalPlayerCustomArgs', JSON.stringify(['--eval', '1']))
    await launch()
    assert.equal(messageBoxes.length, 4)

    settingValues.set('externalPlayerCustomArgs', '[]')
    await launch()
    assert.equal(messageBoxes.length, 4)
  } finally {
    settingValues.delete('externalPlayerCustomArgs')
    messageBoxResponse = 1
  }
})
