import { watchQueueMutations, PERSISTED_MUTATIONS } from '../../watchQueue.js'

export function createBrowserWatchQueue() {
  const channel = new BroadcastChannel('opentubex-watch-queue')
  let ready
  const openDatabase = () => {
    ready ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('opentubex-watch-queue', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('state')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          ready = undefined
        }
        resolve(request.result)
      }
    }).catch(error => {
      ready = undefined
      throw error
    })
    return ready
  }

  return {
    async update(request) {
      const database = await openDatabase()
      const changesQueue = PERSISTED_MUTATIONS.has(request.type)
      return new Promise((resolve, reject) => {
        // Read and apply the operation within one transaction. IndexedDB
        // serializes writes to this store across every tab of the origin.
        const tx = database.transaction('state', changesQueue ? 'readwrite' : 'readonly')
        const records = tx.objectStore('state')
        const read = records.get('queue')
        let snapshot
        let failure
        read.onsuccess = () => {
          try {
            snapshot = read.result ?? { revision: 0, items: [] }
            if (changesQueue) {
              watchQueueMutations[request.type](snapshot, request.payload)
              snapshot.revision++
              records.put(snapshot, 'queue')
            }
          } catch (error) {
            failure = error
            tx.abort()
          }
        }
        tx.onabort = () => reject(failure ?? tx.error)
        tx.oncomplete = () => {
          resolve(snapshot)
          if (changesQueue) {
            try { channel.postMessage(snapshot) } catch (error) {
              console.warn('Could not broadcast the watch queue', error)
            }
          }
        }
      })
    },
    onUpdated(handler) {
      const listener = event => handler(event.data)
      channel.addEventListener('message', listener)
      return () => channel.removeEventListener('message', listener)
    }
  }
}
