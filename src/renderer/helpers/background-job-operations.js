import { mergeHistory, applyRemoteHistoryChanges, updateHistorySnapshot } from './sync-history-merge.js'
import * as privacy from './sync-server-privacy-crypto.js'

export async function executeBackgroundJob(operation, input) {
  switch (operation) {
    case 'extractPlayer': {
      const { Player } = globalThis.OpenTubeXYouTube ?? await import('youtubei.js')
      const player = await Player.create(undefined, async () => new Response(input.source), undefined, input.playerId)
      return { signature_timestamp: player.signature_timestamp, data: player.data }
    }
    case 'mergeHistory': return mergeHistory(input)
    case 'updateHistorySnapshot': return updateHistorySnapshot(input)
    case 'applyRemoteHistoryChanges': return applyRemoteHistoryChanges(input)
    case 'encryptSyncDocument': return privacy.encryptSyncDocument(input.data, input.exportedKey, input.salt, input.options)
    case 'decryptSyncDocument': return privacy.decryptSyncDocument(input.payload, input.exportedKey)
    case 'decryptLegacySyncDocument': return privacy.decryptLegacySyncDocument(input.payload, input.exportedKey)
    case 'stringify': return JSON.stringify(input.value)
    case 'clone': return structuredClone(input.value)
    default: throw new Error('Unknown background operation')
  }
}
