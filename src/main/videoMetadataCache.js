import { libraryRequest } from '../datastores/sqlite/client.js'

export function updateVideoMetadataCache(input) {
  return libraryRequest('engine', 'updateVideoMetadataCache', [input])
}

export function getVideoMetadataCacheSize() {
  return libraryRequest('engine', 'metadataSize')
}

export function clearVideoMetadataCache() {
  return libraryRequest('engine', 'clearMetadata')
}
