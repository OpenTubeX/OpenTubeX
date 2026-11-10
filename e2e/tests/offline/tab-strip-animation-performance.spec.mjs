import { test, expect, sel } from '../../helpers/app.mjs'
import { expectTabStripSettled } from '../../helpers/tabs.mjs'

test.use({ trace: 'off', seed: { settings: { reducedMotion: 'off' } } })

// Properties the compositor animates without laying out or painting the page.
const COMPOSITED_PROPERTIES = new Set(['clipPath', 'filter', 'opacity', 'transform', 'translate'])

test('opens and closes tabs without laying out the window on every frame', async ({ page }) => {
  const create = () => page.evaluate(() => window.ftElectron.tabs.create({
    route: '/history', makeActive: false, lazyLoad: true
  }).then(tab => tab.id))
  await create()
  await create()
  await expect(page.locator(sel.tabs)).toHaveCount(3)
  await expectTabStripSettled(page)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const layoutCount = async () => (await cdp.send('Performance.getMetrics')).metrics
    .find(({ name }) => name === 'LayoutCount').value

  // Collects the properties the strip animates once the change starts.
  const animatedProperties = action => page.evaluate(action => new Promise(resolve => {
    const bar = document.querySelector('.tabBar')
    const observer = new MutationObserver(() => {
      const animations = bar.getAnimations({ subtree: true })
        .filter(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition))
      if (animations.length === 0) return
      observer.disconnect()
      resolve([...new Set(animations.flatMap(animation => animation.effect.getKeyframes()
        .flatMap(frame => Object.keys(frame))
        .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))])
    })
    observer.observe(bar, { childList: true, subtree: true })
    if (action.type === 'create') {
      window.ftElectron.tabs.create({ route: '/history', makeActive: false, lazyLoad: true })
    } else {
      window.ftElectron.tabs.close(window.$store.getters.getTabs.at(1).id)
    }
  }), action)

  for (const type of ['create', 'close']) {
    const before = await layoutCount()
    const properties = await animatedProperties({ type })
    expect(properties.filter(property => !COMPOSITED_PROPERTIES.has(property)), type).toEqual([])
    await expectTabStripSettled(page)
    // The strip lays out when it changes, not on each of the ~30 frames of
    // its animation.
    expect(await layoutCount() - before, type).toBeLessThanOrEqual(8)
  }
})
