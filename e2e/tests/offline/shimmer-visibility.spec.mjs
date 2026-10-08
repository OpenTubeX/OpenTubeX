import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: { settings: { fetchSubscriptionsAutomatically: false, reducedMotion: 'no-preference' } }
})

async function addShimmerFixture(page) {
  await page.evaluate(() => {
    const container = document.createElement('div')
    container.id = 'shimmer-visibility-fixture'
    Object.assign(container.style, {
      position: 'fixed',
      inset: '100px auto auto 250px',
      inlineSize: '240px',
      blockSize: '120px',
      overflow: 'clip',
      zIndex: '10000'
    })
    container.innerHTML = '<div id="visible-shimmer" class="ft-shimmer" style="height:40px"></div><div style="height:200px"></div><div id="offscreen-shimmer" class="ft-shimmer" style="height:40px"></div>'
    document.body.append(container)
  })
}

for (const zoom of [1, 1.25]) {
  test(`pauses clipped shimmer and resumes after layout and visibility changes at ${zoom} zoom`, async ({ app, page }) => {
    await app.electronApp.evaluate(({ BrowserWindow }, zoom) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom)
    }, zoom)
    await addShimmerFixture(page)
    const visible = page.locator('#visible-shimmer')
    const offscreen = page.locator('#offscreen-shimmer')
    await expect(visible).toHaveCSS('animation-play-state', 'running')
    await expect(offscreen).toHaveCSS('animation-play-state', 'paused')
    // Crossing an exactly touching edge must resume without another threshold.
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.blockSize = '240px' })
    expect(await offscreen.evaluate(element => new Promise(resolve => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect()
        resolve(entry.isIntersecting && entry.intersectionRatio === 0)
      })
      observer.observe(element)
    }))).toBe(true)
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.blockSize = '241px' })
    await expect(offscreen).toHaveCSS('animation-play-state', 'running')
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.blockSize = '300px' })
    await expect(offscreen).toHaveCSS('animation-play-state', 'running')
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.display = 'none' })
    await expect(offscreen).toHaveCSS('animation-play-state', 'paused')
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.display = '' })
    await expect(offscreen).toHaveCSS('animation-play-state', 'running')
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.style.blockSize = '120px' })
    await expect(offscreen).toHaveCSS('animation-play-state', 'paused')

    await visible.evaluate(element => { element.classList.remove('ft-shimmer') })
    await expect(visible).not.toHaveAttribute('data-shimmer-visible')
    await visible.evaluate(element => { element.classList.add('ft-shimmer') })
    await expect(visible).toHaveCSS('animation-play-state', 'running')
    await visible.evaluate(element => {
      element.remove()
      document.querySelector('#shimmer-visibility-fixture').append(element)
    })
    await expect(visible).toHaveCSS('animation-play-state', 'paused')
    await page.locator('#shimmer-visibility-fixture').evaluate(element => { element.prepend(document.querySelector('#visible-shimmer')) })
    await expect(visible).toHaveCSS('animation-play-state', 'running')
  })
}

test('pauses shimmer when the Electron window is hidden and honors reduced motion', async ({ app, page }) => {
  await addShimmerFixture(page)
  const visible = page.locator('#visible-shimmer')
  await expect(visible).toHaveCSS('animation-play-state', 'running')
  try {
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    await expect(visible).toHaveCSS('animation-play-state', 'paused')
  } finally {
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
  }
  await expect(visible).toHaveCSS('animation-play-state', 'running')
  await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'reduce' })
  await expect(visible).toHaveCSS('animation-name', 'none')
})
