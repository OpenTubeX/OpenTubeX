import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const CHANNEL_ID = 'UC4QobU6STFB0P71PMvOGN5A'
const CHANNEL_PATH = `/channel/${CHANNEL_ID}`
const VIDEO_TITLE = 'Me at the zoo'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test',
      keepPlayingOnNavigation: true,
      reducedMotion: 'on',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true
    }
  }
})

for (const delayed of [false, true]) {
  test(`retained channel titles stay with their page when loaded ${delayed ? 'behind' : 'before'} Watch`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    const started = Promise.withResolvers()
    const released = Promise.withResolvers()
    let channelRequests = 0
    await page.route('https://invidious.test/api/v1/channels/**', async route => {
      if (new URL(route.request().url()).pathname.split('/')[5]) {
        await route.fulfill({ json: { videos: [], continuation: null } })
        return
      }
      channelRequests++
      started.resolve()
      if (delayed) await released.promise
      await route.fulfill({
        json: {
          author: 'jawed',
          authorId: CHANNEL_ID,
          authorThumbnails: [],
          authorBanners: [],
          description: 'Retained channel title regression fixture',
          subCount: 0,
          totalViews: 0,
          joined: 0,
          tabs: ['videos'],
          relatedChannels: []
        }
      })
    })
    const tab = await page.evaluate(route => window.ftElectron.tabs.create({ route, makeActive: true }), CHANNEL_PATH)
    const tabTitle = page.locator(`.tab[data-tab-id="${tab.id}"] .tabTitleText`)
    await started.promise
    if (!delayed) await expect(tabTitle).toHaveText('jawed')

    // Load the video with the local fixture while the retained channel keeps
    // its original request and component instance.
    await page.evaluate(() => window.$store.commit('setBackendPreference', 'local'))
    const video = await openMockedVideo(page)
    await video.evaluate(element => { element.pause() })
    const originalVideo = await video.elementHandle()
    await expect(page.locator('.videoTitle:visible')).toHaveText(VIDEO_TITLE)
    await expect(tabTitle).toHaveText(VIDEO_TITLE)
    released.resolve()
    await expect(page.locator('.browsingBehindWatch .channelDetails .name')).toHaveText('jawed')
    // Flush the channel's loading/title watchers and metadata IPC.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(tabTitle).toHaveText(VIDEO_TITLE)
    await expect.poll(() => page.evaluate(id => {
      const tab = window.$store.getters.getTabById(id)
      return tab.history[tab.historyIndex].title
    }, tab.id)).toBe(VIDEO_TITLE)

    await page.locator(`.watchVideoInfo:visible a.channelName[href="#${CHANNEL_PATH}"]`).click()
    await expect(page).toHaveURL(new RegExp(`#${CHANNEL_PATH}$`))
    await expect(page.locator('.channelDetails:visible')).toBeVisible()
    await expect(tabTitle).toHaveText('jawed')
    expect(channelRequests, 'reopening the channel must reuse its loaded page').toBe(1)
    await page.screenshot({ path: testInfo.outputPath('channel-title.png') })

    await page.locator(sel.backButton).click()
    await expect(page).toHaveURL(/#\/watch\/jNQXAC9IVRw$/)
    await expect(tabTitle).toHaveText(VIDEO_TITLE)
    expect(await originalVideo.evaluate(element => element.isConnected)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('video-title.png') })
    await originalVideo.dispose()
  })
}

test('an old post response cannot replace the retained post or its title behind Watch', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await page.evaluate(() => window.$store.commit('setHideComments', true))
  const oldRequest = Promise.withResolvers()
  const response = id => ({
    comments: [{
      commentId: `post-${id}`,
      contentHtml: `Post ${id} content`,
      author: `Author ${id}`,
      authorId: `author-${id}`,
      authorThumbnails: [],
      publishedText: '1 day ago',
      likeCount: 0,
      replyCount: 0
    }]
  })
  await page.route('https://invidious.test/api/v1/post/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/post-A')) {
      oldRequest.resolve(route)
      return
    }
    return route.fulfill({ json: response('B') })
  })
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({
    route: '/post/post-A', query: { authorId: 'author-A' }, makeActive: true
  }))
  const pending = await oldRequest.promise
  await page.locator(sel.searchInput).fill('https://www.youtube.com/post/post-B?ucid=author-B')
  await page.locator(sel.searchInput).press('Enter')
  await expect(page).toHaveURL(/#\/post\/post-B\?authorId=author-B$/)
  await expect(page.getByText('Post B content', { exact: true })).toBeVisible()
  const tabTitle = page.locator(`.tab[data-tab-id="${tab.id}"] .tabTitleText`)
  await expect(tabTitle).toHaveText('Community Post | Author B')

  await page.evaluate(() => window.$store.commit('setBackendPreference', 'local'))
  const video = await openMockedVideo(page)
  await video.evaluate(element => { element.pause() })
  await expect(page.locator('.videoTitle:visible')).toHaveText(VIDEO_TITLE)
  await pending.fulfill({ json: response('A') })
  // The old API response must finish processing before returning to Post B.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.locator('.browsingBehindWatch').getByText('Post B content', { exact: true })).toHaveCount(1)
  await expect(tabTitle).toHaveText(VIDEO_TITLE)
  await page.locator(sel.backButton).click()
  await expect(page).toHaveURL(/#\/post\/post-B\?authorId=author-B$/)
  await expect(page.getByText('Post B content', { exact: true })).toBeVisible()
  await expect(tabTitle).toHaveText('Community Post | Author B')
})
