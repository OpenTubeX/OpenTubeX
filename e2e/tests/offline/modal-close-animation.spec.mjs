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
  {
    name: 'command palette',
    open: page => page.keyboard.press('Control+k'),
    selector: '.commandPaletteBackdrop',
    animations: ['command-palette-backdrop-leave', 'command-palette-leave'],
  },
]

for (const modal of modals) {
  test(`animates the ${modal.name} out when it closes`, async ({ page }) => {
    await modal.open(page)
    const backdrop = page.locator(modal.selector)
    await expect(backdrop).toBeVisible()

    // Pause the leave animations as they start to inspect the closing modal.
    await backdrop.evaluate(element => {
      new MutationObserver((_, observer) => {
        if (!element.classList.contains('modal-leave-active')) return
        observer.disconnect()
        const animations = element.getAnimations({ subtree: true })
        animations.forEach(animation => animation.pause())
        window.__modalLeave = {
          animations,
          names: animations.filter(animation => animation instanceof CSSAnimation).map(animation => animation.animationName),
        }
      }).observe(element, { attributes: true, attributeFilter: ['class'] })
    })

    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => window.__modalLeave?.names ?? []))
      .toEqual(modal.animations.map(name => expect.stringMatching(new RegExp(`^${name}`))))

    // The closing modal lets input through to the page it uncovers.
    await expect(backdrop).toHaveAttribute('inert')
    await expect(backdrop).toHaveCSS('pointer-events', 'none')

    // Removal waits for the animations, which the animation speed setting can
    // slow down, rather than for their CSS duration.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    await expect(backdrop).toHaveCount(1)

    await page.evaluate(() => window.__modalLeave.animations.forEach(animation => animation.play()))
    await expect(backdrop).toHaveCount(0)
  })
}

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
