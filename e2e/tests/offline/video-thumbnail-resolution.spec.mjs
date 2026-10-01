import { test, expect, goTo, goToSettingsSection, waitForAppReady } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
async function openAppearance(page) {
  await goTo(page, 'settings')
  const content = page.locator('.settingsContent > [data-section="appearance"]')
  return await content.isVisible() ? content : goToSettingsSection(page, 'appearance')
}

const videos = ['max-quality', 'sd-quality', 'hq-quality'].map((videoId, index) => ({
  videoId,
  title: videoId,
  author: 'Thumbnail channel',
  authorId: CHANNEL_ID,
  published: Date.now() - index * 1000,
  lengthSeconds: 120,
  type: 'video'
}))

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false, landingPage: 'history', hideSubscriptionsShorts: false },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#ffffff',
      subscriptions: [{ id: CHANNEL_ID, name: 'Thumbnail channel', thumbnail: '' }]
    }],
    subscriptionCache: [{
      _id: CHANNEL_ID,
      videos,
      videosTimestamp: new Date().toISOString(),
      shorts: [{ ...videos[0], videoId: 'portrait', title: 'Portrait short', thumbnailUrl: 'https://i.ytimg.com/vi/portrait/large.jpg', lowResolutionThumbnailUrl: 'https://i.ytimg.com/vi/portrait/small.jpg' }],
      shortsTimestamp: new Date().toISOString()
    }]
  }
})

for (const backend of ['local', 'invidious']) {
  test(`loads sharp thumbnails and falls back without resizing cards on ${backend}`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.webContents.setZoomFactor(1.25)
      window.setContentSize(515, 1000)
    })
    await page.evaluate(async backend => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateBackendPreference', backend)
      await store.dispatch('updateDefaultInvidiousInstance', 'https://invidious.test')
    }, backend)
    const origin = backend === 'local' ? 'https://i.ytimg.com' : 'https://invidious.test'
    const requests = []
    await page.route(/^https:\/\/(?:i\.ytimg\.com|invidious\.test)\/vi\//, async route => {
      const url = new URL(route.request().url())
      requests.push(url.pathname)
      const [, , id, quality] = url.pathname.split('/')
      if (id === 'hq-quality' && quality === 'maxresdefault.jpg') {
        await route.fulfill({ status: 404 })
        return
      }
      const missing = (id === 'sd-quality' && quality === 'maxresdefault.jpg') ||
        (id === 'hq-quality' && quality === 'sddefault.jpg')
      const dimensions = {
        'maxresdefault.jpg': [1280, 720],
        'sddefault.jpg': [640, 480],
        'hqdefault.jpg': [480, 360],
        'mqdefault.jpg': [320, 180],
        'large.jpg': [720, 1080],
        'small.jpg': [120, 180]
      }
      const [width, height] = missing ? [120, 90] : dimensions[quality]
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#336699"/></svg>`
      })
    })
    await goTo(page, 'subscriptions')
    for (const [index, quality, width] of [[0, 'maxresdefault', 1280], [1, 'sddefault', 640], [2, 'hqdefault', 480]]) {
      const image = page.locator('.ft-list-video').filter({ has: page.getByRole('heading', { name: videos[index].title, exact: true }) }).locator('.thumbnailImage').first()
      await expect(image).toHaveAttribute('src', `${origin}/vi/${videos[index].videoId}/${quality}.jpg`)
      await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBe(width)
      const dimensions = await image.evaluate(element => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        fit: getComputedStyle(element).objectFit
      }))
      expect(dimensions.width / dimensions.height).toBeCloseTo(16 / 9, 2)
      expect(dimensions.fit).toBe('cover')
      expect(requests).toContain(`/vi/${videos[index].videoId}/maxresdefault.jpg`)
    }

    const appearance = await openAppearance(page)
    await expect(appearance.getByRole('checkbox', { name: /^Data saver thumbnails/ })).not.toBeChecked()
    await appearance.locator('label.switch-label').filter({ hasText: 'Data saver thumbnails' }).click()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    const images = page.locator('.ft-list-video .thumbnailImage')
    for (let index = 0; index < videos.length; index++) {
      await expect(images.nth(index)).toHaveAttribute('src', `${origin}/vi/${videos[index].videoId}/mqdefault.jpg`)
      await expect.poll(() => images.nth(index).evaluate(element => element.naturalWidth)).toBe(320)
    }
    await page.reload()
    await waitForAppReady(page)
    const reopened = await openAppearance(page)
    await expect(reopened.getByRole('checkbox', { name: /^Data saver thumbnails/ })).toBeChecked()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await goTo(page, 'subscriptions')
    await expect(images.first()).toHaveAttribute('src', `${origin}/vi/${videos[0].videoId}/mqdefault.jpg`)
    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    const portrait = page.locator('.ft-list-video.youtubeShort .thumbnailImage').first()
    await expect(portrait).toHaveAttribute('src', 'https://i.ytimg.com/vi/portrait/small.jpg')
    await expect.poll(() => portrait.evaluate(element => element.naturalWidth)).toBe(120)
    const settings = await openAppearance(page)
    await settings.locator('label.switch-label').filter({ hasText: 'Data saver thumbnails' }).click()
    await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(portrait).toHaveAttribute('src', 'https://i.ytimg.com/vi/portrait/large.jpg')
    await expect.poll(() => portrait.evaluate(element => element.naturalWidth)).toBe(720)
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(images.first()).toHaveAttribute('src', `${origin}/vi/${videos[0].videoId}/maxresdefault.jpg`)
    await expect.poll(() => images.first().evaluate(element => element.naturalWidth)).toBe(1280)
  })
}
