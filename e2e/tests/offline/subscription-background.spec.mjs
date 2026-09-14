import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test, expect, waitForAppReady } from '../../helpers/app.mjs'
import { createBackgroundSubscriptionRequests } from '../../../src/subscriptionBackgroundRequests.js'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><author><name>Background channel</name></author><entry><yt:videoId>background1</yt:videoId><title>Fetched with the window closed</title><published>2026-09-14T08:00:00Z</published><media:statistics views="1"/></entry></feed>'

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false, enableClosedAppSubscriptionRefresh: true, subscriptionFeedAutoRefreshInterval: '0' },
    profiles: [{ _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: channelId, name: 'Background channel', thumbnail: '' }] }]
  }
})

for (const windowAction of ['close', 'hide']) {
  test(`refreshes while windows ${windowAction}, imports on return, and quits fully`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ net }, body) => {
      const originalFetch = net.fetch
      net.fetch = (url, options) => {
        if (String(url).startsWith('https://www.youtube.com/feeds/videos.xml')) return Promise.resolve(new Response(body, { status: 200 }))
        if (String(url).startsWith('https://www.youtube.com/watch?v=background1')) return Promise.resolve(new Response('var ytInitialPlayerResponse = {"videoDetails":{"isLive":false}};', { status: 200 }))
        return originalFetch(url, options)
      }
    }, xml)
    const configuration = {
      enabled: true,
      intervals: { videos: 1 },
      profiles: [{ id: 'allChannels', channels: { videos: [channelId] } }],
      requests: createBackgroundSubscriptionRequests({ backend: 'local', useRss: true, fallback: false })
    }
    await page.evaluate(value => window.ftElectron.subscriptionAutoRefresh.configureBackground(value), configuration)
    await expect.poll(() => app.electronApp.evaluate(({ app }) => app.getAppMetrics().some(process => process.name === 'Subscription refresh'))).toBe(true)
    await app.electronApp.evaluate(({ BrowserWindow }, action) => { for (const window of BrowserWindow.getAllWindows()) window[action]() }, windowAction)
    await expect.poll(() => app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(0)
    await expect.poll(async () => {
      try {
        const directory = path.join(app.userDataDir, 'background-subscription-results')
        return (await Promise.all((await readdir(directory)).filter(file => file.endsWith('.json')).map(file => readFile(path.join(directory, file), 'utf8')))).join('')
      } catch { return '' }
    }).toContain('Fetched with the window closed')

    const directory = path.join(app.userDataDir, 'background-subscription-results')
    const saved = (await Promise.all((await readdir(directory)).filter(file => file.endsWith('.json')).map(async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'))))).find(result => result.kind === 'channel')
    expect(saved.payload.backgroundFormat).toBe('entries')
    expect(saved.payload.entries[0].author).toBe('Background channel')
    expect(saved.payload.text).toBeUndefined()
    expect(saved.payload.entries[0].isUpcoming).toBe(false)

    let nextPage = page
    if (windowAction === 'close') {
      const reopened = app.electronApp.waitForEvent('window')
      await app.electronApp.evaluate(({ app }) => app.emit('activate'))
      nextPage = await reopened
      app.page = nextPage
      await waitForAppReady(nextPage)
    } else {
      await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    }
    await expect.poll(() => nextPage.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getVideoCache[id]?.videos[0]?.title, channelId)).toBe('Fetched with the window closed')
    await expect.poll(() => nextPage.evaluate(() => window.ftElectron.subscriptionAutoRefresh.nextBackgroundResult())).toBeNull()
    const quit = app.electronApp.waitForEvent('close')
    await app.electronApp.evaluate(({ app }) => { app.quit() })
    await quit
  })
}

test('turning off background refresh makes closing the last window quit', async ({ app, page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateEnableClosedAppSubscriptionRefresh', false)
  })
  // Wait for the settings watcher and its native configuration handshake.
  await page.evaluate(() => window.ftElectron.subscriptionAutoRefresh.configureBackground({ enabled: false, profiles: [], intervals: {}, requests: {} }))
  const closed = app.electronApp.waitForEvent('close')
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
})
