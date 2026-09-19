import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed } from 'vue'

const component = await readFile(new URL('../../src/renderer/views/Downloads/DownloadRow.vue', import.meta.url), 'utf8')
const start = component.indexOf('const allDestinations =')
const end = component.indexOf('const hiddenDestinationCount =', start)
const helper = await readFile(new URL('../../src/renderer/helpers/androidStorage.js', import.meta.url), 'utf8')

for (const [path, display] of [
  ['content://com.android.externalstorage.documents/tree/primary%3ADownload%2FOpenTubeX/document/primary%3ADownload%2FOpenTubeX%2FFAKE', '/sdcard/Download/OpenTubeX/FAKE'],
  ['content://com.android.externalstorage.documents/tree/1234-ABCD%3AMovies', '/storage/1234-ABCD/Movies'],
  ['content://com.android.externalstorage.documents/tree/01234567-89ab-cdef-0123-456789abcdef%3AMovies', '/storage/01234567-89ab-cdef-0123-456789abcdef/Movies'],
  ['/home/nico/Downloads/video.mp4', '/home/nico/Downloads/video.mp4'],
  ['content://cloud.provider/document/opaque', 'content://cloud.provider/document/opaque'],
  ['content://com.android.externalstorage.documents/tree/%XX', 'content://com.android.externalstorage.documents/tree/%XX'],
]) {
  test(`download destination display: ${path}`, () => {
    const result = vm.runInNewContext(`${helper.replace(/^import .*\n/gm, '').replace(/^export /gm, '')}\n${component.slice(start, end)}; destinations.value`, {
      computed, URL, process: { env: { IS_CAPACITOR: true } }, registerPlugin: () => ({}),
      MAX_VISIBLE_DESTINATIONS: 3, props: { download: { destinations: [path] } },
    })
    assert.equal(result[0], display)
  })
}
