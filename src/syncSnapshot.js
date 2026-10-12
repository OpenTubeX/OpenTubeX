/** Keep the shipped snapshot format durable, without retaining its library in Vuex. */
export function syncSnapshotPreview(value) {
  let snapshot
  try { snapshot = JSON.parse(value) } catch { return '{}' }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '{}'
  delete snapshot.history
  delete snapshot.playlists
  return JSON.stringify(snapshot)
}
