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

for (const isCapacitor of [true, false]) {
  test(`download settings commands respect Android availability: ${isCapacitor}`, () => {
    let openedSection
    let openedSearch
    const commands = createRegistry({
      isElectron: false,
      isCapacitor,
      routePath: '/settings',
      routeAvailable: () => true,
      t: key => key,
      tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
      store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {} } },
      openSettingsSection: section => { openedSection = section },
      openSettingsSearchResult: (section, match) => { openedSearch = { section, match } },
    })
    assert.equal(commands.some(command => command.id === 'playback.fullwindow'), !isCapacitor)
    const downloads = commands.find(command => command.id === 'settings.download')
    assert.equal(downloads.disabledReason === '', isCapacitor)
    const results = commands.filter(command => command.id.startsWith('settings.search.download.'))
    assert.equal(results.length > 0, isCapacitor)
    if (isCapacitor) {
      downloads.run()
      assert.equal(openedSection, 'download')
      results[0].run()
      assert.equal(openedSearch.section, 'download')
      assert.ok(openedSearch.match.label)
    }
  })
}

test('extra thumbnail action commands are available only in desktop layouts', () => {
  for (const isCapacitor of [false, true]) {
    for (const phoneLayout of [false, true]) {
      const commands = createRegistry({
        isElectron: false,
        isCapacitor,
        phoneLayout,
        routePath: '/settings',
        routeAvailable: () => true,
        t: key => key,
        tm: path => path.split('.').reduce((value, key) => value?.[key], messages),
        store: { getters: { getChannelsHiddenParsed: [], getForbiddenTitlesParsed: [], getTabs: [], getProfileList: [], getAllPlaylists: [], getYtDlpDownloads: {} } },
      })
      const hasThumbnailAction = commands.some(command => (
        command.id.startsWith('settings.search.general.') && command.label === 'Extra Thumbnail Action Button'
      ))
      assert.equal(hasThumbnailAction, !isCapacitor && !phoneLayout,
        `isCapacitor=${isCapacitor}, phoneLayout=${phoneLayout}`)
    }
  }
})

const shortcutPrompt = await readFile(new URL('../../src/renderer/components/FtKeyboardShortcutPrompt/FtKeyboardShortcutPrompt.vue', import.meta.url), 'utf8')
const bindingCollector = shortcutPrompt.slice(shortcutPrompt.indexOf('function getAllKeyboardShortcutBindings('), shortcutPrompt.indexOf('function getShortcutActionLabel('))
for (const isCapacitor of [true, false]) {
  test(`Full Window shortcut conflicts respect Android availability: ${isCapacitor}`, () => {
    const collect = new Function('process', 'isKeyboardShortcutEditable', 'getNestedValue', 'DefaultKeyboardShortcuts', `${bindingCollector}\nreturn getAllKeyboardShortcutBindings`)(
      { env: { IS_CAPACITOR: isCapacitor } }, () => true, () => '', {}
    )
    const bindings = collect({ VIDEO_PLAYER: { GENERAL: { FULLWINDOW: 's', FULLSCREEN: 'f' } } })
    assert.deepEqual(bindings.map(binding => binding.code), isCapacitor ? ['FULLSCREEN'] : ['FULLWINDOW', 'FULLSCREEN'])
  })
}
