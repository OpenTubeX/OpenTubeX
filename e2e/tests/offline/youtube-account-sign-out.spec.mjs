import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

const PLAYLIST_ID = 'ft-playlist--synced-example'

const settings = {
  youTubeAccount: {
    credentials: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      // Far enough ahead that the sign-in is never refreshed.
      expiry_date: '2999-01-01T00:00:00.000Z',
      client: { client_id: 'test-client-id', client_secret: 'test-client-secret' }
    },
    profiles: [{ name: 'Test Channel', handle: '@testchannel', thumbnail: null, pageId: null }],
    pageId: null,
    channelId: 'UCtestchannel000000000000',
    signInId: 'test-sign-in'
  },
  // Without playlist sync, the synced playlist would be removed on launch.
  youTubeAccountSyncPlaylists: true
}

const syncedPlaylist = {
  _id: PLAYLIST_ID,
  playlistName: 'Synced Example',
  protected: false,
  description: '',
  videos: [{
    videoId: 'video000001',
    title: 'Example Video',
    author: 'Example Channel',
    authorId: 'UCexamplechannel00000000',
    lengthSeconds: 60,
    type: 'video',
    playlistItemId: 'item-1',
    timeAdded: 1000,
    youTubeSetVideoId: 'SET1'
  }],
  youTube: { playlistId: 'PLexample', accountKey: 'test-sign-in\n', title: 'Synced Example', signature: null },
  createdAt: 1000,
  lastUpdatedAt: 1000
}

/** @param {import('@playwright/test').Page} page */
async function signOut(page, choice) {
  await page.route(/\/o\/oauth2\/revoke/, route => route.fulfill({ status: 200, body: '' }))
  const section = await goToSettingsSection(page, 'youtube-account')
  await section.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: choice, exact: true }).click()
  await expect(section.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  // The sync that follows the sign-out removes the playlists still linked to YouTube.
  // It waits for the sync lock, so taking the lock waits for it in turn.
  await page.evaluate(() => navigator.locks.request('opentubex-youtube-sync', () => {}))
}

/** @param {import('@playwright/test').Page} page */
function findPlaylist(page) {
  return page.evaluate(id => window.$store.getters.getAllPlaylists.find(item => item._id === id) ?? null, PLAYLIST_ID)
}

test.describe('with the shared playlists', () => {
  test.use({ seed: { settings, playlists: [syncedPlaylist] } })

  test('signing out of YouTube can keep the synced playlists as regular playlists', async ({ page }) => {
    await signOut(page, 'Keep playlists')
    const playlist = await findPlaylist(page)
    expect(playlist).toMatchObject({ playlistName: 'Synced Example', youTube: null, sourcePlaylistId: 'PLexample' })
    expect(playlist.videos).toEqual([expect.objectContaining({ videoId: 'video000001', playlistItemId: 'item-1' })])
    expect(playlist.videos[0]).not.toHaveProperty('youTubeSetVideoId')
  })
})

test.describe('in a separate profile', () => {
  test.use({
    seed: {
      settings: { ...settings, defaultProfile: 'e2eprofile' },
      profiles: [
        { _id: 'allChannels', name: 'All Channels', bgColor: '#d50000', textColor: '#FFFFFF', icon: { type: 'initial' }, subscriptions: [] },
        { _id: 'e2eprofile', name: 'Separate profile', bgColor: '#558B2F', textColor: '#FFFFFF', separate: true, subscriptions: [] }
      ],
      // The shared playlists, which the separate profile doesn't show.
      playlists: [syncedPlaylist]
    }
  })

  test('the synced playlists removed on sign-out are gone once the shared playlists show again', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveDataScope)).toBe('e2eprofile')
    await signOut(page, 'Remove from this device')

    await page.evaluate(() => window.$store.dispatch('updateActiveProfile', 'allChannels'))
    await expect.poll(() => page.evaluate(() => window.$store.getters.getActiveDataScope)).toBeNull()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getPlaylistsReady)).toBe(true)
    await expect.poll(() => findPlaylist(page)).toBeNull()
  })
})
