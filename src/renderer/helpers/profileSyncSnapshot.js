/**
 * The parts of a profile that sync writes. Icons are left out because sync
 * keeps the local one, and the store adds a default icon the datastore lacks.
 * @param {{ name?: string, bgColor?: string, textColor?: string, subscriptions?: object[] }} profile
 */
export function profileSyncSnapshot(profile) {
  return JSON.stringify([profile.name, profile.bgColor, profile.textColor, profile.subscriptions])
}
