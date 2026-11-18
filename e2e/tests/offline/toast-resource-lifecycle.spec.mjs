import { test, expect } from '../../helpers/app.mjs'

for (const dismissal of ['dismissed', 'expired']) {
  test(`${dismissal} notifications release document listeners and toast elements`, { tag: '@performance' }, async ({ page }) => {
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    const session = await page.context().newCDPSession(page)
    const listenerCount = async () => {
      const { result } = await session.send('Runtime.evaluate', {
        expression: '(getEventListeners(document).visibilitychange || []).length',
        includeCommandLineAPI: true,
        returnByValue: true,
      })
      return result.value
    }
    try {
      const baseline = await listenerCount()
      await page.evaluate(() => { window.__dismissedToasts = []; window.__dismissedToastStates = [] })
      for (let index = 0; index < 20; index++) {
        await page.evaluate(({ index, dismissal }) => window.ftElectron.showToastOnAllTabs(`Resource audit ${index}`, dismissal === 'expired' ? 1500 : 30000), { index, dismissal })
        const toast = page.locator('[data-sonner-toast]')
        await expect(toast).toHaveCount(1)
        await toast.evaluate(element => {
          window.__dismissedToasts.push(new WeakRef(element))
          const findState = vnode => {
            if (vnode?.component?.subTree?.el === element && vnode.component.props.toast?.componentProps) {
              return vnode.component.props.toast.componentProps.toast
            }
            if (vnode?.component?.subTree) {
              const state = findState(vnode.component.subTree)
              if (state) return state
            }
            if (Array.isArray(vnode?.children)) {
              for (const child of vnode.children) {
                const state = findState(child)
                if (state) return state
              }
            }
          }
          const root = document.querySelector('#app').__vue_app__._container._vnode
          window.__dismissedToastStates.push(new WeakRef(findState(root)))
        })
        if (dismissal === 'dismissed') {
          await toast.focus()
          await page.keyboard.press('Escape')
        }
        await expect(toast).toHaveCount(0)
      }
      // Sonner's lazy toastsByPosition computed caches the last nonempty group
      // until another notification renders. Earlier notification state must collect.
      await expect.poll(async () => {
        for (let index = 0; index < 3; index++) await session.send('HeapProfiler.collectGarbage')
        const retained = await page.evaluate(() => window.__dismissedToasts.filter(ref => ref.deref()).length)
        const retainedStates = await page.evaluate(() => window.__dismissedToastStates.filter(ref => ref.deref()).length)
        return { retained, statesCollected: retainedStates <= 1, listeners: await listenerCount() }
      }).toEqual({ retained: 0, statesCollected: true, listeners: baseline })
    } finally {
      await session.detach()
    }
  })
}

test.describe('timeout indicator', () => {
  test.use({ seed: { settings: { reducedMotion: 'off' } } })

  test('drains without restyling the page on every frame', { tag: '@performance' }, async ({ page }) => {
    await page.evaluate(() => window.ftElectron.showToastOnAllTabs('Drain audit', 10000))
    const clip = page.locator('.timeout-indicator-clip')
    // Past the hold that waits out the enter transition
    await expect.poll(() => clip.evaluate(element => element.getAnimations()[0]?.currentTime ?? 0)).toBeGreaterThan(500)

    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Performance.enable')
      const styleCount = async () => (await session.send('Performance.getMetrics')).metrics
        .find(({ name }) => name === 'RecalcStyleCount').value
      const before = await styleCount()
      // A measuring window, not a wait: nothing else runs on the main thread
      // meanwhile, so a drain the compositor cannot run would restyle the line
      // on each of the ~30 frames it spans
      await page.waitForTimeout(500)
      expect(await styleCount() - before).toBeLessThanOrEqual(3)
    } finally {
      await session.detach()
    }
  })
})
