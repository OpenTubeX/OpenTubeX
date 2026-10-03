import { readFile } from 'node:fs/promises'
import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { IpcChannels } from '../../../src/constants.js'

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false, quickBookmarkTargetPlaylistId: 'favorites', baseTheme: 'system', systemDarkTheme: 'dark', systemLightTheme: 'light', mainColor: 'Red', secColor: 'Blue' },
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
  await expect(placeholder).toHaveAttribute('src', /thumbnail_placeholder/)
  const bounds = await placeholder.boundingBox()
  expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 2)
  await expect(image).toHaveAttribute('src', /opentubex_retry=/)
  await expect(image).toBeHidden()
  await expect(placeholder).toBeVisible()
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
    await bookmark.screenshot({ path: testInfo.outputPath(`${pack}-custom-bookmark-fallback.png`) })
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

test('isolates inline HTML placeholders from responsive image sources', async ({ page }) => {
  const source = await readFile(new URL('../../../src/renderer/helpers/htmlImagePlaceholder.js', import.meta.url), 'utf8')
  const svg = await readFile(new URL('../../../src/renderer/assets/img/thumbnail_placeholder.svg', import.meta.url), 'utf8')
  const pending = []
  await page.route('https://responsive-images.test/**', route => { pending.push(route) })
  // Exercise the DOM helper with the responsive markup retained by DOMPurify
  // on WebViews without the native HTML Sanitizer.
  await page.addScriptTag({ content: source.replace(/^import .*\n/, `const thumbnailPlaceholder = ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(svg)}`)}\n`).replace('export function', 'function') })
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'responsive-placeholder-test'
    container.innerHTML = '<img id="responsive-image" src="https://responsive-images.test/base" srcset="https://responsive-images.test/candidate 1x" sizes="24px" alt="Responsive image" width="24" height="24"><picture><source srcset="https://responsive-images.test/picture"><img id="picture-image" src="https://responsive-images.test/picture-base" alt="Picture image" width="24" height="24"></picture>'
    document.body.append(container)
    window.addHtmlImagePlaceholders(container)
  })
  const container = page.locator('#responsive-placeholder-test')
  const placeholders = container.locator('.htmlImagePlaceholder')
  await expect(placeholders).toHaveCount(2)
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).not.toHaveAttribute('srcset')
    await expect(placeholder).not.toHaveAttribute('sizes')
    await expect(placeholder).not.toHaveAttribute('id')
    await expect(placeholder).toHaveAttribute('alt', '')
    await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => placeholder.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect((await placeholder.boundingBox()).width).toBe(24)
  }
  await expect(container.locator('picture .htmlImagePlaceholder')).toHaveCount(0)
  while (pending.length) await pending.shift().abort()
  await expect(container).toContainText('Responsive image')
  await expect(container).toContainText('Picture image')
  await expect(placeholders).toHaveCount(0)
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
  await app.electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => 'https://tab-previews.test/captured')
  }, IpcChannels.TABS_CAPTURE_PREVIEW)
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
