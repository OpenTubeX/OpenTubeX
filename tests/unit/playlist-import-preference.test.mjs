import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
const importSource = source.slice(source.indexOf('async function importPlaylists()'), source.indexOf('async function exportPlaylists()'))

for (const preference of [undefined, false, true]) {
  for (const existing of [false, true]) {
    test(`playlist import retains preference ${preference} with an existing playlist ${existing}`, async () => {
      const imported = { _id: 'custom', playlistName: 'My playlist', videos: [{ videoId: 'new-a', title: 'A', lengthSeconds: 60, timeAdded: 1 }, { videoId: 'new-b', title: 'B', lengthSeconds: 60, timeAdded: 1 }], ...(preference === undefined ? {} : { addVideosToTop: preference }) }
      const current = { _id: 'custom', playlistName: 'My playlist', videos: [{ videoId: 'existing', title: 'Existing', lengthSeconds: 60, timeAdded: 1 }], addVideosToTop: true }
      const toasts = []
      const writes = []
      const run = vm.runInNewContext(importSource + '\nimportPlaylists', {
        allPlaylists: { value: existing ? [current] : [] },
        readFileWithPicker: async () => ({ filename: 'playlist.db', content: JSON.stringify(imported) }),
        IMPORT_DIRECTORY_ID: 'import', START_IN_DIRECTORY: 'documents',
        parseImportedLineDelimitedJson: data => [JSON.parse(data)],
        normalizeImportedPlaylistThumbnail: async () => {},
        isJsonObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
        deepCopy: structuredClone,
        processToBeAddedPlaylistVideo: () => {},
        store: { dispatch: (action, payload) => writes.push({ action, payload }) },
        showToast: value => toasts.push(value),
        t: value => value,
        console,
      })
      await run()
      assert.equal(writes.length, 1)
      const playlist = existing ? { ...current, ...writes[0].payload } : writes[0].payload[0]
      assert.equal(playlist.addVideosToTop, preference === undefined && existing ? true : preference)
      assert.ok(toasts.every(toast => !toast.message.includes('Unknown data key')))
      const expected = !existing ? ['new-a', 'new-b'] : playlist.addVideosToTop ? ['new-a', 'new-b', 'existing'] : ['existing', 'new-a', 'new-b']
      assert.deepEqual(Array.from(playlist.videos, video => video.videoId), expected)
    })
  }
}
