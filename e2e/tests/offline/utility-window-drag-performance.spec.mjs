import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US', reducedMotion: 'off' } } })

const gestures = [
  { name: 'moves', handle: '.settingsWindowHeader', start: { x: ['left', 600], y: ['top', 20] } },
  { name: 'resizes', handle: '.resize-se', start: { x: ['right', -4], y: ['bottom', -4] } }
]

for (const gesture of gestures) {
  test(`${gesture.name} utility windows without rerendering their controls on every pointer event`, async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 200, y: 100, width: 800, height: 520 })))
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await session.send('Performance.enable')
    const layoutCount = async () => (await session.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'LayoutCount').value
    for (const view of [null, 'about', 'downloads']) {
      await page.evaluate(view => window.$store.dispatch('showSettingsWindow', view), view)
      const dialog = page.locator('.settingsWindow')
      await expect(dialog).toBeVisible()
      await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
      // Let post-open layout work settle before sampling.
      await expect.poll(async () => {
        const layouts = await layoutCount()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        return await layoutCount() - layouts
      }).toBe(0)
      const before = await session.send('Performance.getMetrics')
      const timing = await page.evaluate(async ({ handleSelector, start }) => {
        const dialog = document.querySelector('.settingsWindow')
        function findWindow(vnode) {
          if (!vnode || typeof vnode !== 'object') return null
          const nested = vnode.component && findWindow(vnode.component.subTree)
          if (nested) return nested
          if (vnode.component?.subTree.el === dialog) return vnode.component
          if (vnode.suspense) return findWindow(vnode.suspense.activeBranch)
          if (Array.isArray(vnode.children)) {
            for (const child of vnode.children) {
              const found = findWindow(child)
              if (found) return found
            }
          }
          return null
        }
        const component = findWindow(document.querySelector('#app')._vnode)
        if (!component) throw new Error('Settings window component not found')
        let updates = 0
        const countUpdate = () => { updates++ }
        component.u ??= []
        component.u.push(countUpdate)
        const bounds = dialog.getBoundingClientRect()
        const x = bounds[start.x[0]] + start.x[1]
        const y = bounds[start.y[0]] + start.y[1]
        dialog.querySelector(handleSelector).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }))
        const gaps = []
        const started = performance.now()
        let previous = await new Promise(resolve => requestAnimationFrame(resolve))
        for (let frame = 0; frame < 60; frame++) {
          window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x + frame * 2, clientY: y + frame }))
          const timestamp = await new Promise(resolve => requestAnimationFrame(resolve))
          gaps.push(timestamp - previous)
          previous = timestamp
        }
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
        await new Promise(resolve => requestAnimationFrame(resolve))
        const after = dialog.getBoundingClientRect()
        component.u.splice(component.u.indexOf(countUpdate), 1)
        return {
          updates,
          elapsedMs: performance.now() - started,
          worstFrameMs: Math.max(...gaps),
          slowFrames: gaps.filter(gap => gap > 25).length,
          dx: after.x - bounds.x,
          dy: after.y - bounds.y,
          dw: after.width - bounds.width,
          dh: after.height - bounds.height
        }
      }, { handleSelector: gesture.handle, start: gesture.start })
      const after = await session.send('Performance.getMetrics')
      const metrics = Object.fromEntries(after.metrics.map(({ name, value }) => [name, value - before.metrics.find(metric => metric.name === name).value]))
      console.log(JSON.stringify({ gesture: gesture.name, view: view ?? 'settings', ...timing, layouts: metrics.LayoutCount, layoutMs: metrics.LayoutDuration * 1000, styleMs: metrics.RecalcStyleDuration * 1000, taskMs: metrics.TaskDuration * 1000 }))
      expect(timing.updates, 'pointer movement should not rerender the settings controls').toBeLessThan(5)
      if (gesture.name === 'moves') {
        // CSS anchors and native selects inside a moving window make Chromium
        // lay out the whole document on every frame.
        expect(metrics.LayoutCount, 'moving the window should not lay out the page').toBeLessThan(10)
        expect(timing.dx).toBeCloseTo(118, 0)
        expect(timing.dy).toBeCloseTo(59, 0)
      } else {
        expect(timing.dw).toBeCloseTo(118, 0)
        expect(timing.dh).toBeCloseTo(59, 0)
      }
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
  })
}
