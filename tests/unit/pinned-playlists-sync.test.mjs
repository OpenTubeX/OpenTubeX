import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const start = source.indexOf('export function getSyncableSettingKeys(')
const getSyncableSettingKeys = vm.runInNewContext(
  `${source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export ', '')}\ngetSyncableSettingKeys`,
  {
    state: { pinnedChannels: [], pinnedPlaylistIds: [], userPlaylistsSortBy: 'custom' },
    isSettingSyncEnabled: () => true,
    isSettingSyncableOnPlatform: () => true,
  }
)

test('channel pins sync independently while playlist pins require playlist sync', () => {
  assert.deepEqual([...getSyncableSettingKeys({ syncServerSyncPlaylists: true })], ['pinnedChannels', 'pinnedPlaylistIds', 'userPlaylistsSortBy'])
  assert.deepEqual([...getSyncableSettingKeys({ syncServerSyncPlaylists: false })], ['pinnedChannels', 'userPlaylistsSortBy'])
})
