import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/FtToast/FtToast.vue', import.meta.url), 'utf8')
const handler = source.match(/function updateFullscreenTarget\(\) \{[\s\S]*?\n\}/)[0]

test('toasts follow browser fullscreen entry and exit', () => {
    const player = { id: 'player' }
    const fullscreenTarget = { value: null }
    const document = { fullscreenElement: null }
    const update = vm.runInNewContext(`${handler}; updateFullscreenTarget`, { document, fullscreenTarget })
    update()
    assert.equal(fullscreenTarget.value, null)

    document.fullscreenElement = player
    update()
    assert.equal(fullscreenTarget.value, player, 'Toasts must move inside the visible fullscreen player')

    document.fullscreenElement = null
    update()
    assert.equal(fullscreenTarget.value, null, 'Toasts must return to their normal location on exit')
})
