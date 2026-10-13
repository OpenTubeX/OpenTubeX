import { DBActions, IpcChannels } from '../../../src/constants.js'
import { test, expect, goTo, openNewWindowFromTabBar, setWindowSize, waitForAppReady } from '../../helpers/app.mjs'

const video = { videoId: 'abcdefghijk', title: 'abcdefghijk', author: '', authorId: '', lengthSeconds: 0, published: 0, timeAdded: 123, playlistItemId: 'one', type: 'video' }
const playlists = [
  { _id: 'takeout', playlistName: 'Takeout playlist', description: 'Imported', videos: [video, { ...video, playlistItemId: 'two' }], createdAt: 1, lastUpdatedAt: 1 },
  { _id: 'other', playlistName: 'Other playlist', videos: [{ ...video, playlistItemId: 'other' }], createdAt: 1, lastUpdatedAt: 1 }
]
test.use({ seed: { playlists } })

async function openRepair(page) {
  await goTo(page, 'userplaylists')
  await page.getByRole('button', { name: 'Repair Playlists', exact: true }).click()
  return page.getByRole('dialog', { name: 'Repair Playlists' })
}
async function savedPlaylists(page) {
  return page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    if (!store.state.playlists.libraryPaged) return store.getters.getAllPlaylists
    const summaries = await window.ftElectron.libraryQuery('playlistSummaries')
    return Promise.all(summaries.map(playlist => window.ftElectron.libraryQuery('playlistSnapshot', { id: playlist._id })))
  })
}
function playerResponse() {
  return { videoDetails: { videoId: video.videoId, title: 'Fetched title', author: 'Recovered channel', channelId: 'UCabcdefghijklmnopqrstuv', lengthSeconds: '120', isLiveContent: true }, microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } } }
}

for (const selectAll of [false, true]) {
  test(`repairs ${selectAll ? 'all' : 'selected'} playlists, fetching shared videos once`, async ({ page, app }, testInfo) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', route => { requests++; return route.fulfill({ json: playerResponse() }) })
    const dialog = await openRepair(page)
    const start = dialog.getByRole('button', { name: 'Start repair', exact: true })
    await expect(start).toBeDisabled()
    await dialog.getByText(selectAll ? 'Select all' : 'Takeout playlist', { exact: true }).click()
    await expect(start).toBeEnabled()
    await dialog.screenshot({ path: testInfo.outputPath('playlist-repair-selection.png'), animations: 'disabled' })
    await start.click()
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    expect(requests).toBe(1)
    await page.screenshot({ path: testInfo.outputPath('playlist-repair-finished.png'), animations: 'disabled' })
    const saved = await savedPlaylists(page)
    const takeout = saved.find(p => p._id === 'takeout')
    expect(takeout).toMatchObject({ createdAt: 1, lastUpdatedAt: 1 })
    expect(takeout.videos.map(v => v.playlistItemId)).toEqual(['one', 'two'])
    for (const entry of takeout.videos) expect(entry).toMatchObject({ title: 'Fetched title', author: 'Recovered channel', authorId: 'UCabcdefghijklmnopqrstuv', lengthSeconds: 120, published: Date.parse('2025-01-01'), timeAdded: 123, isLive: false })
    expect(saved.find(p => p._id === 'other').videos[0].author).toBe(selectAll ? 'Recovered channel' : '')
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Repair Playlists', exact: true })).toBeFocused()
    const relaunched = await app.relaunch()
    expect((await savedPlaylists(relaunched.page)).find(p => p._id === 'takeout').videos[0].authorId).toBe('UCabcdefghijklmnopqrstuv')
  })
}

test('selection supports keyboard, select all, and clearing all', async ({ page }) => {
  const dialog = await openRepair(page)
  const all = dialog.getByRole('checkbox', { name: 'Select all', exact: true })
  await all.focus()
  await all.press('Space')
  await expect(dialog.getByRole('checkbox', { name: 'Takeout playlist', exact: true })).toBeChecked()
  await all.press('Space')
  await expect(dialog.getByRole('button', { name: 'Start repair', exact: true })).toBeDisabled()
  await dialog.getByText('Other playlist', { exact: true }).click()
  expect(await all.evaluate(el => el.indeterminate)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Repair Playlists', exact: true })).toBeFocused()
})

test('cancels without saving late metadata', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/player*', async route => {
    await pending
    await route.fulfill({ json: playerResponse() }).catch(() => {})
  })
  try {
    const dialog = await openRepair(page)
    await dialog.getByText('Select all', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Repair stopped', exact: true })).toBeVisible()
    release()
    expect((await savedPlaylists(page)).find(p => p._id === 'takeout').videos[0].authorId).toBe('')
  } finally { release() }
})

test('keeps dialog heading and actions visible at fractional zoom and small sizes', async ({ page, app }, testInfo) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('addPlaylists', Array.from({ length: 20 }, (_, i) => ({ _id: `long-${i}`, playlistName: `Imported playlist ${i} with a long title`, videos: [] })))
  })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await setWindowSize(app, page, { width: 500, height: 650 })
  const dialog = await openRepair(page)
  const scroller = dialog.locator('.promptContentScroller')
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(dialog.getByRole('heading')).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Start repair', exact: true })).toBeInViewport()
  expect(await dialog.evaluate(el => {
    const bounds = el.getBoundingClientRect()
    return { horizontalOverflow: el.scrollWidth > el.clientWidth, outsideViewport: bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight }
  })).toEqual({ horizontalOverflow: false, outsideViewport: false })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await setWindowSize(app, page, { width: 1100, height: 1100 })
  await expect.poll(() => scroller.evaluate(el => el.scrollTop <= el.scrollHeight - el.clientHeight + 1)).toBe(true)
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removePlaylists', Array.from({ length: 20 }, (_, i) => `long-${i}`)))
  await expect.poll(() => scroller.evaluate(el => ({
    scrollTop: el.scrollTop,
    visibleScrollbar: el.querySelector(':scope > .os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible') ?? false
  }))).toEqual({ scrollTop: 0, visibleScrollbar: false })
  await dialog.screenshot({ path: testInfo.outputPath('playlist-repair-resized.png'), animations: 'disabled' })
})

test.describe('playlist repair retries', () => {
  test.use({ seed: { playlists, settings: { backendPreference: 'invidious', defaultInvidiousInstance: 'https://playlist-repair.test' } } })
  test('retries temporary failures using the selected backend', async ({ page }) => {
    let requests = 0
    await page.clock.install()
    await page.route('**/api/v1/videos/*', route => {
      requests++
      return requests === 1
        ? route.fulfill({ status: 503, body: 'Temporary failure' })
        : route.fulfill({ json: { videoId: video.videoId, title: 'Recovered title', author: 'Recovered channel', authorId: 'UCchannel', lengthSeconds: 120, published: 100, liveNow: false, isUpcoming: false } })
    })
    const dialog = await openRepair(page)
    await dialog.getByText('Select all', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Retrying failed requests', exact: true })).toBeVisible()
    await page.clock.fastForward(1000)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    expect(requests).toBe(2)
    const saved = (await savedPlaylists(page)).find(p => p._id === 'takeout').videos[0]
    expect(saved).toMatchObject({ authorId: 'UCchannel', published: 100000, title: 'Recovered title' })
  })
})

test.describe('playlist repair cookies', () => {
  test.use({ seed: { playlists, settings: { ytDlpPlaybackAuthMode: 'file', ytDlpPlaybackCookiesPath: '/tmp/playlist-cookies.txt' } } })
  test('uses configured cookies when selected', async ({ page, app }) => {
    await app.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('yt-dlp-get-history-metadata')
      globalThis.playlistCookieRequests = []
      ipcMain.handle('yt-dlp-get-history-metadata', (_event, videoId) => {
        globalThis.playlistCookieRequests.push(videoId)
        return { id: videoId, title: 'Cookie title', channel: 'Cookie channel', channel_id: 'UCchannel', duration: 120, upload_date: '20250920', live_status: 'was_live' }
      })
    })
    const dialog = await openRepair(page)
    await dialog.getByText('Takeout playlist', { exact: true }).click()
    await dialog.getByText('Use configured yt-dlp cookies', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    expect(await app.electronApp.evaluate(() => globalThis.playlistCookieRequests)).toEqual([video.videoId])
    expect((await savedPlaylists(page)).find(p => p._id === 'takeout').videos[0]).toMatchObject({ title: 'Cookie title', authorId: 'UCchannel' })
  })
})

for (const edit of ['delete', 'add', 'rename']) {
  test(`late repair response preserves another window's ${edit}`, async ({ page, app }) => {
    const other = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(other)
    await other.route('**/youtubei/v1/player*', route => route.fulfill({ json: playerResponse() }))
    await page.route('**/youtubei/v1/player*', route => route.fulfill({ json: playerResponse() }))
    await app.electronApp.evaluate(({ ipcMain }, { channel, action }) => {
      const handler = ipcMain._invokeHandlers.get(channel)
      ipcMain.removeHandler(channel)
      globalThis.playlistRepairSaved = false
      ipcMain.handle(channel, async (event, payload) => {
        const result = await handler(event, payload)
        if (payload.action === action) {
          globalThis.playlistRepairSaved = true
          await new Promise(resolve => { globalThis.releasePlaylistRepairResponse = resolve })
        }
        return result
      })
    }, { channel: IpcChannels.DB_PLAYLISTS, action: DBActions.PLAYLISTS.REPAIR_METADATA })
    try {
      const dialog = await openRepair(page)
      await dialog.getByText('Takeout playlist', { exact: true }).click()
      await dialog.getByRole('button', { name: 'Start repair', exact: true }).click()
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.playlistRepairSaved)).toBe(true)
      await other.evaluate(async edit => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        if (edit === 'delete') await store.dispatch('removePlaylist', 'takeout')
        else if (edit === 'add') await store.dispatch('addVideo', { _id: 'takeout', videoData: { videoId: 'cdefghijklm', title: 'Added later', author: 'New channel', lengthSeconds: 50 } })
        else await store.dispatch('updatePlaylist', { ...JSON.parse(JSON.stringify(store.getters.getPlaylist('takeout'))), playlistName: 'Renamed later' })
      }, edit)
      const inspect = async () => {
        const playlist = (await savedPlaylists(page)).find(p => p._id === 'takeout')
        return edit === 'delete' ? playlist === undefined : edit === 'add' ? playlist?.videos.some(v => v.videoId === 'cdefghijklm') : playlist?.playlistName === 'Renamed later'
      }
      await expect.poll(inspect).toBe(true)
      await app.electronApp.evaluate(() => globalThis.releasePlaylistRepairResponse())
      await expect(page.getByRole('heading', { name: 'Repair finished', exact: true })).toBeVisible()
      expect(await inspect()).toBe(true)
    } finally {
      await app.electronApp.evaluate(() => globalThis.releasePlaylistRepairResponse?.())
    }
  })
}

test.describe('shared repair busy state', () => {
  test.use({ seed: { playlists, history: [{ ...video, _id: video.videoId, timeWatched: 1, isWatched: true, watchProgress: 20 }] } })
  test('an open history prompt stays disabled while another tab repairs playlists', async ({ page }) => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    await page.route('**/youtubei/v1/player*', async route => {
      await pending
      await route.fulfill({ json: playerResponse() }).catch(() => {})
    })
    try {
      await goTo(page, 'history')
      await page.getByRole('button', { name: 'Repair History', exact: true }).click()
      const historyDialog = page.getByRole('dialog', { name: 'Repair History' })
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('createTab', { route: '/userplaylists', title: 'Playlists', makeActive: true }))
      // The history prompt remains mounted over the new tab; open the new tab's
      // prompt directly to exercise this already-open-prompt race.
      await page.getByRole('button', { name: 'Repair Playlists', exact: true }).dispatchEvent('click')
      const playlistDialog = page.getByRole('dialog', { name: 'Repair Playlists' })
      await playlistDialog.getByText('Takeout playlist', { exact: true }).click()
      await playlistDialog.getByRole('button', { name: 'Start repair', exact: true }).click()
      const historyStart = historyDialog.getByRole('button', { name: 'Start repair', exact: true })
      await expect(historyStart).toBeDisabled()
      await historyStart.dispatchEvent('click')
      await expect(historyDialog).toBeVisible()
      release()
      await expect(historyStart).toBeEnabled()
      await historyDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    } finally { release() }
  })
})
