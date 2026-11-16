import { legacyLinesWithout } from './legacyLines.js'

// NeDB keeps its query/index implementation; only its Android persistence
// adapter changes. Store each serialized document separately, including dates
// in NeDB's own format, rather than copying an ever-growing append log.
export function createAndroidRecordStorage(factory = indexedDB, native = null) {
  if (native) return createNativeRecordStorage(native, filename => readShippedRecords(factory, filename), (filename, ids) => removeShippedRecords(factory, filename, ids))
  const databases = new Map()

  function transaction(database, stores, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode)
      let result
      let failure
      const fail = error => {
        failure = error
        tx.abort()
      }
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error)
      try {
        operation(tx, value => { result = value }, fail)
      } catch (error) {
        fail(error)
      }
    })
  }

  function open(name, upgrade) {
    return new Promise((resolve, reject) => {
      const request = upgrade ? factory.open(name, 1) : factory.open(name)
      request.onupgradeneeded = () => upgrade?.(request.result)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  function apply(store, lines) {
    for (const line of lines) {
      if (!line) continue
      const record = JSON.parse(line)
      if (record._id) {
        const key = `document:${record._id}`
        if (record.$$deleted) store.delete(key)
        else store.put(line, key)
      } else if (record.$$indexCreated) {
        store.put(line, `index:${record.$$indexCreated.fieldName}`)
      } else if (record.$$indexRemoved) {
        store.delete(`index:${record.$$indexRemoved}`)
      }
    }
  }

  async function initialize(filename) {
    const database = await open(`opentubex-records-${filename}`, db => {
      db.createObjectStore('records')
      db.createObjectStore('metadata')
    })
    database.onversionchange = () => {
      databases.delete(filename)
      database.close()
    }
    database.onclose = () => databases.delete(filename)
    try {
      const imported = await transaction(database, ['metadata'], 'readonly', (tx, done) => {
        const request = tx.objectStore('metadata').get('imported')
        request.onsuccess = () => done(request.result)
      })
      if (imported !== 'complete') {
        // The shipped browser adapter uses this IndexedDB database and store.
        const legacy = await open('NeDB')
        try {
          if (!imported) {
            const raw = legacy.objectStoreNames.contains('nedbdata')
              ? await transaction(legacy, ['nedbdata'], 'readonly', (tx, done) => {
                  const request = tx.objectStore('nedbdata').get(filename)
                  request.onsuccess = () => done(request.result)
                })
              : ''
            // Match the shipped datastore's corruptAlertThreshold: 1: recover
            // valid records even when a legacy line cannot be parsed.
            const lines = (raw || '').split('\n').filter(line => {
              try { return line !== '' && JSON.parse(line) != null } catch { return false }
            })
            await transaction(database, ['records', 'metadata'], 'readwrite', (tx, done, fail) => {
              const metadata = tx.objectStore('metadata')
              const request = metadata.get('imported')
              request.onsuccess = () => {
                if (request.result) return
                try {
                  apply(tx.objectStore('records'), lines)
                  metadata.put('imported', 'imported')
                } catch (error) { fail(error) }
              }
            })
          }
          if (legacy.objectStoreNames.contains('nedbdata')) {
            await transaction(legacy, ['nedbdata'], 'readwrite', tx => tx.objectStore('nedbdata').delete(filename))
          }
          await transaction(database, ['metadata'], 'readwrite', tx => tx.objectStore('metadata').put('complete', 'imported'))
        } finally { legacy.close() }
      }
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  function database(filename) {
    if (!databases.has(filename)) {
      databases.set(filename, initialize(filename).catch(error => {
        databases.delete(filename)
        throw error
      }))
    }
    return databases.get(filename)
  }

  return {
    async readFileAsync(filename) {
      return transaction(await database(filename), ['records'], 'readonly', (tx, done) => {
        const request = tx.objectStore('records').getAll()
        request.onsuccess = () => done(request.result.join('\n'))
      })
    },
    async appendFileAsync(filename, contents) {
      const lines = contents.split('\n').filter(Boolean)
      for (const line of lines) JSON.parse(line)
      if (!lines.length) return
      return transaction(await database(filename), ['records'], 'readwrite', tx => apply(tx.objectStore('records'), lines))
    },
    async unlinkAsync(filename) {
      return transaction(await database(filename), ['records'], 'readwrite', tx => tx.objectStore('records').clear())
    },
    async removeDocumentsAsync(filename, ids) {
      return transaction(await database(filename), ['records'], 'readwrite', tx => apply(tx.objectStore('records'), deletions(ids).split('\n')))
    },
    // Records are already compacted on every update. Startup compaction must
    // not rewrite them or overwrite a concurrent transaction's newer records.
    async crashSafeWriteFileLinesAsync() {},
    async existsAsync() { return true },
    async ensureDatafileIntegrityAsync() {},
    async ensureParentDirectoryExistsAsync() {},
  }
}

/**
 * Opens a migration source only if it exists, without creating an empty
 * IndexedDB: WebView may already be refusing writes under storage pressure.
 * @template T
 * @param {IDBFactory} factory
 * @param {string} name
 * @param {(database: IDBDatabase) => Promise<T>} operation
 * @returns {Promise<T | null>}
 */
async function withExistingDatabase(factory, name, operation) {
  if (typeof factory.databases === 'function' && !(await factory.databases()).some(database => database.name === name)) return null
  const database = await new Promise((resolve, reject) => {
    let missing = false
    const request = factory.open(name)
    // Without enumeration, probe the known names but roll back an attempted
    // creation. Never leave an empty database.
    request.onupgradeneeded = () => {
      missing = true
      request.transaction.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => missing ? resolve(null) : reject(request.error)
  })
  if (!database) return null
  try { return await operation(database) } finally { database.close() }
}

function get(database, store, key) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store)
    const request = key == null ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key)
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error)
  })
}

function write(database, store, operation) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite')
    operation(tx.objectStore(store))
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
}

async function readShippedRecords(factory, filename) {
  // Read migration sources without writing an import marker.
  const contents = await withExistingDatabase(factory, `opentubex-records-${filename}`, async database => {
    if (!database.objectStoreNames.contains('metadata') || !database.objectStoreNames.contains('records')) return null
    if (!await get(database, 'metadata', 'imported')) return null
    return (await get(database, 'records')).join('\n')
  })
  if (contents !== null) return contents
  const raw = await withExistingDatabase(factory, 'NeDB', database => database.objectStoreNames.contains('nedbdata')
    ? get(database, 'nedbdata', filename)
    : Promise.resolve(''))
  return (raw || '').split('\n').filter(line => {
    try {
      const record = JSON.parse(line)
      return record !== null && typeof record === 'object' && !Array.isArray(record)
    } catch { return false }
  }).join('\n')
}

/**
 * Removes documents from the WebView copies that native storage was imported
 * from, which older versions still read.
 * @param {IDBFactory} factory
 * @param {string} filename
 * @param {string[]} ids
 */
async function removeShippedRecords(factory, filename, ids) {
  await withExistingDatabase(factory, `opentubex-records-${filename}`, async database => {
    if (!database.objectStoreNames.contains('records')) return
    await write(database, 'records', store => { for (const id of ids) store.delete(`document:${id}`) })
  })
  await withExistingDatabase(factory, 'NeDB', async database => {
    if (!database.objectStoreNames.contains('nedbdata')) return
    const lines = legacyLinesWithout(await get(database, 'nedbdata', filename), ids)
    if (lines) await write(database, 'nedbdata', store => store.put(lines.join('\n') + '\n', filename))
  })
}

/** NeDB lines that delete the documents, which record storage applies by removing their records */
const deletions = ids => ids.map(_id => JSON.stringify({ $$deleted: true, _id })).join('\n') + '\n'

function createNativeRecordStorage(native, readLegacy, removeLegacy) {
  const initialized = new Map()
  async function initialize(filename) {
    if (!initialized.has(filename)) {
      initialized.set(filename, (async () => {
        const result = await native.readRecords({ filename, metadataOnly: true })
        if (!result.initialized) {
          const contents = await readLegacy(filename)
          // Native records and the import marker commit together. Keep the
          // shipped IndexedDB copy until this succeeds; never fall back to
          // empty WebView storage when a native disk write fails.
          await native.importRecords({ filename, contents })
        }
      })().catch(error => {
        initialized.delete(filename)
        throw error
      }))
    }
    await initialized.get(filename)
  }
  return {
    async readFileAsync(filename) {
      await initialize(filename)
      return (await native.readRecords({ filename })).contents
    },
    async appendFileAsync(filename, contents) {
      await initialize(filename)
      await native.appendRecords({ filename, contents })
    },
    async unlinkAsync(filename) {
      await initialize(filename)
      await native.clearRecords({ filename })
    },
    async removeDocumentsAsync(filename, ids) {
      await initialize(filename)
      await native.appendRecords({ filename, contents: deletions(ids) })
      await removeLegacy(filename, ids)
    },
    async crashSafeWriteFileLinesAsync() {},
    async existsAsync() { return true },
    async ensureDatafileIntegrityAsync() {},
    async ensureParentDirectoryExistsAsync() {},
  }
}
