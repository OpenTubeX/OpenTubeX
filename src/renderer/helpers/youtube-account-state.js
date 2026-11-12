/** Native HTTP and Electron can send the requests the YouTube account needs. */
export const supportsYouTubeAccount = !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR)

/**
 * @param {Record<string, any>} getters
 * @returns {boolean}
 */
export function isSignedInToYouTube(getters) {
  return supportsYouTubeAccount && typeof getters.getYouTubeAccount?.credentials?.refresh_token === 'string'
}

/**
 * The channel the account uses on YouTube.
 * @param {{ profiles?: { name: string, handle: string | null, thumbnail: string | null, pageId: string | null }[], pageId?: string | null } | null | undefined} account
 */
export function getSelectedYouTubeProfile(account) {
  const profiles = account?.profiles ?? []
  return profiles.find(profile => profile.pageId === (account.pageId ?? null)) ?? profiles[0] ?? null
}
