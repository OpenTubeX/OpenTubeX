import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const start = source.indexOf('    const showOfflineMessage = computed(')
const expression = source.slice(start, source.indexOf('\n    // #endregion offline message', start))

for (const format of ['legacy', 'audio']) {
  test(`offline warning stays hidden while seeking downloaded ${format} media`, () => {
    const props = reactive({ localFilePlayback: true, format })
    const isOffline = ref(true)
    const isBuffering = ref(false)
    const visible = vm.runInNewContext(`${expression}\nshowOfflineMessage`, { computed, props, isOffline, isBuffering })
    assert.equal(visible.value, false)
    isBuffering.value = true
    assert.equal(visible.value, false, 'local seeking must not show a network warning')
    props.localFilePlayback = false
    assert.equal(visible.value, true, 'online streams still warn while buffering offline')
    isOffline.value = false
    assert.equal(visible.value, false)
    isOffline.value = true
    isBuffering.value = false
    assert.equal(visible.value, false)
  })
}
