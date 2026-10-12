import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { mockWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { fulfillVisualFixture, expectImagesLoaded } from '../../helpers/visual-fixtures.mjs'

const disclosure = {
  label: 'Altered or synthetic content',
  description: 'Sound or visuals were significantly edited or digitally generated. Learn more.',
  attribution: 'Disclosure added by the creator'
}

for (const uiScale of [100, 125]) {
  test.describe(`content disclosures at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: {
          uiScale,
          baseTheme: 'system',
          systemDarkTheme: 'dark',
          systemLightTheme: 'light',
          mainColor: 'Red',
          secColor: 'Blue',
          videoPlaybackEngine: 'built-in',
          ytDlpPlaybackEngineDefaultMigration: true,
          defaultVideoFormat: 'legacy',
          useSponsorBlock: false,
        }
      }
    })

    test('shows disclosures with the existing AI badge and preserves description scrolling', async ({ app, page }, testInfo) => {
      await mockWatchPage(app, page, { playable: true, contentDisclosures: [disclosure] })
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
      await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))
      await page.route('https://yt3.googleusercontent.com/**', route => fulfillVisualFixture(route, 'avatar'))
      const video = await openMockedVideo(page)
      await video.evaluate(element => element.pause())
      const watch = await watchViewHandle(page)
      await expect(page.locator('.videoBadge[title="AI-generated content"]')).toHaveCount(1)
      await expect(page.getByTitle('Reload Page', { exact: true })).toHaveCount(0)
      const card = page.locator('.videoDescription').last()
      await expect(card).toBeVisible()
      await card.locator('.descriptionStatus').click()
      await expect(card.locator('.contentDisclosureTitle')).toHaveText('How this was made')
      await expect(card.locator('.contentDisclosureBody')).toHaveText('Sound or visuals were significantly edited or digitally generated.')
      await expect(card.locator('.contentDisclosureAttribution')).toHaveText(disclosure.attribution)

      await watch.evaluate(vm => {
        vm.videoDescriptionHtml = ''
        vm.videoTags = []
        vm.videoGames = []
        vm.license = null
        vm.videoDescription = 'A video about how content is created. '.repeat(200)
      })
      const scroller = card.locator('.descriptionScroll')
      for (const size of [{ width: 1440, height: 950 }, { width: 900, height: 600 }, { width: 1440, height: 900 }]) {
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
        await setWindowSize(app, page, size)
        await expect.poll(() => scroller.evaluate(element => element.scrollTop - (element.scrollHeight - element.clientHeight))).toBeLessThanOrEqual(1)
      }
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await watch.evaluate(vm => { vm.videoDescription = 'A video about how content is created.' })
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await expect(scroller.locator('.os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)

      if (await card.locator('img').count()) await expectImagesLoaded(card.locator('img'))
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme })
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
        await card.screenshot({ path: testInfo.outputPath(`content-disclosures-${theme}.png`) })
      }

      await watch.evaluate(vm => { vm.videoDescription = 'Long description. '.repeat(200) })
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await card.locator('.descriptionStatus').click()
      await expect(card.locator('.contentDisclosureSection')).toHaveCount(0)
      await card.locator('.descriptionStatus').click()
      await watch.evaluate((vm, item) => {
        vm.videoDescription = 'A video about how content is created.'
        vm.contentDisclosures = Array.from({ length: 15 }, () => item)
      }, disclosure)
      await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await watch.evaluate(vm => { vm.contentDisclosures = null })
      await expect(card.locator('.contentDisclosureSection')).toHaveCount(0)
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)

      // Disclosure-only videos must retain access to their metadata.
      await watch.evaluate((vm, item) => { vm.videoDescription = ''; vm.contentDisclosures = [item] }, disclosure)
      await expect(card.locator('.contentDisclosureHeader')).toHaveText(disclosure.label)
      await setWindowSize(app, page, { width: 375, height: 812 })
      await page.locator('.phoneDescriptionPreview .descriptionStatus').click()
      await expect(page.locator('.mobileSheet[open] .contentDisclosureHeader')).toHaveText(disclosure.label)
    })
  })
}
