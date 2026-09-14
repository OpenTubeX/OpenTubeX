import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    function cleanUpCustomPlayerControls() {')
const cleanup = source.slice(start, source.indexOf('\n    }', start) + 6)

for (const players of [1, 2]) {
  test(`Lights Off factory cleanup with ${players} mounted player(s)`, () => {
    const factory = { create() {} }
    const entries = new Map([['ft_lights_off', factory]])
    const registry = { registerElement: (name, value) => entries.set(name, value) }
    const context = vm.createContext({
      removeAbRepeatContext: null,
      removeLoopButtonContext: null,
      removeCopyVideoUrlContext: null,
      removeQuickPlaybackRateBarContext: null,
      registeredCustomControls: true,
      liveCustomControlPlayers: players,
      shakaControls: registry,
      shakaOverflowMenu: registry,
      shakaContextMenu: registry,
    })
    vm.runInContext(`${cleanup}\ncleanUpCustomPlayerControls()`, context)
    assert.equal(entries.get('ft_lights_off'), players === 1 ? null : factory)
  })
}
