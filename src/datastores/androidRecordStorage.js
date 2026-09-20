// NeDB keeps its query/index implementation; only its Android persistence
// adapter changes. Store each serialized document separately, including dates
// in NeDB's own format, rather than copying an ever-growing append log.
export function createAndroidRecordStorage(factory = indexedDB) {
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
    // Records are already compacted on every update. Startup compaction must
    // not rewrite them or overwrite a concurrent transaction's newer records.
    async crashSafeWriteFileLinesAsync() {},
    async existsAsync() { return true },
    async ensureDatafileIntegrityAsync() {},
    async ensureParentDirectoryExistsAsync() {},
  }
}
