import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerCustomThemeIpc } from '../../src/main/customThemeIpc.js'

const trustedUrl = 'app://bundle/index.html'
const selectedTheme = { id: 'selected', basedOn: 'dark', isDark: true, mainColor: '#123456', secondaryColor: '#654321' }

function setup(initialSettings = {}) {
  const handlers = new Map()
  const settings = new Map(Object.entries(initialSettings))
  const writes = []
  const messages = []
  let themes = [selectedTheme]
  const store = {
    load: async () => themes,
    save: async theme => { themes = [...themes, theme]; return themes },
    replace: async replacement => { themes = replacement; return themes },
    remove: async id => { themes = themes.filter(theme => theme.id !== id); return themes }
  }
  const nativeTheme = { themeSource: 'system' }
  registerCustomThemeIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    isTrustedUrl: url => url === trustedUrl,
    store,
    settings: { _findOne: async id => ({ value: settings.get(id) }) },
    updateSetting: async (key, value, expectedValue) => {
      writes.push([key, value, expectedValue])
      settings.set(key, value)
    },
    nativeTheme,
    getWindows: () => [{ webContents: {
      getURL: () => trustedUrl,
      send: (...args) => messages.push(args)
    } }],
    setBaseThemeSource: value => { nativeTheme.themeSource = value }
  })
  return { handlers, settings, writes, messages, nativeTheme }
}

test('custom theme IPC rejects untrusted writes', async () => {
  const { handlers, writes, messages } = setup()
  assert.equal(await handlers.get(IpcChannels.CUSTOM_THEME_SAVE)(
    { senderFrame: { url: 'https://example.com' } }, selectedTheme
  ), undefined)
  assert.deepEqual(writes, [])
  assert.deepEqual(messages, [])
})

test('deleting the selected custom theme repairs theme settings and broadcasts', async () => {
  const { handlers, writes, messages, nativeTheme } = setup({
    baseTheme: 'custom:selected',
    systemLightTheme: 'custom:selected',
    systemDarkTheme: 'custom:selected'
  })
  const result = await handlers.get(IpcChannels.CUSTOM_THEME_DELETE)(
    { senderFrame: { url: trustedUrl } }, 'selected'
  )
  assert.deepEqual(result, [])
  assert.deepEqual(writes, [
    ['systemLightTheme', 'light', 'custom:selected'],
    ['systemDarkTheme', 'dark', 'custom:selected'],
    ['mainColor', '#123456', undefined],
    ['secColor', '#654321', undefined],
    ['baseTheme', 'dark', undefined]
  ])
  assert.equal(nativeTheme.themeSource, 'dark')
  assert.deepEqual(messages, [[IpcChannels.CUSTOM_THEME_UPDATED, []]])
})
