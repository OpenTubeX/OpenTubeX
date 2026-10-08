import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'

async function expectCircularButton(button) {
  await expect(button).toBeVisible()
  const geometry = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const glyph = element.querySelector('svg').getBoundingClientRect()
    return {
      width: bounds.width,
      height: bounds.height,
      radius: getComputedStyle(element).borderRadius,
      horizontalOffset: glyph.left + glyph.width / 2 - bounds.left - bounds.width / 2,
      verticalOffset: glyph.top + glyph.height / 2 - bounds.top - bounds.height / 2
    }
  })
  expect(geometry.radius).toMatch(/^(50|100)%$/)
  expect(geometry.width).toBeCloseTo(geometry.height, 1)
  expect(Math.abs(geometry.horizontalOffset)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.verticalOffset)).toBeLessThanOrEqual(1)
}

for (const uiScale of [100, 95, 125]) {
  test.describe(`circular icon buttons at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          currentLocale: 'en-US',
          uiScale,
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          useDeArrowTitles: true
        }
      }
    })

    test('keeps live chat hover backgrounds circular in both icon packs', async ({ app, page }, testInfo) => {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', 'dark'))
      await mockPlayableWatchPage(app, page)
      await openMockedVideo(page)
      const view = await watchViewHandle(page)
      await view.evaluate(view => {
        view.liveChat = {
          is_replay: false,
          on() {},
          once() {},
          off() {},
          start() {},
          stop() {}
        }
        view.liveChatIsReplay = false
        view.liveChatOpen = true
        view.isLive = true
        view.$store.commit('setHideLiveChat', false)
      })
      const buttons = page.locator('.liveChatActions .liveChatActionButton')
      await expect(buttons).toHaveCount(3)
      for (const pack of ['material', 'remix']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
        await expect(buttons.first().locator('.ft-icon')).toHaveAttribute('data-icon-pack', pack)
        for (const button of await buttons.all()) {
          await button.hover()
          await expect(button).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
          await expectCircularButton(button)
          await button.focus()
          await expectCircularButton(button)
        }
        const close = buttons.last()
        await close.blur()
        await close.hover()
        await expect.poll(() => close.evaluate(element => element.matches(':hover'))).toBe(true)
        await expect(close).toHaveCSS('background-color', 'rgb(39, 39, 39)')
        const screenshot = testInfo.outputPath(`live-chat-hover-${pack}.png`)
        const header = await page.locator('.watchVideoPlaylist:has(.liveChatActions) .titleContainer').boundingBox()
        await page.screenshot({ path: screenshot, clip: header })
        await testInfo.attach(`live chat hover ${pack}`, { path: screenshot, contentType: 'image/png' })
      }
    })

    test('keeps filter reset circular on desktop and narrow windows', async ({ app, page }) => {
      await page.locator('.navFilterButton').click()
      await page.locator('.searchRadio', { hasText: 'Time' }).getByText('Today', { exact: true }).click()
      const button = page.locator('.clearFilterButton')
      for (const pack of ['material', 'remix']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
        await expect(button.locator('.ft-icon')).toHaveAttribute('data-icon-pack', pack)
        await button.hover()
        await expectCircularButton(button)
      }
      await setWindowSize(app, page, { width: 480, height: 800 })
      await expectCircularButton(button)
      await button.click()
      await expect(button).toBeHidden()
    })

    test('centers the DeArrow toggle inside a circular hover background', async ({ page }) => {
      await page.evaluate(() => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        store.commit('addVideoToDeArrowCache', { videoId: 'circle-video', title: 'Clear title', thumbnail: null })
        store.commit('addToSessionSearchHistory', {
          query: 'circle',
          data: [{ type: 'video', videoId: 'circle-video', title: 'Original title', author: 'Channel', authorId: 'UCcircle', lengthSeconds: 60, viewCount: 1, publishedText: 'Today', videoThumbnails: [] }],
          searchSettings: { prioritize: 'relevance', time: '', type: 'all', duration: '', features: [] },
          nextPageRef: null,
          hasMoreResults: false,
          apiUsed: 'local'
        })
      })
      await page.locator('.topNav input[type="search"]').fill('circle')
      await page.locator('.topNav input[type="search"]').press('Enter')
      const button = page.locator('.deArrowToggleButton').first()
      for (const pack of ['material', 'remix']) {
        await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateIconPack', value), pack)
        await expect(button.locator('.ft-icon')).toHaveAttribute('data-icon-pack', pack)
        await button.hover()
        await expectCircularButton(button)
      }
    })
  })
}
