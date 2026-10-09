import { mergeHistory, applyRemoteHistoryChanges } from './sync-history-merge.js'
import * as privacy from './sync-server-privacy-crypto.js'

export async function executeBackgroundJob(operation, input) {
  switch (operation) {
    case 'mergeHistory': return mergeHistory(input)
    case 'applyRemoteHistoryChanges': return applyRemoteHistoryChanges(input)
    case 'encryptSyncDocument': return privacy.encryptSyncDocument(input.data, input.exportedKey, input.salt)
    case 'decryptSyncDocument': return privacy.decryptSyncDocument(input.payload, input.exportedKey)
    case 'decryptLegacySyncDocument': return privacy.decryptLegacySyncDocument(input.payload, input.exportedKey)
    case 'stringify': return JSON.stringify(input.value)
    case 'parse': return JSON.parse(input.value)
    case 'equal': return JSON.stringify(input.first) === JSON.stringify(input.second)
    case 'clone': return structuredClone(input.value)
    default: throw new Error('Unknown background operation')
  }
}
