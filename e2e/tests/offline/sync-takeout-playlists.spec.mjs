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

  test('synced thumbnails reject invalid data and normalize oversized images before saving', async ({ page }) => {
    let header = { id: 'sync-race', title: 'Imported', description: '', thumbnail_url: null }
    let writes = 0
    await page.route('http://playlist-sync.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      let json = []
      if (pathname === '/health') json = { capabilities: { encrypted_sync: 0 } }
      else if (pathname === '/v1/playlists/') json = [header]
      else if (pathname === '/v1/playlists/sync-race') {
        if (route.request().method() === 'PATCH') {
          header = { ...header, ...route.request().postDataJSON() }
          writes++
        }
        json = { playlist: header, videos: [] }
      }
      await route.fulfill({ json })
    })
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removeAllVideos', 'sync-race')
      for (const collection of ['Subscriptions', 'History', 'Profiles', 'Sessions', 'Settings', 'WatchStats', 'LiveReminders']) {
        await store.dispatch(`updateSyncServerSync${collection}`, false)
      }
      await store.dispatch('updateSyncServerEnabled', true)
      await store.dispatch('syncWithSyncServer')
    })
    const sync = () => page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('syncWithSyncServer')
      return store.getters.getPlaylist('sync-race').customThumbnail || ''
    })
    for (const invalid of ['data:image/png;base64,AAAA', `data:image/png;base64,${'A'.repeat(2_000_000)}`]) {
      header.thumbnail_url = invalid
      expect(await sync()).toBe('')
      expect(header.thumbnail_url).toBe('')
    }
    for (const [width, height] of [[16, 9], [2560, 1440]]) {
      header.thumbnail_url = await page.evaluate(([width, height]) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').fillRect(0, 0, width, height)
        return canvas.toDataURL('image/png')
      }, [width, height])
      const thumbnail = await sync()
      expect(thumbnail).toBe(header.thumbnail_url)
      const dimensions = await page.evaluate(async thumbnail => {
        const image = new Image()
        image.src = thumbnail
        await image.decode()
        return [image.naturalWidth, image.naturalHeight]
      }, thumbnail)
      expect(dimensions).toEqual([Math.min(width, 1280), Math.min(height, 720)])
      const previousWrites = writes
      expect(await sync()).toBe(thumbnail)
      expect(writes).toBe(previousWrites)
    }
  })

  test('retry preserves a remote rename after another window edits during repair upload', async ({ app, page }) => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    let uploading = false
    let header = { id: 'sync-race', title: 'Renamed elsewhere', description: 'Changed elsewhere', thumbnail_url: null }
    let videos = [{ id: 'abcdefghijk', title: 'abcdefghijk', uploader: { id: 'UCchannel', name: 'Recovered channel' }, duration: 120, upload_date: 100 }]
    await page.route('http://playlist-sync.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      let json = []
      if (pathname === '/health') json = { capabilities: { encrypted_sync: 0 } }
      else if (pathname === '/v1/playlists/') json = [header]
      else if (pathname === '/v1/playlists/sync-race') {
        if (route.request().method() === 'PATCH') header = route.request().postDataJSON()
        else json = { playlist: header, videos }
      } else if (pathname === '/v1/playlists/sync-race/videos') {
        uploading = true
        await pending
        const uploaded = new Map(videos.map(video => [video.id, video]))
        for (const video of route.request().postDataJSON()) uploaded.set(video.id, video)
        videos = [...uploaded.values()]
      }
      await route.fulfill({ json })
    })
    let syncing
    try {
      const otherWindow = await openNewWindowFromTabBar(app, page)
      await waitForAppReady(otherWindow)
      syncing = page.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('updateSyncServerSnapshot', JSON.stringify({
          playlists: {
            'sync-race': {
              remoteId: 'sync-race', metadata: { id: 'sync-race', title: 'Imported', description: '', thumbnail_url: null }, videos: ['abcdefghijk']
            }
          }
        }))
        await store.dispatch('updateSyncServerEnabled', true)
        try { await store.dispatch('syncWithSyncServer') } catch (error) { return error.message }
        return null
      })
      await expect.poll(() => uploading).toBe(true)
      await otherWindow.evaluate(async () => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        await store.dispatch('addVideo', { _id: 'sync-race', videoData: { videoId: 'bcdefghijkl', title: 'Added locally', authorId: 'UCchannel', author: 'Recovered channel', lengthSeconds: 50 } })
      })
      await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylist('sync-race').videos.length)).toBe(2)
      release()
      expect(await syncing).toContain('Playlist changed during sync')
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer'))
      expect(header.title).toBe('Renamed elsewhere')
      expect(header.description).toBe('Changed elsewhere')
      const relaunched = await app.relaunch()
      const saved = await relaunched.page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylist('sync-race'))
      expect(saved.playlistName).toBe('Renamed elsewhere')
      expect(saved.description).toBe('Changed elsewhere')
      expect(saved.videos.map(video => video.videoId)).toEqual(['abcdefghijk', 'bcdefghijkl'])
    } finally {
      release()
      await syncing?.catch(() => {})
    }
  })

  for (const [edit, firstUpload] of [['delete playlist', false], ['remove entry', false], ['delete playlist', true]]) {
    test(`sync cannot undo another window's ${edit} during ${firstUpload ? 'first upload' : 'metadata upload'}`, async ({ app, page }) => {
      let release
      const pending = new Promise(resolve => { release = resolve })
      let uploading = false
      let remoteExists = !firstUpload
      let removedRemoteCopy = false
      const remoteId = firstUpload ? 'server-generated' : 'sync-race'
      let remoteVideos = firstUpload ? [] : [{ id: 'abcdefghijk', title: 'abcdefghijk', uploader: { id: 'UCchannel', name: 'Recovered channel' }, duration: 120, upload_date: 100 }]
      await page.route('http://playlist-sync.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        let json = []
        if (pathname === '/health') json = { capabilities: { encrypted_sync: 0 } }
        else if (pathname === '/v1/playlists/') {
          if (route.request().method() === 'POST') {
            remoteExists = true
            json = { id: 'server-generated', title: 'Imported', description: '' }
          } else json = remoteExists ? [{ id: firstUpload ? 'server-generated' : 'sync-race', title: 'Imported', description: '' }] : []
        } else if (pathname === `/v1/playlists/${remoteId}`) {
          if (route.request().method() === 'DELETE') {
            remoteExists = false
            removedRemoteCopy = true
          } else json = { playlist: { id: remoteId, title: 'Imported', description: '' }, videos: remoteVideos }
        } else if (pathname === `/v1/playlists/${remoteId}/videos`) {
          uploading = true
          await pending
          remoteVideos = route.request().postDataJSON()
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
        expect(removedRemoteCopy).toBe(false)
        if (edit === 'delete playlist') expect(result.playlist).toBeUndefined()
        else expect(result.playlist.videos).toEqual([])
        if (firstUpload) {
          const nextError = await page.evaluate(async () => {
            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
            try { await store.dispatch('syncWithSyncServer', { notifyDataLoss: false }) } catch (error) { return error.message }
            return null
          })
          expect(nextError).toContain('would delete')
          expect(remoteExists).toBe(true)
          expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists.length)).toBe(0)
          await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer', { allowDataLoss: true }))
          expect(remoteExists).toBe(false)
          expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists.length)).toBe(0)
        }
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
