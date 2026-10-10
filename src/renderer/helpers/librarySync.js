import { DBLibraryHandlers } from '../../datastores/handlers/index'

export async function prepareHistorySync({ remoteHistory, previous, options, acknowledged }) {
  const { id } = await DBLibraryHandlers.query('syncHistoryStart', { options, previousIsArray: Array.isArray(previous) })
  try {
    async function stage(section, records) {
      let batch = []
      for (const record of records) {
        batch.push(record)
        if (batch.length === 250) { await DBLibraryHandlers.query('syncHistoryChunk', { id, section, records: batch }); batch = [] }
      }
      if (batch.length) await DBLibraryHandlers.query('syncHistoryChunk', { id, section, records: batch })
    }
    if (remoteHistory[Symbol.asyncIterator]) {
      for await (const records of remoteHistory) {
        if (records === null) { await DBLibraryHandlers.query('syncHistoryCancel', { id }); return null }
        await stage('remote', records)
      }
    } else await stage('remote', remoteHistory)
    function * entries() { for (const id in previous) if (Object.hasOwn(previous, id)) yield [id, previous[id]] }
    await stage('previous', Array.isArray(previous) ? previous : entries())
    await stage('acknowledgedUpserts', acknowledged.upserts)
    await stage('acknowledgedDeletions', acknowledged.deletions)
    return { id, ...await DBLibraryHandlers.query('syncHistoryPlan', { id }) }
  } catch (error) { await DBLibraryHandlers.query('syncHistoryCancel', { id }).catch(console.error); throw error }
}

export function historySyncPage(id, section, offset) {
  return DBLibraryHandlers.query('syncHistoryPage', { id, section, offset })
}
export function applyHistorySync(id) { return DBLibraryHandlers.query('syncHistoryApply', { id }) }
export function cancelHistorySync(id) { return DBLibraryHandlers.query('syncHistoryCancel', { id }) }

export async function syncPlaylistMembers(client, store, { localId, remoteId, remoteVideos, previousVideos, metadata, options }) {
  const { id } = await DBLibraryHandlers.query('syncPlaylistStart', { kind: 'playlist', playlistId: localId, metadata, options })
  try {
    for (const [section, records] of Object.entries({ remote: remoteVideos, previous: previousVideos ?? [] })) for (let offset = 0; offset < records.length; offset += 250) await DBLibraryHandlers.query('syncPlaylistChunk', { id, section, records: records.slice(offset, offset + 250) })
    const { counts } = await DBLibraryHandlers.query('syncPlaylistPlan', { id })
    for (const section of ['playlistUploads', 'playlistRemovals']) {
      for (let offset = 0; offset < counts[section]; offset += 100) {
        store.assertActive?.()
        const page = await DBLibraryHandlers.query('syncPlaylistPage', { id, section, offset })
        if (!page.current) throw new Error('The playlist changed during sync. Try again.')
        if (section === 'playlistUploads') await client.addPlaylistVideos(remoteId, page.records)
        else for (const videoId of page.records) await client.removePlaylistVideo(remoteId, videoId)
      }
    }
    store.assertActive?.()
    if (!await DBLibraryHandlers.query('syncPlaylistApply', { id })) throw new Error('The playlist changed during sync. Try again.')
    await store.dispatch('grabAllPlaylists')
    const videos = []
    for (let offset = 0; offset < counts.playlistIds; offset += 100) videos.push(...(await DBLibraryHandlers.query('syncPlaylistPage', { id, section: 'playlistIds', offset })).records)
    return { remoteId, metadata, videos }
  } finally { await DBLibraryHandlers.query('syncPlaylistCancel', { id }).catch(console.error) }
}
