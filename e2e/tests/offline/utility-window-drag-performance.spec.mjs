import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US', reducedMotion: 'off' } } })

test('moves utility windows without rerendering their controls on every pointer event', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('opentubex-settings-window-bounds', JSON.stringify({ x: 200, y: 100, width: 960, height: 600 })))
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await session.send('Performance.enable')
  for (const view of [null, 'about', 'downloads']) {
    await page.evaluate(view => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow', view), view)
    const dialog = page.locator('.settingsWindow')
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveClass(/settings-window-enter-active/)
    await page.waitForTimeout(300)
    const before = await session.send('Performance.getMetrics')
    const timing = await page.evaluate(async () => {
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
      const header = dialog.querySelector('.settingsWindowHeader')
      const bounds = dialog.getBoundingClientRect()
      const x = bounds.x + 600
      const y = bounds.y + 20
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }))
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
      const moved = dialog.getBoundingClientRect()
      component.u.splice(component.u.indexOf(countUpdate), 1)
      return { updates, elapsedMs: performance.now() - started, worstFrameMs: Math.max(...gaps), slowFrames: gaps.filter(gap => gap > 25).length, dx: moved.x - bounds.x, dy: moved.y - bounds.y }
    })
    const after = await session.send('Performance.getMetrics')
    const metrics = Object.fromEntries(after.metrics.map(({ name, value }) => [name, value - before.metrics.find(metric => metric.name === name).value]))
    console.log(JSON.stringify({ view: view ?? 'settings', ...timing, layouts: metrics.LayoutCount, layoutMs: metrics.LayoutDuration * 1000, styleMs: metrics.RecalcStyleDuration * 1000, taskMs: metrics.TaskDuration * 1000 }))
    expect(timing.updates, 'pointer movement should not rerender the settings controls').toBeLessThan(5)
    // Chromium still updates overflow layout for the full Settings grid. The
    // standalone views can move entirely without repeated layout.
    if (view !== null) expect(metrics.LayoutCount).toBeLessThan(10)
    expect(timing.dx).toBeCloseTo(118, 0)
    expect(timing.dy).toBeCloseTo(59, 0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
})
