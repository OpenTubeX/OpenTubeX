import { test, expect, setWindowSize } from '../../helpers/app.mjs'
import { activeTab, openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      backendPreference: 'local',
      backendFallback: true,
      currentLocale: 'de-DE'
    }
  }
})

test('compact share dialog moves focus through its rows and wraps long labels inside the dialog', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await setWindowSize(app, page, { width: 480, height: 760 })
  await page.locator(`${activeTab} .watchVideoInfo .shareButton .iconButton`).visible().click()
  const dialog = page.locator('.prompt .promptCard')
  const actions = dialog.locator('.shareAction')
  await expect(actions.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(actions.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(actions.last()).toBeFocused()

  const overflow = await dialog.evaluate(card => {
    const bounds = card.getBoundingClientRect()
    return [...card.querySelectorAll('.shareAction, .shareAction > span')]
      .filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1
      })
      .map(element => element.textContent)
  })
  expect(overflow).toEqual([])
})
