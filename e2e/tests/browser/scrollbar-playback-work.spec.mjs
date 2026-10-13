import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

for (const entry of ['overlayscrollbars.mjs', 'overlayscrollbars.esm.js', 'overlayscrollbars.cjs', 'overlayscrollbars.cjs.js']) {
  test(`${entry}: playback updates preserve viewport attributes and image listeners`, async ({ page }) => {
    const library = await readFile(new URL(`../../../node_modules/overlayscrollbars/${entry}`, import.meta.url), 'utf8')
    const css = await readFile(new URL('../../../node_modules/overlayscrollbars/styles/overlayscrollbars.css', import.meta.url), 'utf8')
    await page.setContent(`<style>${css}</style><div id="host" style="width:400px;height:200px;overflow:auto"><div id="content" style="height:1000px"><img id="avatar" alt="" style="position:absolute" width="1" height="1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><span id="clock" style="display:inline-block;width:80px;height:20px">00:00</span></div></div>`)
    const api = entry.includes('cjs') ? 'exports.OverlayScrollbars' : 'OverlayScrollbars'
    await page.addScriptTag({ type: 'module', content: `const exports = {};\n${library}\nwindow.OverlayScrollbars = ${api}` })
    await page.evaluate(() => {
      const host = document.querySelector('#host')
      window.scrollbar = window.OverlayScrollbars({ target: host, elements: { viewport: host } }, {})
      window.scrollbar.update(true)
    })
    await page.locator('#avatar').evaluate(image => image.decode())
    await expect.poll(() => page.evaluate(() => window.scrollbar.state().overflowAmount.y)).toBe(800)
    const session = await page.context().newCDPSession(page)
    const imageListeners = async () => {
      const { result } = await session.send('Runtime.evaluate', { expression: 'document.querySelector("#avatar")' })
      const { listeners } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
      await session.send('Runtime.releaseObject', { objectId: result.objectId })
      return listeners.filter(listener => listener.type === 'load').length
    }
    const initialListeners = await imageListeners()
    expect(initialListeners).toBe(1)
    for (const force of [false, true]) {
      const result = await page.evaluate(async force => {
        const host = document.querySelector('#host')
        let viewportMutations = 0
        const observer = new MutationObserver(mutations => { viewportMutations += mutations.length })
        observer.observe(host, { attributes: true, attributeOldValue: true, attributeFilter: ['data-overlayscrollbars-viewport'] })
        for (let frame = 0; frame < 30; frame++) {
          document.querySelector('#clock').textContent = `00:${String(frame).padStart(2, '0')}`
          if (force) window.scrollbar.update(true)
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        viewportMutations += observer.takeRecords().length
        observer.disconnect()
        return { viewportMutations, overflow: window.scrollbar.state().overflowAmount }
      }, force)
      expect(result.overflow.y).toBe(800)
      expect(result.viewportMutations).toBe(0)
    }
    const finalListeners = await imageListeners()
    expect(finalListeners).toBe(initialListeners)
    await page.evaluate(async () => {
      const content = document.querySelector('#content')
      const image = document.querySelector('#avatar')
      for (let index = 0; index < 10; index++) {
        content.append(image)
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    })
    expect(await imageListeners()).toBe(initialListeners)
    await page.evaluate(() => {
      document.querySelector('#host').scrollTop = 800
      document.querySelector('#content').style.height = '150px'
      window.scrollbar.update(true)
    })
    await expect.poll(() => page.evaluate(() => window.scrollbar.state().overflowAmount.y)).toBe(0)
    await expect.poll(() => page.locator('#host').evaluate(element => element.scrollTop)).toBe(0)
    await expect(page.locator('#host > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
    await page.evaluate(() => window.scrollbar.destroy())
    expect(await imageListeners()).toBe(0)
    await session.detach()
  })
}
