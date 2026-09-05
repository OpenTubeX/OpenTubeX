/**
 * Browser NeDB rewrites its entire append log for every channel update. Keep
 * channels in separate IndexedDB records instead, with atomic read/write
 * transactions so refreshes and seen-state updates cannot overwrite each other.
 * @param {() => Promise<object[]>} loadLegacyRecords
 * @param {string} name
 * @param {() => Promise<void>} removeLegacyRecords
 */
export function createBrowserSubscriptionCache(loadLegacyRecords, name = 'opentubex-subscription-cache', removeLegacyRecords = async () => {}) {
  let ready = null

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

  async function open(onClose) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('channels', { keyPath: '_id' })
        request.result.createObjectStore('metadata')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    database.onversionchange = () => {
      onClose()
      database.close()
    }
    database.onclose = onClose

    try {
      const imported = await transaction(database, ['metadata'], 'readonly', (tx, done) => {
        const request = tx.objectStore('metadata').get('imported')
        request.onsuccess = () => done(request.result)
      })
      if (!imported) {
        const records = await loadLegacyRecords()
        await transaction(database, ['channels', 'metadata'], 'readwrite', (tx, done, fail) => {
          const metadata = tx.objectStore('metadata')
          const request = metadata.get('imported')
          request.onsuccess = () => {
            // Another window may have completed the import while we loaded NeDB.
            if (request.result) return
            try {
              const channels = tx.objectStore('channels')
              for (const record of records) channels.put(record)
              metadata.put('imported', 'imported')
            } catch (error) {
              fail(error)
            }
          }
        })
      }
      if (imported !== 'complete') {
        // Delete the old log only after the import commits. If interrupted,
        // retry cleanup on startup without importing stale records again.
        await removeLegacyRecords()
        await transaction(database, ['metadata'], 'readwrite', tx => {
          tx.objectStore('metadata').put('complete', 'imported')
        })
      }
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  function database() {
    if (!ready) {
      const forget = () => {
        if (ready === pending) ready = null
      }
      const pending = open(forget).catch(error => {
        forget()
        throw error
      })
      ready = pending
    }
    return ready
  }

  async function updateChannel(channelId, change) {
    return transaction(await database(), ['channels'], 'readwrite', (tx, done, fail) => {
      const channels = tx.objectStore('channels')
      const request = channels.get(channelId)
      request.onsuccess = () => {
        try {
          const record = request.result ?? { _id: channelId }
          const applied = change(record)
          if (applied) channels.put(record)
          done(applied)
        } catch (error) {
          fail(error)
        }
      }
    })
  }

  function updateFeed(channelId, entries, timestamp, field) {
    // Vue proxies cannot cross IndexedDB's structured-clone boundary. Snapshot
    // only this channel, as Electron's datastore IPC does for its payloads.
    const snapshot = JSON.parse(JSON.stringify(entries))
    const date = new Date(timestamp)
    return updateChannel(channelId, record => {
      const timestampField = `${field}Timestamp`
      if (new Date(record[timestampField]).getTime() > date.getTime()) return false
      record[field] = snapshot
      record[timestampField] = date
      return true
    })
  }

  return {
    async find() {
      return transaction(await database(), ['channels'], 'readonly', (tx, done) => {
        const request = tx.objectStore('channels').getAll()
        request.onsuccess = () => done(request.result)
      })
    },
    updateVideosByChannelId: (id, entries, timestamp) => updateFeed(id, entries, timestamp, 'videos'),
    updateShortsByChannelId: (id, entries, timestamp) => updateFeed(id, entries, timestamp, 'shorts'),
    updateLiveStreamsByChannelId: (id, entries, timestamp) => updateFeed(id, entries, timestamp, 'liveStreams'),
    updateCommunityPostsByChannelId: (id, entries, timestamp) => updateFeed(id, entries, timestamp, 'communityPosts'),
    updateShortsWithChannelPageShortsByChannelId(channelId, entries) {
      const snapshot = JSON.parse(JSON.stringify(entries))
      return updateChannel(channelId, record => {
        let changed = false
        for (const cached of record.shorts ?? []) {
          const entry = snapshot.find(short => short.videoId === cached.videoId)
          if (!entry) continue
          changed = true
          cached.title = entry.title
          cached.author = entry.author
          if (entry.viewCount > cached.viewCount) cached.viewCount = entry.viewCount
        }
        return changed
      })
    },
    async deleteMultipleChannels(channelIds) {
      return transaction(await database(), ['channels'], 'readwrite', tx => {
        for (const channelId of channelIds) tx.objectStore('channels').delete(channelId)
      })
    },
    async deleteAll() {
      return transaction(await database(), ['channels'], 'readwrite', tx => {
        tx.objectStore('channels').clear()
      })
    }
  }
}
