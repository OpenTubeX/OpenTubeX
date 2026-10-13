import { test, expect } from '../../helpers/app.mjs'

for (const dismissal of ['dismissed', 'expired']) {
  test(`${dismissal} notifications release document listeners and toast elements`, async ({ page }) => {
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
      await page.waitForTimeout(500)
      for (let index = 0; index < 3; index++) await session.send('HeapProfiler.collectGarbage')
      const retained = await page.evaluate(() => window.__dismissedToasts.filter(ref => ref.deref()).length)
      const retainedStates = await page.evaluate(() => window.__dismissedToastStates.filter(ref => ref.deref()).length)
      const listeners = await listenerCount()
      console.log('Dismissed notification resources:', { dismissal, retained, retainedStates, listeners, baseline })
      expect.soft(listeners).toBe(baseline)
      expect.soft(retained).toBe(0)
      // Sonner's lazy toastsByPosition computed caches the last nonempty group
      // until another notification renders. Earlier notification state must collect.
      expect(retainedStates).toBeLessThanOrEqual(1)
    } finally {
      await session.detach()
    }
  })
}
