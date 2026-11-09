import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { reducedMotion: 'off' } } })

const modals = [
  {
    name: 'prompt',
    open: page => page.evaluate(() => window.$store.dispatch('showAddToPlaylistPromptForManyVideos', {
      videos: [{ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', lengthSeconds: 19 }]
    })),
    selector: '.prompt',
    animations: ['prompt-backdrop-leave', 'prompt-card-leave'],
  },
]

test('removes a prompt right away when Android predictive Back already played its exit', async ({ page }) => {
  await modals[0].open(page)
  const backdrop = page.locator('.prompt')
  await expect(backdrop).toBeVisible()

  // Committing the gesture suppresses CSS leave animations before closing.
  await backdrop.evaluate(element => {
    element.style.setProperty('animation', 'none', 'important')
    window.__modalLeft = false
    new MutationObserver(() => {
      if (element.classList.contains('modal-leave-active')) window.__modalLeft = true
    }).observe(element, { attributes: true, attributeFilter: ['class'] })
  })

  await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0)
  expect(await page.evaluate(() => window.__modalLeft)).toBe(false)
})
