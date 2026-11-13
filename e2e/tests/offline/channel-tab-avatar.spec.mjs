import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'
import { expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test'
    }
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const channelId = new URL(route.request().url()).pathname.split('/')[4]
    return route.fulfill({
      json: {
        author: 'Channel',
        authorId: channelId,
        authorThumbnails: [{ url: `https://invidious.test/avatar/${channelId}`, width: 48, height: 48 }],
        authorBanners: [],
        description: 'Channel description',
        subCount: 0,
        totalViews: 0,
        joined: 0,
        tabs: ['videos', 'shorts', 'streams'],
        relatedChannels: [],
        videos: [],
        latestVideos: []
      }
    })
  })
  // The saved avatar uses Electron's native decoder, which needs a raster image.
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://invidious.test/avatar/**', route => route.fulfill({ body: avatar, contentType: 'image/png' }))
})

test('applies a refreshed avatar after switching sections during its download', async ({ page }) => {
  const channelPath = '/channel/UCaaaaaaaaaaaaaaaaaaaaaa'
  const tab = await page.evaluate(route => window.ftElectron.tabs.create({
    route,
    makeActive: false,
    lazyLoad: true,
    avatarDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  }), channelPath)
  const image = page.locator(`.tabBar .tab[data-tab-id="${tab.id}"] img.tabAvatar`)
  await expectImagesLoaded(image)
  const oldSource = await image.getAttribute('src')

  let releaseDownload
  let downloadStarted
  const pendingDownload = new Promise(resolve => { releaseDownload = resolve })
  const started = new Promise(resolve => { downloadStarted = resolve })
  const avatar = await readFile(new URL('../../fixtures/media/avatar.png', import.meta.url))
  await page.route('https://invidious.test/avatar/**', async route => {
    if (route.request().resourceType() === 'fetch') {
      downloadStarted()
      await pendingDownload
    }
    await route.fulfill({ body: avatar, contentType: 'image/png' })
  })

  try {
    await page.locator(`.tabBar .tab[data-tab-id="${tab.id}"]`).click()
    await started
    await page.locator('.channelDetails:visible #aboutTab').click()
    await expect(page).toHaveURL(new RegExp(`${channelPath}/about$`))
    await expect(image).toHaveAttribute('src', oldSource)
    releaseDownload()
    await expect(image).not.toHaveAttribute('src', oldSource)
    await expect(image).toHaveAttribute('src', /^data:image\/jpeg/)
    await expectImagesLoaded(image)
    await expect(image).toBeVisible()
  } finally {
    releaseDownload()
  }
})
