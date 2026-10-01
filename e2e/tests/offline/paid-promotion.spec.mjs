import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const helpUrl = 'https://support.google.com/youtube?p=ppp&nohelpkit=1'

test.use({
  seed: { settings: { currentLocale: 'en-US', externalLinkHandling: 'openLinkAfterPrompt' } }
})

test('paid promotion badge respects every external link opening policy', async ({ app, page }) => {
  await app.electronApp.evaluate(({ shell }) => {
    globalThis.paidPromotionExternalUrls = []
    shell.openExternal = async url => {
      globalThis.paidPromotionExternalUrls.push(url)
    }
  })
  const openedUrls = () => app.electronApp.evaluate(() => globalThis.paidPromotionExternalUrls)

  await mockPlayableWatchPage(app, page)
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.paidPromotionDurationMs = 60000
    component.proxy.hasPaidPromotion = true
    await component.proxy.$nextTick()
  })
  await watch.dispose()

  const badge = page.locator('.paidPromotionBadge')
  const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })
  await badge.getByText('Includes paid promotion').click()
  await expect(prompt).toBeVisible({ timeout: 5000 })
  await expect(prompt.getByText(helpUrl, { exact: true })).toBeVisible()
  expect(await openedUrls()).toEqual([])

  await prompt.getByRole('button', { name: 'No', exact: true }).press('Space')
  await expect(prompt).toBeHidden()
  expect(await openedUrls()).toEqual([])

  await badge.press('Enter')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Yes, Open Link', exact: true }).press('Space')
  await expect(prompt).toBeHidden()
  await expect.poll(openedUrls).toEqual([helpUrl])
  await expect(video).toHaveJSProperty('paused', true)

  await badge.press('Space')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'No', exact: true }).press('Enter')
  await expect(prompt).toBeHidden()
  expect(await openedUrls()).toEqual([helpUrl])
  await expect(video).toHaveJSProperty('paused', true)

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateExternalLinkHandling', 'doNothing')
  })
  await badge.click()
  await expect(page.getByText('External link opening has been disabled in Settings → Privacy', { exact: true })).toBeVisible()
  await expect(prompt).toBeHidden()
  expect(await openedUrls()).toEqual([helpUrl])

  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateExternalLinkHandling', '')
  })
  await badge.click()
  await expect.poll(openedUrls).toEqual([helpUrl, helpUrl])
  await expect(prompt).toBeHidden()
  await expect(video).toHaveJSProperty('paused', true)
})
