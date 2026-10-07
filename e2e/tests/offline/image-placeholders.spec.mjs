import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { IpcChannels } from '../../../src/constants.js'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false, videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true, quickBookmarkTargetPlaylistId: 'favorites', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue' },
    playlists: [{
      _id: 'favorites',
      playlistName: 'Favorites',
      protected: true,
      videos: [],
      quickBookmarkIcon: { type: 'image', value: 'data:image/png;base64,AAAA' },
      createdAt: Date.now(),
      lastUpdatedAt: Date.now()
    }],
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      subscriptions: [{ id: channelId, name: 'Placeholder channel', thumbnail: '' }]
    }],
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

async function expectStableImageSlot(app, page, container, pending, layouts = ['grid'], aspectRatio = 1) {
  const viewports = [[1600, 900, 1], [375, 812, 1], [812, 375, 1.25]]
  const placeholder = container.locator('.retryImagePlaceholder')
  const image = container.locator('img:not(.retryImagePlaceholder)')
  const fulfillImage = route => aspectRatio === 1
    ? fulfillVisualFixture(route, 'avatar')
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="224"><rect width="100%" height="100%" fill="teal"/></svg>' })
  const resize = async viewport => {
    await app.electronApp.evaluate(({ BrowserWindow }, [width, height, zoom]) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.webContents.setZoomFactor(zoom)
      window.setContentSize(width, height)
    }, viewport)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(Math.round(viewport[0] / viewport[2]))
    await expect(page.locator('.feed-enter-active, .feed-leave-active')).toHaveCount(0)
  }
  const setLayout = async layout => {
    await page.evaluate(layout => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setListType', layout), layout)
    await expect.poll(() => container.evaluate((element, layout) => element.closest('.ft-list-channel')?.classList.contains(layout) ?? true, layout)).toBe(true)
    await expect(page.locator('.feed-enter-active, .feed-leave-active')).toHaveCount(0)
  }
  const position = element => {
    const { width, height, x, y } = element.getBoundingClientRect()
    const parent = element.parentElement.getBoundingClientRect()
    return { width, height, x: x - parent.x, y: y - parent.y }
  }
  const slots = []
  for (const layout of layouts) {
    await setLayout(layout)
    for (const viewport of viewports) {
      await resize(viewport)
      await expect(placeholder).toBeVisible()
      await expect(image).toBeHidden()
      const slot = await placeholder.evaluate(position)
      expect(slot.width).toBeGreaterThan(0)
      expect(slot.width / slot.height).toBeCloseTo(aspectRatio, 3)
      slots.push(slot)
    }
  }
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  while (pending.length) await pending.shift().abort()
  await expect(image).toHaveAttribute('src', /opentubex_retry=/)
  await expect(placeholder).toBeVisible()
  for (const [key, value] of Object.entries(slots.at(-1))) expect((await placeholder.evaluate(position))[key]).toBeCloseTo(value, 1)
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  await page.route('https://slot-images.test/**', fulfillImage)
  while (pending.length) await fulfillImage(pending.shift())
  await expect(image).toBeVisible()
  await expect(placeholder).toHaveCount(0)
  let index = 0
  for (const layout of layouts) {
    await setLayout(layout)
    for (const viewport of viewports) {
      await resize(viewport)
      const expected = slots[index++]
      await expect.poll(async () => {
        const actual = await image.evaluate(position)
        return Object.entries(expected).every(([key, value]) => Math.abs(actual[key] - value) < 0.05)
      }).toBe(true)
    }
  }
}

test('preserves channel search avatar slots in grid and list layouts', async ({ app, page }) => {
  const pending = []
  let searchRequests = 0
  await page.route('https://slot-images.test/**', route => { pending.push(route) })
  await page.route('**/api/v1/search**', route => route.fulfill({
    json: searchRequests++ === 0
      ? [{
          type: 'channel', author: 'Avatar slot channel', authorId: channelId, authorThumbnails: [{ url: 'https://slot-images.test/search' }], subCount: 10, videoCount: 1, descriptionHtml: ''
        }]
      : []
  }))
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setBackendPreference', 'invidious')
    return window.ftElectron.tabs.create({ route: '/search/avatar-slots' })
  })
  await expectStableImageSlot(app, page, page.locator('.ft-list-channel .channelThumbnailLink'), pending, ['grid', 'list'])
})

test('uses channel avatar skeletons in dark and light themes', async ({ page }, testInfo) => {
  const pending = []
  await page.route('https://slot-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'avatar-color',
      data: [{ type: 'channel', dataSource: 'local', name: 'Channel avatar', id: 'avatar-color', thumbnail: 'https://slot-images.test/avatar-color' }],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
    return window.ftElectron.tabs.create({ route: '/search/avatar-color' })
  })
  const channel = page.locator('.ft-list-channel')
  const placeholder = channel.locator('.retryImagePlaceholder[data-icon="circle-user"]')
  await expect(placeholder).toBeVisible()
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  for (const iconPack of ['material', 'remix']) {
    await page.evaluate(pack => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', pack), iconPack)
    await expect(placeholder).toHaveAttribute('data-icon-pack', iconPack)
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      const mutedColor = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--tertiary-text-color)'
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })
      await expect(placeholder).toHaveCSS('color', mutedColor)
      await expect(placeholder.locator('svg')).toBeHidden()
      await expect(placeholder).toHaveCSS('animation-name', 'ft-shimmer')
      await expect(placeholder).toHaveCSS('border-radius', '50%')
      await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'reduce' })
      await expect(placeholder).toHaveCSS('animation-name', 'none')
      await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'no-preference' })
      await channel.screenshot({ path: testInfo.outputPath(`avatar-color-${iconPack}-${theme}.png`) })
    }
  }
  while (pending.length) await fulfillVisualFixture(pending.shift(), 'avatar')
  await expect(channel.locator('img.channelImage')).toBeVisible()
  await expect(placeholder).toHaveCount(0)
})

test('preserves watch channel avatar slots while loading and retrying', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const pending = []
  await page.route('https://slot-images.test/**', route => { pending.push(route) })
  const view = await watchViewHandle(page)
  await view.evaluate(view => { view.channelThumbnail = 'https://slot-images.test/watch' })
  await expectStableImageSlot(app, page, page.locator('.watchVideoInfo :is(a, div):has(> .channelThumbnail)'), pending)
})

test('preserves game cover placeholder slots in grid and list layouts', async ({ app, page }) => {
  const pending = []
  await page.route('https://slot-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'game-slots',
      data: [{ type: 'channel', dataSource: 'local', isGame: true, name: 'Game cover slot', id: 'game-slot', thumbnail: 'https://slot-images.test/game' }],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
    return window.ftElectron.tabs.create({ route: '/search/game-slots' })
  })
  await expectStableImageSlot(app, page, page.locator('.ft-list-channel .channelThumbnailLink'), pending, ['grid', 'list'], 5 / 7)
})

test('preserves playlist channel avatar slots while loading and retrying', async ({ app, page }) => {
  const pending = []
  await page.route('https://slot-images.test/**', route => { pending.push(route) })
  await page.route('**/api/v1/playlists/avatar-slots**', route => route.fulfill({
    json: {
      type: 'playlist',
      title: 'Avatar slot playlist',
      playlistId: 'avatar-slots',
      author: 'Avatar slot channel',
      authorId: channelId,
      authorThumbnails: [{ url: 'https://slot-images.test/playlist' }],
      description: '',
      descriptionHtml: '',
      videoCount: 0,
      viewCount: 1,
      updated: 1_700_000_000,
      videos: []
    }
  }))
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setBackendPreference', 'invidious')
    return window.ftElectron.tabs.create({ route: '/playlist/avatar-slots' })
  })
  await expectStableImageSlot(app, page, page.locator('.playlistInfo .playlistChannel'), pending)
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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

for (const iconPack of ['material', 'remix']) {
  test(`keeps ${iconPack} avatar placeholders visible during loading and retries`, async ({ app, page }, testInfo) => {
    await page.evaluate(pack => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', pack), iconPack)
    await goTo(page, 'subscribedchannels')

    const channel = page.locator('.channel', { hasText: 'Placeholder channel' })
    const image = channel.locator('img.channelThumbnail')
    const placeholder = channel.locator('.retryImagePlaceholder')
    const pending = []
    await page.route('https://yt3.ggpht.com/placeholder-avatar**', route => { pending.push(route) })
    const setSource = source => page.evaluate(({ channelId, source }) => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSubscriptionDetails', {
        channelId,
        channelName: 'Placeholder channel',
        channelThumbnailUrl: source
      })
    }, { channelId, source })
    await setSource('https://yt3.ggpht.com/placeholder-avatar')
    await expect.poll(() => pending.length).toBeGreaterThan(0)
    await expect(image).toBeHidden()
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toHaveClass(/ft-shimmer/)
    await expect(placeholder.locator('svg')).toBeHidden()
    await expect(placeholder).toHaveAttribute('data-icon', 'circle-user')
    await expect(placeholder).toHaveAttribute('data-icon-pack', iconPack)

    const viewports = [[1600, 900, 1], [375, 812, 1], [812, 375, 1], [812, 375, 1.25]]
    const expectedSlots = []
    const resize = async size => {
      await app.electronApp.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.webContents.setZoomFactor(size[2])
        window.setContentSize(size[0], size[1])
      }, size)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(Math.round(size[0] / size[2]))
    }
    const slotPosition = element => {
      const bounds = element.getBoundingClientRect()
      const container = element.closest('.thumbnailContainer').getBoundingClientRect()
      return { width: bounds.width, height: bounds.height, x: bounds.x - container.x, y: bounds.y - container.y }
    }
    for (const viewport of viewports) {
      await resize(viewport)
      await expect(placeholder).toBeVisible()
      // Read both rectangles in one frame while Electron finishes resizing.
      const { bounds, glyph } = await placeholder.evaluate(element => {
        const rectangle = node => {
          const { x, y, width, height } = node.getBoundingClientRect()
          return { x, y, width, height }
        }
        return { bounds: rectangle(element), glyph: rectangle(element.querySelector('svg')) }
      })
      expect(bounds.width).toBeGreaterThan(0)
      expect(bounds.height).toBe(bounds.width)
      expect(glyph.width).toBeCloseTo(bounds.width, 0)
      expect(glyph.height).toBeCloseTo(bounds.height, 0)
      expect(glyph.x).toBeCloseTo(bounds.x, 0)
      expect(glyph.y).toBeCloseTo(bounds.y, 0)
      expectedSlots.push(await placeholder.evaluate(slotPosition))
      if (viewport[0] === 812 && viewport[2] === 1) {
        await channel.screenshot({ path: testInfo.outputPath(`${iconPack}-landscape-placeholder.png`) })
        if (iconPack === 'material') {
          for (const theme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme: theme })
            await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
            await expect.poll(() => page.locator('img:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
            await channel.screenshot({ path: testInfo.outputPath(`avatar-placeholder-${theme}.png`) })
          }
        }
      }
    }

    await pending.shift().abort()
    await expect.poll(() => pending.length).toBeGreaterThan(0)
    await expect(image).toBeHidden()
    await expect(placeholder).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`${iconPack}-avatar-retry.png`) })
    const beforeLoad = await placeholder.boundingBox()
    while (pending.length) await fulfillVisualFixture(pending.shift(), 'avatar')
    await expect(image).toBeVisible()
    await expect(placeholder).toHaveCount(0)
    expect(await image.boundingBox()).toEqual(beforeLoad)
    for (const [index, viewport] of viewports.entries()) {
      await resize(viewport)
      expect(await image.evaluate(slotPosition)).toEqual(expectedSlots[index])
      if (viewport[0] === 812 && viewport[2] === 1) {
        await channel.screenshot({ path: testInfo.outputPath(`${iconPack}-landscape-avatar.png`) })
      }
    }

    await page.unroute('https://yt3.ggpht.com/placeholder-avatar**')
    await page.route('https://yt3.ggpht.com/placeholder-avatar**', route => route.abort())
    await setSource('https://yt3.ggpht.com/placeholder-avatar-new')
    await expect(image).toBeHidden()
    await expect(placeholder).toBeVisible()
    await expect(channel.locator('img.channelThumbnail')).toHaveCount(0)
    await expect(channel.locator('[data-icon="circle-user"]')).toBeVisible()
    const fallback = channel.locator('[data-icon="circle-user"]')
    expect(await fallback.evaluate(slotPosition)).toEqual(expectedSlots.at(-1))
    const fallbackBounds = await fallback.boundingBox()
    expect(await fallback.locator('svg').boundingBox()).toEqual(fallbackBounds)
  })
}

test('shimmers while a thumbnail loads and stops after decoding', async ({ page }, testInfo) => {
  const pending = []
  await page.route('https://i.ytimg.com/**', route => { pending.push(route) })
  await goTo(page, 'history')
  const video = page.locator('.ft-list-video', { hasText: 'Placeholder video' })
  const placeholder = video.locator('.retryImagePlaceholder')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toHaveCSS('animation-name', 'ft-shimmer')
  await expect(placeholder).toHaveAttribute('src', /image_skeleton/)
  await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
  const bounds = await placeholder.boundingBox()
  expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 2)
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await video.screenshot({ path: testInfo.outputPath(`thumbnail-skeleton-${theme}.png`) })
  }
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  while (pending.length) await fulfillVisualFixture(pending.shift(), 'video-thumbnail')
  await expect(placeholder).toHaveCount(0)
  const image = video.locator('.thumbnailImage')
  await expect(image).toBeVisible()
  expect(await image.boundingBox()).toEqual(bounds)
})

test('uses the thumbnail placeholder until a video image loads and after retries fail', async ({ page }) => {
  let allowImage = false
  await page.route('https://i.ytimg.com/**', route => allowImage
    ? fulfillVisualFixture(route, 'video-thumbnail')
    : route.abort())
  await goTo(page, 'history')
  const video = page.locator('.ft-list-video', { hasText: 'Placeholder video' })
  const placeholder = video.locator('.retryImagePlaceholder.thumbnailImage')
  const image = video.locator('.thumbnailImage:not(.retryImagePlaceholder)')
  await expect(placeholder).toBeVisible()
  await expect(image).toBeHidden()
  await expect(placeholder).toHaveAttribute('src', /(?:image_skeleton|thumbnail_placeholder)/)
  const bounds = await placeholder.boundingBox()
  expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 2)
  await expect(image).toHaveAttribute('src', /opentubex_retry=/)
  await expect(image).toBeHidden()
  await expect(placeholder).toBeVisible()
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await expect(placeholder).toHaveAttribute('src', /thumbnail_placeholder/)
  allowImage = true
  await goTo(page, 'subscribedchannels')
  await goTo(page, 'history')
  await expect(image).toBeVisible()
  await expect(placeholder).toHaveCount(0)
})

test('shows the default profile icon for an undecodable custom image', async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setProfileList', [{
      ...store.getters.getActiveProfile,
      icon: { type: 'image', value: 'data:image/png;base64,AAAA' }
    }])
  })
  const profile = page.locator('.topNav .profileTrigger')
  await expect(profile.locator('img')).toBeHidden()
  await expect(profile.locator('[data-icon="circle-user"]')).toBeVisible()
  await profile.screenshot({ path: testInfo.outputPath('custom-profile-fallback.png') })
})

test('shows an image icon for an undecodable quick bookmark image', async ({ page }, testInfo) => {
  await goTo(page, 'userplaylists')
  await page.getByText('Favorites', { exact: true }).click()
  const bookmark = page.getByTitle('Quick Bookmark Enabled')
  for (const pack of ['material', 'remix']) {
    await page.evaluate(pack => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', pack), pack)
    await expect(bookmark.locator('img')).toBeHidden()
    await expect(bookmark.locator('.customImagePlaceholder')).toBeVisible()
    await expect(bookmark.locator('.customImagePlaceholder')).not.toHaveClass(/ft-shimmer/)
    await bookmark.screenshot({ path: testInfo.outputPath(`${pack}-custom-bookmark-fallback.png`) })
  }
})

test('reveals cached custom bookmark images before the next painted frame', async ({ page }) => {
  await goTo(page, 'userplaylists')
  await page.getByText('Favorites', { exact: true }).click()
  const bookmark = page.getByTitle('Quick Bookmark Enabled')
  const src = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 24
    const context = canvas.getContext('2d')
    context.fillStyle = 'teal'
    context.fillRect(0, 0, 24, 24)
    const src = canvas.toDataURL()
    const image = new Image()
    image.src = src
    await image.decode()
    return src
  })
  for (const pack of ['material', 'remix']) {
    const painted = await bookmark.evaluate(async (button, { src, pack }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateIconPack', pack)
      const playlist = store.getters.getPlaylist('favorites')
      playlist.quickBookmarkIcon = 'bookmark'
      await new Promise(resolve => requestAnimationFrame(resolve))
      playlist.quickBookmarkIcon = { type: 'image', value: src }
      return new Promise(resolve => requestAnimationFrame(() => {
        const image = button.querySelector('img')
        if (!image) {
          resolve({ missingImage: true })
          return
        }
        resolve({ complete: image.complete, visibility: getComputedStyle(image).visibility, placeholder: !!button.querySelector('.customImagePlaceholder') })
      }))
    }, { src, pack })
    expect(painted).toEqual({ complete: true, visibility: 'visible', placeholder: false })
  }
})

test('keeps inline post emoji images hidden until loaded and after failure', async ({ page }, testInfo) => {
  const pending = []
  await page.route('https://images.test/**', route => { pending.push(route) })
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: {
      comments: [{
        commentId: 'placeholder-post',
        contentHtml: 'Custom emoji <img src="https://images.test/emoji" alt=":smile:" width="24" height="24"> <img src="https://images.test/loaded-emoji" alt=":ready:" width="24" height="24">',
        author: 'Placeholder channel',
        authorId: channelId,
        authorThumbnails: [],
        publishedText: '1 day ago',
        likeCount: 0,
        replyCount: 0
      }]
    }
  }))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setBackendPreference', 'invidious')
    store.commit('setHideComments', true)
    return window.ftElectron.tabs.create({ route: '/post/placeholder-post', query: { authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } })
  })
  const emoji = page.locator('img[src="https://images.test/emoji"]')
  const placeholder = page.locator('img[src="https://images.test/emoji"] + .htmlImagePlaceholder')
  await expect.poll(() => pending.length).toBe(2)
  await expect(emoji).toBeHidden()
  await expect(placeholder).toBeVisible()
  expect((await placeholder.boundingBox()).width).toBe(24)
  const loadedImage = page.locator('img[src="https://images.test/loaded-emoji"]')
  await expect(loadedImage).toBeHidden()
  const loadedRequest = pending.findIndex(route => route.request().url().endsWith('/loaded-emoji'))
  await fulfillVisualFixture(pending.splice(loadedRequest, 1)[0], 'avatar')
  await expect(loadedImage).toBeVisible()
  await expect(page.locator('img[src="https://images.test/loaded-emoji"] + .htmlImagePlaceholder')).toHaveCount(0)
  expect((await loadedImage.boundingBox()).width).toBe(24)
  const text = page.locator('.postText', { hasText: 'Custom emoji' })
  await pending.shift().abort()
  await expect(emoji).toBeHidden()
  await expect(text).toContainText(':smile:')
  await expect(placeholder).toHaveCount(0)
  await text.screenshot({ path: testInfo.outputPath('inline-emoji-fallback.png') })
})

test('keeps overlapping collaborator avatars stable while images load', async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  const pending = []
  await page.route('https://collaborator-images.test/**', route => { pending.push(route) })
  const view = await watchViewHandle(page)
  await view.evaluate(view => {
    view.channelCollaborators = Array.from({ length: 3 }, (_, index) => ({ id: `collaborator-${index}`, name: `Collaborator ${index}`, thumbnail: `https://collaborator-images.test/${index}`, subtitle: '' }))
  })
  const group = page.locator('.collaboratorSummaryThumbnails')
  await expect.poll(() => pending.length).toBe(3)
  await expect(group.locator('.retryImagePlaceholder')).toHaveCount(3)
  const positions = () => group.evaluate(element => {
    const rectangle = node => {
      const { x, y, width, height } = node.getBoundingClientRect()
      return { x, y, width, height }
    }
    const visible = [...element.querySelectorAll('.collaboratorThumbnail')].filter(node => getComputedStyle(node).visibility !== 'hidden')
    return { group: rectangle(element), avatars: visible.map(rectangle) }
  })
  const before = await positions()
  expect(before.group.width).toBe(96)
  expect(before.avatars).toHaveLength(3)
  expect(before.avatars[0].x).toBe(before.group.x)
  for (const avatar of before.avatars) {
    expect(avatar.width).toBe(40)
    expect(avatar.height).toBe(40)
  }
  // Loading just one image must not change the overlap of its neighbors.
  await fulfillVisualFixture(pending.shift(), 'avatar')
  await expect(group.locator('.retryImagePlaceholder')).toHaveCount(2)
  expect(await positions()).toEqual(before)
  while (pending.length) await fulfillVisualFixture(pending.shift(), 'avatar')
  await expect(group.locator('.retryImagePlaceholder')).toHaveCount(0)
  expect(await positions()).toEqual(before)

  await page.evaluate(() => window.ftElectron.setZoomFactor(1.25))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const scaled = await positions()
  await view.evaluate(view => { view.channelCollaborators[0].thumbnail = 'https://collaborator-images.test/replacement' })
  await expect.poll(() => pending.length).toBe(1)
  await expect(group.locator('.retryImagePlaceholder')).toHaveCount(1)
  expect(await positions()).toEqual(scaled)
  await fulfillVisualFixture(pending.shift(), 'avatar')
  await expect(group.locator('.retryImagePlaceholder')).toHaveCount(0)
  expect(await positions()).toEqual(scaled)
})

test('keeps poll image slots stable while loading and after failure', async ({ page }) => {
  const choices = [
    { text: 'Square', width: 400, height: 400 },
    { text: 'Wide', width: 600, height: 300 },
    { text: 'Tall', width: 300, height: 600 }
  ]
  const pending = []
  let failTall = false
  await page.route('https://poll-images.test/**', route => failTall && route.request().url().includes('Tall')
    ? route.abort()
    : pending.push(route))
  await page.route('**/api/v1/post/**', route => route.fulfill({
    json: {
      comments: [{
        commentId: 'placeholder-poll',
        contentHtml: 'Image poll',
        author: 'Placeholder channel',
        authorId: channelId,
        authorThumbnails: [],
        publishedText: '1 day ago',
        likeCount: 0,
        replyCount: 0,
        attachment: { type: 'poll', totalVotes: 10, choices: choices.map(choice => ({ text: choice.text, image: [{ ...choice, url: `https://poll-images.test/${choice.text}` }] })) }
      }]
    }
  }))
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('setBackendPreference', 'invidious')
    store.commit('setHideComments', true)
    return window.ftElectron.tabs.create({ route: '/post/placeholder-poll', query: { authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } })
  })
  await expect.poll(() => pending.length).toBe(3)
  const slots = []
  for (const choice of choices) {
    const option = page.locator('.poll .option', { hasText: choice.text })
    const placeholder = option.locator('.retryImagePlaceholder')
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toHaveCSS('animation-name', 'ft-shimmer')
    await expect(placeholder.locator('svg')).toBeHidden()
    const bounds = await placeholder.boundingBox()
    expect(bounds.height).toBe(125)
    expect(bounds.width).toBe(125 * choice.width / choice.height)
    slots.push(await option.locator('.option-text').boundingBox())
  }
  while (pending.length) {
    const route = pending.shift()
    const choice = choices.find(choice => route.request().url().endsWith(choice.text))
    if (choice.text === 'Tall') {
      failTall = true
      await route.abort()
    } else {
      await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${choice.width}" height="${choice.height}"><rect width="100%" height="100%" fill="teal"/></svg>` })
    }
  }
  for (const [index, choice] of choices.entries()) {
    const option = page.locator('.poll .option', { hasText: choice.text })
    if (choice.text === 'Tall') {
      await expect(option.locator('img:not(.retryImagePlaceholder)')).toHaveAttribute('src', /opentubex_retry=/)
      await expect(option.locator('img:not(.retryImagePlaceholder)')).toBeHidden()
      await expect(option.locator('.retryImagePlaceholder')).toBeVisible()
      await expect(option.locator('.retryImagePlaceholder')).not.toHaveClass(/ft-shimmer/)
      await expect(option.locator('.retryImagePlaceholder svg')).toBeVisible()
    } else {
      await expect(option.locator('img')).toBeVisible()
      await expect(option.locator('.retryImagePlaceholder')).toHaveCount(0)
    }
    expect(await option.locator('.option-text').boundingBox()).toEqual(slots[index])
  }
})

test('shows search icons while search engine favicons load and after failure', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => 'https://favicons.test/search')
  }, IpcChannels.RESOLVE_FAVICON)
  await page.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setContextMenuSearchEngines', JSON.stringify([
      { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', enabled: true }
    ]))
  })
  const pending = []
  let failImages = false
  await page.route('https://favicons.test/**', route => {
    if (failImages) return route.abort()
    pending.push(route)
  })
  const section = await goToSettingsSection(page, 'context-menu-search')
  const row = section.locator('.engineRow').filter({ hasText: 'DuckDuckGo' })
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  await expect(row.locator('img')).toBeHidden()
  await expect(row.locator('[data-icon="magnifying-glass"]')).toBeVisible()
  await row.screenshot({ path: testInfo.outputPath('search-favicon-placeholder.png') })
  failImages = true
  while (pending.length) await pending.shift().abort()
  await expect(row.locator('img')).toHaveCount(0)
  await expect(row.locator('[data-icon="magnifying-glass"]')).toBeVisible()
})

test('uses the menu action icon while its image loads and after failure', async ({ page }, testInfo) => {
  const pending = []
  let failImages = false
  await page.route('https://menu-icons.test/**', route => {
    if (failImages) return route.abort()
    pending.push(route)
  })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('opentubex:context-menu', {
    detail: {
      items: { value: [{ label: 'Search with Example', icon: 'https://menu-icons.test/search' }] },
      x: 250,
      y: 200
    }
  })))
  const menu = page.getByRole('menu', { name: 'Context Menu' })
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  await expect(menu.locator('img')).toBeHidden()
  await expect(menu.locator('[data-icon="magnifying-glass"]')).toBeVisible()
  await menu.screenshot({ path: testInfo.outputPath('context-menu-icon-placeholder.png') })
  failImages = true
  while (pending.length) await pending.shift().abort()
  await expect(menu.locator('img')).toHaveCount(0)
  await expect(menu.locator('[data-icon="magnifying-glass"]')).toBeVisible()
})

test('protects captured tab previews while loading and after failure', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.TABS_CAPTURE_PREVIEW)
    ipcMain.handle(channels.TABS_CAPTURE_PREVIEW, () => null)
    ipcMain.removeHandler(channels.TABS_GET_CACHED_PREVIEWS)
    ipcMain.handle(channels.TABS_GET_CACHED_PREVIEWS, (_event, tabIds) =>
      Object.fromEntries(tabIds.map(tabId => [tabId, 'https://tab-previews.test/captured'])))
  }, IpcChannels)
  const pending = []
  let failImages = false
  await page.route('https://tab-previews.test/**', route => {
    if (failImages) return route.abort()
    pending.push(route)
  })
  await page.locator('.tab').first().hover()
  const preview = page.locator('.tabTooltipPreview')
  await expect.poll(() => pending.length).toBeGreaterThan(0)
  await expect(preview.locator('img:not(.retryImagePlaceholder)')).toBeHidden()
  await expect(preview.locator('.retryImagePlaceholder')).toBeVisible()
  await preview.screenshot({ path: testInfo.outputPath('captured-tab-placeholder.png') })
  failImages = true
  while (pending.length) await pending.shift().abort()
  await page.locator('.tab').first().hover()
  await expect(preview.locator('img')).toHaveCount(0)
  await expect(preview.locator('.tabTooltipFallbackIcon')).toBeVisible()
  await preview.screenshot({ path: testInfo.outputPath('captured-tab-fallback.png') })
})

test('stalled playlist thumbnails stop shimmering and can still finish loading', async ({ page }, testInfo) => {
  await page.clock.install()
  const pending = []
  await page.route('https://stalled-images.test/**', route => { pending.push(route) })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.commit('addToSessionSearchHistory', {
      query: 'stalled-playlist',
      data: [{ type: 'playlist', dataSource: 'local', playlistId: 'empty-remote', title: 'Unavailable playlist thumbnail', thumbnail: 'https://stalled-images.test/playlist.jpg', channelName: 'Example channel', channelId: '', videoCount: 0 }],
      searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
      nextPageRef: null,
      hasMoreResults: false,
      apiUsed: 'local'
    })
    return window.ftElectron.tabs.create({ route: '/search/stalled-playlist' })
  })
  const card = page.locator('.ft-list-item', { hasText: 'Unavailable playlist thumbnail' })
  const placeholder = card.locator('.retryImagePlaceholder')
  await expect(placeholder).toHaveClass(/ft-shimmer/)
  await expect.poll(() => pending.length).toBe(1)
  await expect(page.locator('.feed-enter-active, .feed-leave-active')).toHaveCount(0)
  const bounds = await placeholder.boundingBox()
  await page.clock.fastForward(10_001)
  await expect(placeholder).not.toHaveClass(/ft-shimmer/)
  await expect(placeholder).toHaveAttribute('src', /thumbnail_placeholder/)
  const fallbackBounds = await placeholder.boundingBox()
  for (const [key, value] of Object.entries(bounds)) expect(fallbackBounds[key]).toBeCloseTo(value, 1)
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await card.screenshot({ path: testInfo.outputPath(`stalled-playlist-${theme}.png`) })
  }
  await fulfillVisualFixture(pending.shift(), 'video-thumbnail')
  await expect(placeholder).toHaveCount(0)
  await expect(card.locator('.thumbnailImage')).toBeVisible()
})

test('offscreen lazy Home thumbnails keep their skeleton until visible, then time out and recover', async ({ app, page }, testInfo) => {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)
  })
  await page.clock.install()
  const pending = []
  await page.route('https://lazy-images.test/**', route => { pending.push(route) })
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
  await card.scrollIntoViewIfNeeded()
  await expect.poll(() => pending.length).toBe(1)
  await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().top < innerHeight)).toBe(true)
  // Let the intersection notification start the deadline before advancing time.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
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
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
