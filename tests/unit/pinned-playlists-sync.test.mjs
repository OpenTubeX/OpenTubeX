import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')
const start = source.indexOf('export function getSyncableSettingKeys(')
const exclusionsStart = source.indexOf('export const NON_SYNCABLE_SETTINGS')
const syncabilityStart = source.indexOf('export function isSettingSyncable(')
const enabledStart = source.indexOf('export function isSettingSyncEnabled(')
const getSyncableSettingKeys = vm.runInNewContext(
  `${source.slice(exclusionsStart, source.indexOf('\n])', exclusionsStart) + 3).replace('export ', '')}
${source.slice(syncabilityStart, source.indexOf('\n}\n', syncabilityStart) + 2).replace('export ', '')}
${source.slice(enabledStart, source.indexOf('\n}\n', enabledStart) + 2).replace('export ', '')}
${source.slice(start, source.indexOf('\n}\n', start) + 2).replace('export ', '')}
getSyncableSettingKeys`,
  {
    state: { pinnedChannelMetadata: {}, pinnedChannels: [], pinnedPlaylistIds: [], userPlaylistsSortBy: 'custom' },
    NON_TRANSFERABLE_SETTINGS: new Set(),
    SUBSCRIPTION_CHANNEL_SETTINGS_SYNC_KEY: 'subscriptionChannelSettings',
    isSettingSyncableOnPlatform: () => true,
  }
)

test('channel pins sync independently while playlist pins require playlist sync', () => {
  assert.deepEqual([...getSyncableSettingKeys({ syncServerSyncPlaylists: true })], ['pinnedChannels', 'pinnedPlaylistIds', 'userPlaylistsSortBy'])
  assert.deepEqual([...getSyncableSettingKeys({ syncServerSyncPlaylists: false })], ['pinnedChannels', 'userPlaylistsSortBy'])
})
