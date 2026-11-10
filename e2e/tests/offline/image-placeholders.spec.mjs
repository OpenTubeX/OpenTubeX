import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue' },
    history: [{
      _id: 'placeholder',
      videoId: 'placeholder',
      title: 'Placeholder video',
      author: 'Placeholder channel',
      authorId: channelId,
      lengthSeconds: 120,
      type: 'video',
      isWatched: false,
      watchProgress: 0,
      timeWatched: Date.now()
    }]
  }
})

test('renders member comments and replies with missing, empty, and broken badge URLs', async ({ page }) => {
  const rendererErrors = []
  page.on('pageerror', error => rendererErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('replace')) rendererErrors.push(message.text())
  })
  const cases = [
    { name: 'Missing badge', url: null },
    { name: 'Empty badge', url: '' },
    { name: 'Broken badge', url: 'data:image/png;base64,AAAA' }
  ]
  const comment = (item, reply = false) => ({
    commentId: `${item.name}-${reply ? 'reply' : 'root'}`,
    author: `${item.name}${reply ? ' reply' : ''}`,
    authorId: channelId,
    authorThumbnails: [],
    contentHtml: reply ? 'Member reply content' : 'Member comment content',
    published: 1_700_000_000,
    likeCount: 0,
    isSponsor: true,
    sponsorIconUrl: item.url,
    ...(reply ? {} : { replies: { replyCount: 1, continuation: item.name } })
  })
  await page.route('**/api/v1/post/**', route => {
    const url = new URL(route.request().url())
    const item = cases.find(item => item.name === url.searchParams.get('continuation'))
    return route.fulfill({
      json: url.pathname.endsWith('/comments')
        ? { comments: item ? [comment(item, true)] : cases.map(item => comment(item)), commentCount: cases.length }
        : { comments: [{ commentId: 'member-post', contentHtml: 'Membership badges', author: 'Placeholder channel', authorId: channelId, authorThumbnails: [{ url: 'data:image/png;base64,AAAA' }], publishedText: '1 day ago', likeCount: 0, replyCount: 0 }] }
    })
  })
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setBackendPreference', 'invidious')
    return window.ftElectron.tabs.create({ route: '/post/member-post', query: { authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } })
  })
  for (const [index, item] of cases.entries()) {
    const root = page.locator(`#comment${index}`)
    await expect(root).toBeVisible()
    await root.locator('.commentReplyToggleLabel').click()
    const reply = page.locator('.commentReplyContent', { hasText: `${item.name} reply` })
    await expect(reply).toBeVisible()
    for (const entry of [root, reply]) {
      if (item.url === null) await expect(entry.locator(':scope > .commentAuthorWrapper .commentMemberIcon')).toHaveCount(0)
      else {
        await expect(entry.locator(':scope > .commentAuthorWrapper .commentMemberIcon[data-icon="user-check"]')).toBeVisible()
        await expect(entry.locator(':scope > .commentAuthorWrapper img.commentMemberIcon')).toBeHidden()
      }
    }
  }
  expect(rendererErrors).toEqual([])
})

test('renders live chat members with empty badge thumbnails without image setup errors', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  const rendererErrors = []
  page.on('pageerror', error => rendererErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('replace')) rendererErrors.push(message.text())
  })
  await openMockedVideo(page)
  const view = await watchViewHandle(page)
  await view.evaluate(async view => {
    const listeners = new Map()
    const chat = {
      is_replay: false,
      on: (event, listener) => listeners.set(listener, event),
      once: (event, listener) => listeners.set(listener, event),
      off: (_event, listener) => listeners.delete(listener),
      start() {},
      stop() {},
      emit(event, value) {
        for (const [listener, listenerEvent] of listeners) if (listenerEvent === event) listener(value)
      }
    }
    view.$store.commit('setHideLiveChat', false)
    view.liveChat = chat
    view.liveChatIsReplay = false
    view.liveChatOpen = true
    view.isLive = true
    view.isUpcoming = false
    await view.$nextTick()
  })
  await expect(page.locator('.liveChatSkeleton')).toBeVisible()
  await view.evaluate(view => {
    view.liveChat.emit('start', {
      actions: ['Empty', 'Broken'].map(name => {
        let checks = 0
        return {
          is: () => ++checks === 2,
          item: {
            is: () => true,
            id: `member-${name}`,
            timestamp: Date.now(),
            message: { runs: [{ text: `${name} badge message` }] },
            author: {
              id: `member-${name}`,
              name: `${name} badge member`,
              thumbnails: [{ url: 'data:image/png;base64,AAAA' }],
              badges: [{ is: () => true, custom_thumbnail: name === 'Empty' ? [] : [{ url: 'data:image/png;base64,AAAA' }], tooltip: 'Member' }],
              is_moderator: false
            }
          }
        }
      })
    })
  })
  const empty = page.locator('.liveChatComments .comment', { hasText: 'Empty badge message' })
  await expect(empty).toBeVisible()
  await expect(empty.locator('.channelName.member')).toBeVisible()
  const avatarBounds = await empty.locator('.channelThumbnail.retryImagePlaceholder').boundingBox()
  expect(avatarBounds.width).toBe(25)
  expect(avatarBounds.height).toBe(25)
  await expect(empty.locator('.badge')).toHaveCount(0)
  const broken = page.locator('.liveChatComments .comment', { hasText: 'Broken badge message' })
  await expect(broken.locator('.badgeImage[data-icon="user-check"]')).toBeVisible()
  await expect(broken.locator('img.badgeImage')).toBeHidden()
  expect(rendererErrors).toEqual([])
})

test('slow missing-resolution thumbnails give the smaller source a full loading deadline', async ({ page }, testInfo) => {
  await page.clock.install()
  const pending = []
  await page.route('https://i.ytimg.com/vi/deadline/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const store = window.$store
    store.commit('addToSessionSearchHistory', {
      query: 'resolution-deadline',
      data: [{ type: 'playlist', dataSource: 'local', playlistId: 'resolution-deadline', title: 'Resolution fallback', thumbnail: 'https://i.ytimg.com/vi/deadline/maxresdefault.jpg', channelName: 'Example channel', channelId: '', videoCount: 1 }],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
    return window.ftElectron.tabs.create({ route: '/search/resolution-deadline' })
  })
  const card = page.locator('.ft-list-item', { hasText: 'Resolution fallback' })
  const placeholder = card.locator('.retryImagePlaceholder')
  const image = card.locator('.thumbnailImage:not(.retryImagePlaceholder)')
  await expect.poll(() => pending.length).toBe(1)
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await page.clock.fastForward(9000)
  await pending[0].fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"/>' })
  await expect.poll(() => pending.length).toBe(2)
  await expect(image).toHaveAttribute('src', /\/sddefault\.jpg$/)
  await page.clock.fastForward(9001)
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  expect(pending).toHaveLength(2)
  await page.clock.fastForward(1000)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await page.clock.fastForward(3001)
  await expect.poll(() => pending.length).toBe(3)
  expect(pending[2].request().url()).toMatch(/\/sddefault\.jpg\?opentubex_retry=/)
  await fulfillVisualFixture(pending[2], 'video-thumbnail')
  await expect(placeholder).toHaveCount(0)
  await expect(image).toBeVisible()
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await image.screenshot({ path: testInfo.outputPath(`recovered-resolution-${theme}.png`) })
  }
})

for (const retrySucceeds of [true, false]) {
  test(`stalled end-screen avatars retry once and ${retrySucceeds ? 'recover without reloading' : 'keep a bounded fallback'}`, async ({ app, page }, testInfo) => {
    await mockPlayableWatchPage(app, page)
    const video = await openMockedVideo(page)
    await video.evaluate(element => element.pause())
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)
    })
    await page.clock.install()
    const pending = []
    const requests = []
    await page.route('https://annotation-images.test/**', route => {
      requests.push(route.request().url())
      pending.push(route)
    })
    const view = await watchViewHandle(page)
    await view.evaluate((view, retrySucceeds) => {
      view.$store.commit('setHideEndScreenAnnotations', false)
      view.videoAnnotations = [{
        id: 'retry-channel',
        type: 'CHANNEL',
        title: 'End-screen channel',
        startTime: 0,
        endTime: 1000,
        left: 0.6,
        top: 0.2,
        width: 0.1,
        aspectRatio: 1,
        route: '/channel/UCaaaaaaaaaaaaaaaaaaaaaa',
        thumbnail: retrySucceeds ? '//annotation-images.test/avatar' : 'https://annotation-images.test/avatar'
      }]
    }, retrySucceeds)
    const avatar = page.locator('.channelAvatarLink')
    const image = avatar.locator('img:not(.retryImagePlaceholder)')
    const placeholder = avatar.locator('.retryImagePlaceholder')
    await expect.poll(() => pending.length).toBe(1)
    await expect(placeholder).toHaveClass(/ft-shimmer/)
    const originalImage = await image.elementHandle()
    const bounds = await placeholder.boundingBox()
    const playbackTime = await video.evaluate(element => element.currentTime)
    await page.clock.fastForward(10_001)
    await expect(placeholder).not.toHaveClass(/ft-shimmer/)
    expect(requests).toHaveLength(1)
    await page.clock.fastForward(2000)
    expect(requests).toHaveLength(1)
    await page.clock.fastForward(1_001)
    await expect.poll(() => pending.length).toBe(2)
    await expect(image).toHaveAttribute('src', /opentubex_retry=/)
    expect(await image.evaluate((image, original) => image === original, originalImage)).toBe(true)
    if (retrySucceeds) {
      await fulfillVisualFixture(pending[1], 'avatar')
      await expect(placeholder).toHaveCount(0)
      await expect(image).toBeVisible()
      const loadedBounds = await image.boundingBox()
      for (const [key, value] of Object.entries(bounds)) expect(loadedBounds[key]).toBeCloseTo(value, 1)
      expect(await video.evaluate(element => element.currentTime)).toBe(playbackTime)
      // Capture normal dimensions after checking recovery at 125% UI Scale.
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
      })
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
        await avatar.screenshot({ path: testInfo.outputPath(`recovered-annotation-${theme}.png`) })
      }
    } else {
      await pending[1].abort()
      await expect(placeholder.locator('svg')).toBeVisible()
      await page.clock.fastForward(120_000)
      expect(requests).toHaveLength(2)
      await expect(placeholder).not.toHaveClass(/ft-shimmer/)
    }
  })
}

test('offscreen lazy Home thumbnails keep their skeleton until visible, then time out and recover', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)
  })
  await page.clock.install()
  const pending = []
  await page.route('https://lazy-images.test/**', route => { pending.push(route) })
  await page.evaluate(async () => {
    const store = window.$store
    await store.dispatch('updateHistory', {
      ...store.getters.getHistoryCacheById.placeholder,
      watchProgress: 30,
      thumbnailUrl: 'https://lazy-images.test/thumbnail.jpg'
    })
  })
  // Position the shelf below the fold before its lazy images mount.
  await page.addStyleTag({ content: '[data-home-section="continueWatching"] { margin-block-start: 4000px !important; }' })
  await goTo(page, 'home')
  const card = page.locator('[data-home-section="continueWatching"] li').first()
  const image = card.locator('img:not(.retryImagePlaceholder)')
  const placeholder = card.locator('.retryImagePlaceholder')
  await expect(image).toHaveAttribute('loading', 'lazy')
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().top > innerHeight)).toBe(true)
  await page.clock.fastForward(10_001)
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await expect(placeholder).toHaveCSS('animation-play-state', 'paused', { pseudo: 'before' })
  await card.scrollIntoViewIfNeeded()
  await expect.poll(() => pending.length).toBe(1)
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().top < innerHeight)).toBe(true)
  const thumbnailBounds = await card.locator('.mediaThumbnail').boundingBox()
  const skeletonBounds = await placeholder.boundingBox()
  expect(skeletonBounds.width).toBeCloseTo(thumbnailBounds.width, 1)
  expect(skeletonBounds.height).toBeCloseTo(thumbnailBounds.height, 1)
  // Let the intersection notification start the deadline before advancing time.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(placeholder).toHaveCSS('animation-play-state', 'running', { pseudo: 'before' })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(placeholder).toHaveCSS('animation-play-state', 'paused', { pseudo: 'before' })
  await card.scrollIntoViewIfNeeded()
  await expect(placeholder).toHaveCSS('animation-play-state', 'running', { pseudo: 'before' })
  // Capture at normal scale after checking visibility at a fractional zoom.
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
  })
  await card.scrollIntoViewIfNeeded()
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await expect(placeholder).toHaveClass(/ft-shimmer/)
    await card.locator('.mediaThumbnail').screenshot({ path: testInfo.outputPath(`lazy-thumbnail-${theme}.png`) })
  }
  await page.clock.fastForward(10_001)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await fulfillVisualFixture(pending.shift(), 'video-thumbnail')
  await expect(placeholder).toHaveCount(0)
  await expect(image).toBeVisible()
})

test('playlist cards with missing thumbnails use static fallbacks', async ({ page }) => {
  const rendererErrors = []
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.evaluate(() => {
    const store = window.$store
    store.commit('addToSessionSearchHistory', {
      query: 'missing-playlist-images',
      data: [null, undefined, '', '   '].map((thumbnail, index) => ({ type: 'playlist', dataSource: 'local', playlistId: `missing-${index}`, title: `Empty playlist ${index}`, thumbnail, channelName: '', channelId: '', videoCount: 0 })),
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
    return window.ftElectron.tabs.create({ route: '/search/missing-playlist-images' })
  })
  const cards = page.locator('.ft-list-item')
  await expect(cards).toHaveCount(4)
  await expect(cards.locator('.ft-shimmer')).toHaveCount(0)
  for (const card of await cards.all()) {
    await expect(card.locator('.retryImagePlaceholder')).toBeVisible()
    await expect(card.locator('.retryImagePlaceholder')).toHaveAttribute('src', /thumbnail_placeholder/)
  }
  expect(rendererErrors).toEqual([])
})
