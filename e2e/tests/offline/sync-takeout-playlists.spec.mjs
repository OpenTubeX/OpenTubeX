import { expect, goTo, openNewWindowFromTabBar, test, waitForAppReady } from '../../helpers/app.mjs'
import { createTakeoutSyncServer, verifyTakeoutPlaylistSync } from '../../helpers/sync-takeout-playlists.mjs'

test('encrypted sync uploads and restores Takeout playlist videos without uploader metadata', async ({ page }, testInfo) => {
  const server = await createTakeoutSyncServer()
  try {
    await verifyTakeoutPlaylistSync(page, server, async () => {
      await goTo(page, 'userplaylists')
      const card = page.locator('.playlistList .ft-list-item').filter({ has: page.getByText('Imported', { exact: true }) })
      await expect(card.locator('.videoCountContainer')).toContainText('2')
      await testInfo.attach('Downloaded Takeout playlist', { body: await card.screenshot(), contentType: 'image/png' })
    })
  } finally {
    await server.close()
  }
})

test.describe('playlist sync while another window edits the library', () => {
  test.use({
    seed: {
      playlists: [{
        _id: 'sync-race',
        playlistName: 'Imported',
        createdAt: 1,
        lastUpdatedAt: 1,
        videos: [
          { videoId: 'abcdefghijk', title: 'Recovered title', authorId: 'UCchannel', author: '', published: 0, lengthSeconds: 0, playlistItemId: 'one', timeAdded: 1, type: 'video' },
        ]
      }],
      settings: {
        syncServerUrl: 'http://playlist-sync.test',
        syncServerToken: 'test-token',
        syncServerPrivacyMode: 'legacy',
        syncServerEnabled: false,
        syncServerAutoSync: false,
        syncServerSyncPlaylists: true,
        syncServerSyncSubscriptions: false,
        syncServerSyncProfiles: false,
        syncServerSyncHistory: false,
      },
    }
  })

  for (const edit of ['delete playlist', 'remove entry']) {
    test(`sync cannot undo another window's ${edit} while uploading metadata`, async ({ app, page }) => {
      let release
      const pending = new Promise(resolve => { release = resolve })
      let uploading = false
      await page.route('http://playlist-sync.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        let json = []
        if (pathname === '/health') json = { capabilities: { encrypted_sync: 0 } }
        else if (pathname === '/v1/playlists/') json = [{ id: 'sync-race', title: 'Imported', description: '' }]
        else if (pathname === '/v1/playlists/sync-race') {
          json = {
            playlist: { id: 'sync-race', title: 'Imported', description: '' },
            videos: [{ id: 'abcdefghijk', title: 'abcdefghijk', uploader: { id: 'UCchannel', name: 'Recovered channel' }, duration: 120, upload_date: 100 }],
          }
        } else if (pathname === '/v1/playlists/sync-race/videos') {
          uploading = true
          await pending
        }
        await route.fulfill({ json })
      })
      let syncing
      try {
        const otherWindow = await openNewWindowFromTabBar(app, page)
        await waitForAppReady(otherWindow)
        syncing = page.evaluate(async () => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          await store.dispatch('updateSyncServerEnabled', true)
          try {
            await store.dispatch('syncWithSyncServer')
            return null
          } catch (error) {
            return error.message
          }
        })
        await expect.poll(() => uploading).toBe(true)
        await otherWindow.evaluate(async edit => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          if (edit === 'delete playlist') await store.dispatch('removePlaylist', 'sync-race')
          else await store.dispatch('removeVideo', { _id: 'sync-race', videoId: 'abcdefghijk', playlistItemId: 'one' })
        }, edit)
        await expect.poll(() => page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return store.getters.getPlaylist('sync-race')?.videos.length ?? -1
        })).toBe(edit === 'delete playlist' ? -1 : 0)
        release()
        expect(await syncing).toContain('Playlist changed during sync')
        const result = await page.evaluate(() => {
          const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
          return { playlist: store.getters.getPlaylist('sync-race'), error: store.state.syncServer.syncServerError }
        })
        expect(result.error).toContain('Playlist changed during sync')
        if (edit === 'delete playlist') expect(result.playlist).toBeUndefined()
        else expect(result.playlist.videos).toEqual([])
        const relaunched = await app.relaunch()
        expect(await relaunched.page.evaluate(() => {
          return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylist('sync-race')?.videos.length ?? -1
        })).toBe(edit === 'delete playlist' ? -1 : 0)
      } finally {
        release()
        await syncing?.catch(() => {})
      }
    })
  }
})
