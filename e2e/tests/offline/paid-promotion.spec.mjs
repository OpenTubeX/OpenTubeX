import { test, expect } from '../../helpers/app.mjs'
import { findWatchComponent, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const helpUrl = 'https://support.google.com/youtube?p=ppp&nohelpkit=1'

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      externalLinkHandling: 'openLinkAfterPrompt',
      holdToDoublePlaybackSpeed: true
    }
  }
})

async function openPaidPromotionVideo(app, page, { sponsorBlock = false } = {}) {
  await mockPlayableWatchPage(app, page)
  if (sponsorBlock) {
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'paid-promotion-sponsor',
          actionType: 'skip',
          category: 'sponsor',
          segment: [15, 20],
          videoDuration: 30,
          votes: 1
        }]
      }])
    }))
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockSponsor', { color: '#00d400', skip: 'promptToSkip' })
      store.commit('setSponsorBlockSkippedToastDuration', 15)
    })
  }
  const video = await openMockedVideo(page)
  await video.evaluate(element => element.pause())
  const watch = await page.evaluateHandle(findWatchComponent)
  await watch.evaluate(async component => {
    component.proxy.paidPromotionDurationMs = 60000
    component.proxy.hasPaidPromotion = true
    await component.proxy.$nextTick()
  })
  await watch.dispose()
  return video
}

test('paid promotion badge respects every external link opening policy', async ({ app, page }) => {
  await app.electronApp.evaluate(({ shell }) => {
    globalThis.paidPromotionExternalUrls = []
    shell.openExternal = async url => {
      globalThis.paidPromotionExternalUrls.push(url)
    }
  })
  const openedUrls = () => app.electronApp.evaluate(() => globalThis.paidPromotionExternalUrls)

  const video = await openPaidPromotionVideo(app, page)

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

for (const noticeType of ['prompt', 'toast']) {
  test(`Enter activates paid promotion confirmation with an active SponsorBlock ${noticeType}`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ shell }) => {
      globalThis.paidPromotionExternalUrls = []
      shell.openExternal = async url => {
        globalThis.paidPromotionExternalUrls.push(url)
      }
    })
    const openedUrls = () => app.electronApp.evaluate(() => globalThis.paidPromotionExternalUrls)
    const video = await openPaidPromotionVideo(app, page, { sponsorBlock: true })
    const player = page.locator('.ftVideoPlayer')
    await expect(player.locator('.sponsorBlockMarker')).toHaveCount(1)
    await video.evaluate(element => {
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })
    const noticeAction = player.locator('.unskipButton')
    await expect(noticeAction).toHaveText('Skip (Enter)')
    if (noticeType === 'toast') {
      await noticeAction.click()
      await expect(noticeAction).toHaveText('Unskip (Enter)')
    }
    const playbackTime = noticeType === 'prompt' ? 16 : 20
    const actionLabel = noticeType === 'prompt' ? 'Skip (Enter)' : 'Unskip (Enter)'
    const badge = page.locator('.paidPromotionBadge')
    const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })

    await badge.click()
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'No', exact: true }).press('Enter')
    await expect(prompt).toBeHidden({ timeout: 3000 })
    expect(await openedUrls()).toEqual([])
    await expect(video).toHaveJSProperty('currentTime', playbackTime)
    await expect(noticeAction).toHaveText(actionLabel)

    await badge.press('Enter')
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Yes, Open Link', exact: true }).press('Enter')
    await expect(prompt).toBeHidden()
    await expect.poll(openedUrls).toEqual([helpUrl])
    await expect(video).toHaveJSProperty('currentTime', playbackTime)
    await expect(video).toHaveJSProperty('paused', true)
    await expect(noticeAction).toHaveText(actionLabel)
  })
}

test('releasing held Space over the paid promotion badge or prompt restores playback speed', async ({ app, page }) => {
  const video = await openPaidPromotionVideo(app, page)
  const badge = page.locator('.paidPromotionBadge')
  const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })

  for (const target of ['badge', 'prompt']) {
    await page.evaluate(() => document.activeElement?.blur())
    await page.keyboard.down('Space')
    try {
      await expect(video).toHaveJSProperty('playbackRate', 2)
      if (target === 'badge') {
        await badge.focus()
      } else {
        await badge.click()
        await expect(prompt).toBeVisible()
        await expect(prompt.getByRole('button', { name: 'Yes, Open Link', exact: true })).toBeFocused()
      }
    } finally {
      await page.keyboard.up('Space')
    }
    await expect(video).toHaveJSProperty('playbackRate', 1)
    await expect(video).toHaveJSProperty('paused', true)
    if (target === 'prompt') {
      await prompt.getByRole('button', { name: 'No', exact: true }).press('Space')
      await expect(prompt).toBeHidden()
    }
  }
})
