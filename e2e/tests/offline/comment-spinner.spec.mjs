import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({ seed: { settings: { videoPlaybackEngine: 'built-in', ytDlpPlaybackEngineDefaultMigration: true } } })

test('desktop comment pagination spinner is visible without further scrolling', { tag: '@scale' }, async ({ app, page }) => {
  await mockPlayableWatchPage(app, page)
  await openMockedVideo(page)
  await expect(page.locator('.comment').first()).toBeVisible()
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/next*', async route => {
    await pending
    await route.fallback()
  })
  try {
    await page.locator('.commentAutoLoadSentinel').evaluate(element => element.scrollIntoView({ block: 'end', behavior: 'instant' }))
    const spinner = page.getByRole('status', { name: 'Load More Comments' })
    await expect(spinner).toBeAttached()
    await expect(spinner).toBeInViewport({ ratio: 0.9, timeout: 500 })
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
