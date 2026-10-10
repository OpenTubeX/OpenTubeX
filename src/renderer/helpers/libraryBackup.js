import { DBLibraryHandlers } from '../../datastores/handlers/index'

export async function writeLibraryBackup(settings, filename, description, directoryId, startIn, options = {}) {
  let writable
  let job
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      excludeAcceptAllOption: true,
      id: directoryId,
      startIn,
      types: [{ description, accept: options.format === 'ndjson' ? { 'application/x-freetube-db': ['.db'] } : options.format === 'youtubeHistory' ? { 'application/json': ['.json'] } : { 'application/zip': ['.zip'] } }],
    })
    writable = await handle.createWritable()
    job = await DBLibraryHandlers.query('exportStart', { settings, ...options })
    while (true) {
      const chunk = await DBLibraryHandlers.query('exportNext', { id: job.id })
      if (chunk.data.length) await writable.write(chunk.data)
      if (chunk.done) break
    }
    await writable.close()
    writable = null
    return true
  } catch (error) {
    await writable?.abort().catch(console.error)
    if (error.name === 'AbortError') return false
    throw error
  } finally {
    if (job) await DBLibraryHandlers.query('exportCancel', { id: job.id }).catch(console.error)
  }
}

export async function stageLibraryBackup(file) {
  const job = await DBLibraryHandlers.query('importStart')
  const reader = file.stream().getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      for (let offset = 0; offset < value.length; offset += 65536) await DBLibraryHandlers.query('importChunk', { id: job.id, data: value.slice(offset, offset + 65536) })
    }
    return await DBLibraryHandlers.query('importFinish', job)
  } catch (error) {
    await DBLibraryHandlers.query('importCancel', job).catch(console.error)
    throw error
  } finally {
    await reader.cancel().catch(console.error)
    reader.releaseLock()
  }
}

// Older file parsers provide only incoming records. The worker merges against
// the current durable library inside one transaction, including off-page data.
export async function importLibraryRecords(section, records) {
  const job = await DBLibraryHandlers.query('importStart', { format: 'records' })
  try {
    for (let offset = 0; offset < records.length; offset += 250) await DBLibraryHandlers.query('importChunk', { id: job.id, section, records: records.slice(offset, offset + 250) })
    await DBLibraryHandlers.query('importFinish', job)
    await DBLibraryHandlers.query('importApply', { id: job.id, sections: [section] })
    if (section === 'history') await (await import('../store/index')).default.dispatch('grabHistory')
    if (section === 'playlists') await (await import('../store/index')).default.dispatch('grabAllPlaylists')
  } finally { await DBLibraryHandlers.query('importCancel', job).catch(console.error) }
}
