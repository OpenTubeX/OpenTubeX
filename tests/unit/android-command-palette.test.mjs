import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { load } from 'js-yaml'
import { createSettingsSearchIndex } from '../../src/renderer/helpers/settingsSearch.js'
import { isPlayerRoutePath } from '../../src/renderer/tabs/playerDockDestination.js'

const messages = load(await readFile(new URL('../../static/locales/en-US.yaml', import.meta.url), 'utf8'))
const source = (await readFile(new URL('../../src/renderer/helpers/commandPaletteRegistry.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace('export function', 'function')
const shortcuts = { APP: { GENERAL: {} }, VIDEO_PLAYER: { GENERAL: {}, PLAYBACK: {} } }
const loadRegistry = isLiteBuild => new Function('createSettingsSearchIndex', 'getConfiguredKeyboardShortcuts',
  'DefaultKeyboardShortcuts', 'KeyboardShortcuts', 'shouldShowKeyboardShortcutCommand',
  'isTrendingAvailable', 'isMostPopularAvailable', 'isLiteBuild', 'isPlayerRoutePath', `${source}\nreturn createCommandPaletteRegistry`)(
  createSettingsSearchIndex, () => shortcuts, shortcuts, shortcuts, () => false, () => false, () => false, isLiteBuild, isPlayerRoutePath
)
const createRegistry = loadRegistry(false)

test('opening the ordinary command registry does not read the video library', () => {
  const getters = {
    getChannelsHiddenParsed: [],
    getForbiddenTitlesParsed: [],
    getTabs: [],
    getProfileList: [],
    getAllPlaylists: [],
    getYtDlpDownloads: {},
    getCustomThemes: [],
  }
  Object.defineProperty(getters, 'getHistoryCacheSorted', {
    get: () => { throw new Error('History was scanned before searching') },
  })
  assert.doesNotThrow(() => createRegistry({
    isElectron: false,
    downloads: [],
    isCapacitor: false,
    routePath: '/history',
    routeAvailable: () => true,
    t: key => key,
    tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
    store: { getters },
  }))
})

test('download settings commands respect Android availability', () => {
  let openedSection
  let openedSearch
  const commands = createRegistry({
    isElectron: false,
    downloads: [],
    isCapacitor: true,
    routePath: '/history',
    routeAvailable: () => true,
    t: key => key,
    tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
    store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {}, getCustomThemes: [] } },
    openSettingsSection: section => { openedSection = section },
    openSettingsSearchResult: (section, match) => { openedSearch = { section, match } },
  })
  assert.ok(!commands.some(command => command.id === 'playback.fullwindow'))
  const downloads = commands.find(command => command.id === 'settings.download')
  assert.equal(downloads.disabledReason, '')
  const results = commands.filter(command => command.id.startsWith('settings.search.download.'))
  assert.ok(results.length > 0)
  downloads.run()
  assert.equal(openedSection, 'download')
  results[0].run()
  assert.equal(openedSearch.section, 'download')
  assert.ok(openedSearch.match.label)
})

test('lite Android builds omit download commands', () => {
  const createLiteRegistry = loadRegistry(true)
  const commands = createLiteRegistry({
    isElectron: false,
    downloads: [],
    isCapacitor: true,
    routePath: '/history',
    routeAvailable: () => true,
    t: key => key,
    tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
    store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {}, getCustomThemes: [] } },
  })
  assert.ok(commands.some(command => command.id === 'settings.root'))
  assert.ok(!commands.some(command => ['settings.download', 'downloads.open'].includes(command.id)))
})
