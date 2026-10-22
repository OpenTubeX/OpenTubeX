import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    function cleanUpCustomPlayerControls() {')
assert.notEqual(start, -1, 'Update the cleanup harness after renaming cleanUpCustomPlayerControls')
const end = source.indexOf('\n    }', start)
assert.notEqual(end, -1, 'Update the cleanup harness after changing the function boundary')
const cleanup = source.slice(start, end + 6)

for (const players of [1, 2]) {
  test(`control factory cleanup with ${players} mounted player(s)`, () => {
    const factory = { create() {} }
    const survivingFactory = { create() {} }
    const entries = new Map([['ft_lights_off', factory], ['ft_chapters', factory]])
    const bigEntries = new Map([['ft_skip_previous', factory], ['ft_skip_next', factory]])
    const registry = {
      registerElement: (name, value) => entries.set(name, value),
      registerBigElement: (name, value) => bigEntries.set(name, value)
    }
    const reRegisterOwnElements = () => { throw new Error('Disposed factories must not be registered again') }
    const restoreSurvivor = () => {
      registry.registerElement('ft_lights_off', survivingFactory)
      registry.registerElement('ft_chapters', survivingFactory)
      registry.registerBigElement('ft_skip_previous', survivingFactory)
      registry.registerBigElement('ft_skip_next', survivingFactory)
    }
    const liveCustomControlPlayers = new Set([reRegisterOwnElements])
    if (players === 2) liveCustomControlPlayers.add(restoreSurvivor)
    const defaultShakaElementFactories = new Map([['captions', { create() {} }], ['quality', { create() {} }]])
    const context = vm.createContext({
      removeAbRepeatContext: null,
      removeLoopButtonContext: null,
      removeCopyVideoUrlContext: null,
      removeQuickPlaybackRateBarContext: null,
      registeredCustomControls: true,
      liveCustomControlPlayers,
      reRegisterOwnElements,
      defaultShakaElementFactories,
      ownElementRegistrations: ['captions', 'quality', 'ft_lights_off', 'ft_chapters'].map(name => [registry, name, factory]),
      ownBigElementRegistrations: ['ft_skip_previous', 'ft_skip_next'].map(name => [name, factory]),
      shakaControls: registry,
      shakaOverflowMenu: registry,
      shakaContextMenu: registry,
    })
    vm.runInContext(`${cleanup}\ncleanUpCustomPlayerControls()`, context)
    assert.equal(entries.get('ft_lights_off'), players === 1 ? null : survivingFactory)
    assert.equal(entries.get('ft_chapters'), players === 1 ? null : survivingFactory)
    assert.equal(bigEntries.get('ft_skip_previous'), players === 1 ? null : survivingFactory)
    assert.equal(bigEntries.get('ft_skip_next'), players === 1 ? null : survivingFactory)
    assert.equal(liveCustomControlPlayers.size, players - 1)
    if (players === 1) {
      // Shaka's default layout includes these, so they get Shaka's own controls back
      assert.equal(entries.get('captions'), defaultShakaElementFactories.get('captions'))
      assert.equal(entries.get('quality'), defaultShakaElementFactories.get('quality'))
    }
    vm.runInContext('cleanUpCustomPlayerControls()', context)
    assert.equal(liveCustomControlPlayers.size, players - 1, 'repeated teardown must preserve survivors')
  })
}
