import { expect } from './app.mjs'

// Syncing the history with a mocked encrypted sync server, for the seen marks
// of RSS feed items and the items of other platforms

export const SYNC_KEY = Buffer.alloc(32, 1).toString('base64')
export const SYNC_SALT = Buffer.alloc(16, 2).toString('base64')

/**
 * An encrypted sync server that keeps the uploaded collections in `remote`.
 * Register it after the catch-all route of the feeds, which would abort it.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string>} remote encrypted collections
 * @param {Record<string, number>} [capabilities]
 */
export async function mockSyncServer(page, remote, capabilities = {}) {
  await page.route('https://rss-seen-sync.example/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    let body
    if (pathname === '/health') {
      body = { capabilities: { encrypted_sync: 1, live_sync: 1, seen_rss_items: 1, ...capabilities } }
    } else if (pathname === '/v1/encrypted_sync/events') {
      body = []
    } else if (pathname === '/v1/account/sessions') {
      body = { sessions: [] }
    } else if (pathname === '/v1/encrypted_sync') {
      body = { collections: [], legacy_data: false, legacy_encrypted_data: false }
    } else {
      const collection = pathname.split('/').at(-1)
      expect(Object.hasOwn(remote, collection)).toBe(true)
      if (request.method() === 'PUT') remote[collection] = request.postDataJSON().payload
      body = { revision: 1, payload: remote[collection] }
    }
    await route.fulfill({ json: body })
  })
}

/**
 * Syncs history with the server of `mockSyncServer`.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<[string, string]>} the sync status and error
 */
export function syncWithSyncServer(page) {
  return page.evaluate(async ({ key, salt }) => {
    const store = window.$store
    const settings = {
      SyncServerEnabled: true,
      SyncServerUrl: 'https://rss-seen-sync.example',
      SyncServerToken: 'test-token',
      SyncServerPrivacyMode: 'enhanced',
      SyncServerPrivacyKey: key,
      SyncServerPrivacySalt: salt,
      SyncServerAutoSync: false,
      SyncServerSyncHistory: true,
      SyncServerSyncSubscriptions: false,
      SyncServerSyncPlaylists: false,
      SyncServerSyncProfiles: false,
      SyncServerSyncSettings: false,
      SyncServerSyncSessions: false
    }
    for (const [setting, value] of Object.entries(settings)) store.commit(`set${setting}`, value)
    await store.dispatch('syncWithSyncServer')
    return [store.state.syncServer.syncServerStatus, store.state.syncServer.syncServerError]
  }, { key: SYNC_KEY, salt: SYNC_SALT })
}
