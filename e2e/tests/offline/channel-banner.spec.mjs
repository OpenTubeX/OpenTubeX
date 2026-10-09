import { readFile } from 'node:fs/promises'

import { test, expect } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const banner = await readFile(new URL('../../../src/renderer/assets/img/defaultBanner.png', import.meta.url))

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test',
      uiRoundness: 200
    }
  }
})

async function mockChannel(page) {
  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: {
      author: 'Banner channel',
      authorId: new URL(route.request().url()).pathname.split('/')[4],
      authorThumbnails: [],
      authorBanners: [{ url: 'https://yt3.ggpht.com/banner' }],
      description: '',
      subCount: 10,
      totalViews: 0,
      joined: 0,
      tabs: ['videos'],
      relatedChannels: [],
      videos: [],
      latestVideos: []
    }
  }))
}

async function openChannel(page, id = CHANNEL_ID) {
  const tab = await page.evaluate(id => window.ftElectron.tabs.create({ route: `/channel/${id}`, makeActive: false }), id)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page.locator('.channelDetails:visible .name')).toHaveText('Banner channel')
  return tab.id
}

test('recovers a failed channel banner after switching away and back', async ({ page }) => {
  await mockChannel(page)
  await page.setViewportSize({ width: 412, height: 915 })
  let requests = 0
  let fail = true
  await page.route('https://invidious.test/ggpht/banner*', route => {
    requests++
    return fail ? route.abort() : route.fulfill({ contentType: 'image/png', body: banner })
  })
  const originalTab = await page.evaluate(() => window.ftElectron.tabs.getState()).then(state => state.activeTabId)
  const channelTab = await openChannel(page)
  await expect.poll(() => requests).toBeGreaterThan(0)
  await page.locator(`.tab[data-tab-id="${originalTab}"]`).click()
  const failedRequests = requests
  fail = false
  await expect.poll(() => requests, { timeout: 8000, message: 'A failed banner must retry while its channel tab is hidden' }).toBeGreaterThan(failedRequests)
  await page.locator(`.tab[data-tab-id="${channelTab}"]`).click()
  const container = page.locator('.bannerContainer:visible')
  const image = container.locator('img').first()
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(image).toBeVisible()
  for (const scale of [1, 0.95]) {
    await page.evaluate(value => window.ftElectron.setZoomFactor(value), scale)
    for (const width of [375, 812, 1600]) {
      await page.setViewportSize({ width, height: 915 })
      await expect.poll(() => image.evaluate(element => {
        const image = element.getBoundingClientRect()
        const container = element.parentElement.getBoundingClientRect()
        return Math.abs(image.width - container.width) < 1 && Math.abs(image.height - container.height) < 1
      })).toBe(true)
    }
  }
  await expect(container).toHaveCSS('border-top-left-radius', '16px')
})

test('uses the default banner after permanent failure and loads a replacement banner', async ({ page }) => {
  await mockChannel(page)
  let fail = true
  await page.route('https://invidious.test/ggpht/banner*', route => fail ? route.abort() : route.fulfill({ contentType: 'image/png', body: banner }))
  await openChannel(page)
  await expect(page.locator('.bannerContainer:visible')).toHaveClass(/default/, { timeout: 8000 })
  await expect(page.locator('.bannerContainer:visible')).toHaveCSS('background-repeat', 'repeat')
  fail = false
  // Exercise the header's reactive input independently of URL resolution.
  await page.evaluate(() => {
    const find = vnode => {
      if (vnode?.component?.type?.__name === 'ChannelDetails') return vnode.component
      const nested = vnode?.component?.subTree && find(vnode.component.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
        const match = find(child)
        if (match) return match
      }
    }
    find(document.querySelector('#app').__vue_app__._container._vnode).props.bannerUrl = 'https://invidious.test/ggpht/banner-next'
  })
  const image = page.locator('.bannerContainer:visible img').first()
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.bannerContainer:visible')).not.toHaveClass(/default/)
})

test('uses the default banner when both browser requests remain stalled', async ({ page }) => {
  await mockChannel(page)
  await page.clock.install()
  let requests = 0
  await page.route('https://invidious.test/ggpht/banner*', () => { requests++ })
  await openChannel(page)
  await expect.poll(() => requests).toBe(1)
  await page.clock.fastForward(10_001)
  await page.clock.fastForward(3001)
  await expect.poll(() => requests).toBe(2)
  await page.clock.fastForward(10_001)
  await expect(page.locator('.bannerContainer:visible')).toHaveClass(/default/)
  await expect(page.locator('.bannerContainer:visible img')).toHaveCount(0)
  await page.clock.fastForward(60_000)
  expect(requests).toBe(2)
})
