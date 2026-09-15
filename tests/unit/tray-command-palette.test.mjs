import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from 'js-yaml'
import { createSettingsSearchIndex } from '../../src/renderer/helpers/settingsSearch.js'

const messages = load(await readFile(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8'))
const source = (await readFile(new URL('../../src/renderer/helpers/commandPaletteRegistry.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export function', 'function')
const shortcuts = { APP: { GENERAL: {} }, VIDEO_PLAYER: { GENERAL: {}, PLAYBACK: {} } }
const createRegistry = new Function('createSettingsSearchIndex', 'getConfiguredKeyboardShortcuts',
  'DefaultKeyboardShortcuts', 'KeyboardShortcuts', 'shouldShowKeyboardShortcutCommand',
  'isTrendingAvailable', 'isMostPopularAvailable', `${source}\nreturn createCommandPaletteRegistry`)(
  createSettingsSearchIndex, () => shortcuts, shortcuts, shortcuts, () => false, () => false, () => false
)


for (const supported of [false, true]) {
  test(`command palette tray minimize follows KWin capability: ${supported}`, () => {
    const commands = createRegistry({
      isElectron: true,
      isCapacitor: false,
      isLinuxWayland: true,
      supportsAutoPictureInPictureMinimize: supported,
      routePath: '/settings',
      routeAvailable: () => true,
      t: key => key,
      tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
      store: { getters: { getTabHistoryState: () => ({}), getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {} } },
    })
    assert.equal(commands.some(command => command.label === 'Minimize to system tray'), supported)
  })
}
