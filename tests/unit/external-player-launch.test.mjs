import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

// The handler reads the bundled player map relative to the Rspack output
globalThis.__dirname = fileURLToPath(new URL('../../', import.meta.url))

const settingValues = new Map()
/** @type {object[]} */
const messageBoxes = []
let messageBoxResponse = 1
const [{ handleOpenInExternalPlayer }] = await importWithStubs(
  [sourceUrl('src/main/externalPlayer.js')],
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
  return {
    senderFrame: { url: 'app://bundle/index.html' },
    sender: { isFocused: () => true, isDestroyed: () => false },
  }
}

/** @param {'opened' | 'failed' | 'cancelled'} status */
const result = (status, externalPlayer = 'mpv') => ({ externalPlayer, unsupportedActions: [], isPlaylist: false, status })

test('a missing external player executable is reported instead of crashing the main process', async () => {
  settingValues.set('externalPlayer', 'mpv')
  settingValues.set('externalPlayerExecutable', fileURLToPath(new URL('./missing-external-player', import.meta.url)))
  const uncaught = []
  const onUncaught = error => uncaught.push(error)
  process.prependListener('uncaughtException', onUncaught)
  try {
    const launched = await handleOpenInExternalPlayer(createEvent(), { videoId: 'dQw4w9WgXcQ' })
    // A spawn error is emitted on a later tick
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(uncaught, [])
    assert.deepEqual(launched, result('failed'))
  } finally {
    process.removeListener('uncaughtException', onUncaught)
  }
})

test('a started external player is reported as opening', async () => {
  settingValues.set('externalPlayer', 'mpv')
  settingValues.set('externalPlayerExecutable', process.execPath)
  settingValues.set('externalPlayerCustomArgs', JSON.stringify(['--eval', '']))
  try {
    assert.deepEqual(await handleOpenInExternalPlayer(createEvent(), { videoId: 'dQw4w9WgXcQ' }), result('opened'))
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
  const launch = () => handleOpenInExternalPlayer(createEvent(), { videoId: 'dQw4w9WgXcQ' })
  try {
    messageBoxResponse = 0
    // The renderer marks the video watched and removes it from the queue only once it opened.
    assert.deepEqual(await launch(), result('cancelled'))
    assert.equal(messageBoxes.length, 1)
    // The dialog shows the program and each argument exactly.
    assert.match(messageBoxes[0].detail, new RegExp(`^${process.execPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n"--eval"\n""\n`))
    assert.equal(settingValues.has('externalPlayerApprovedArgs'), false)

    messageBoxResponse = 1
    assert.deepEqual(await launch(), result('opened'))
    assert.deepEqual(await launch(), result('opened'))
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

    // So does another program for the same player and arguments.
    settingValues.set('externalPlayerCustomArgs', JSON.stringify(['--eval', '1']))
    settingValues.set('externalPlayerExecutable', fileURLToPath(new URL('./missing-external-player', import.meta.url)))
    await launch()
    assert.equal(messageBoxes.length, 5)
  } finally {
    settingValues.set('externalPlayerExecutable', process.execPath)
    settingValues.delete('externalPlayerCustomArgs')
    messageBoxResponse = 1
  }
})
