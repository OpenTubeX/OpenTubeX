import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'

for (const entry of ['overlayscrollbars.mjs', 'overlayscrollbars.esm.js', 'overlayscrollbars.cjs', 'overlayscrollbars.cjs.js']) {
  test(`${entry}: playback updates preserve viewport attributes and image listeners`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Image listener counts require the Chromium DevTools Protocol')
    const library = await readFile(new URL(`../../../node_modules/overlayscrollbars/${entry}`, import.meta.url), 'utf8')
    const css = await readFile(new URL('../../../node_modules/overlayscrollbars/styles/overlayscrollbars.css', import.meta.url), 'utf8')
    const imageSource = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    await page.setContent(`<style>${css}</style><div id="host" style="width:400px;height:200px;overflow:auto"><div id="content" style="height:1000px"><img id="avatar" alt="" style="position:absolute" width="1" height="1" src="${imageSource}"><div class="tabBar" style="position:absolute"><div><img id="ignored-avatar" alt="" width="1" height="1" src="${imageSource}"></div></div><span id="clock" style="display:inline-block;width:80px;height:20px">00:00</span></div></div>`)
    const api = entry.includes('cjs') ? 'exports.OverlayScrollbars' : 'OverlayScrollbars'
    await page.addScriptTag({ type: 'module', content: `const exports = {};\n${library}\nwindow.OverlayScrollbars = ${api}` })
    await page.evaluate(() => {
      const host = document.querySelector('#host')
      window.__ignoredImageRemovals = 0
      window.scrollbar = window.OverlayScrollbars({ target: host, elements: { viewport: host } }, {
        update: {
          ignoreMutation: mutation => {
            const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
            const ignored = element?.closest('.tabBar') != null
            if (ignored && mutation.type === 'childList' && mutation.removedNodes.length > 0) window.__ignoredImageRemovals++
            return ignored
          }
        }
      })
      window.scrollbar.update(true)
    })
    await page.locator('#avatar').evaluate(image => image.decode())
    await expect.poll(() => page.evaluate(() => window.scrollbar.state().overflowAmount.y)).toBe(800)
    const session = await page.context().newCDPSession(page)
    try {
      const imageListeners = async (selector = '#avatar') => {
        const { result } = await session.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` })
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
      // Ignoring tab-bar measurements must still release removed image handlers,
      // including images inside a removed subtree and their replacements.
      expect(await imageListeners('#ignored-avatar')).toBe(1)
      await page.evaluate(async () => {
        window.__ignoredImageReferences = []
        const tabBar = document.querySelector('.tabBar')
        for (let index = 0; index < 10; index++) {
          const oldImage = tabBar.querySelector('img')
          window.__ignoredImageReferences.push(new WeakRef(oldImage))
          tabBar.replaceChildren(oldImage.cloneNode())
          await new Promise(resolve => requestAnimationFrame(resolve))
        }
      })
      await expect.poll(() => page.evaluate(() => window.__ignoredImageRemovals)).toBe(10)
      await expect.poll(async () => {
        await session.send('HeapProfiler.collectGarbage')
        return page.evaluate(() => window.__ignoredImageReferences.filter(reference => reference.deref()).length)
      }).toBe(0)
      expect(await imageListeners('#ignored-avatar')).toBe(1)
      await page.evaluate(() => {
        document.querySelector('#host').scrollTop = 800
        document.querySelector('#content').style.height = '150px'
        window.scrollbar.update(true)
      })
      await expect.poll(() => page.evaluate(() => window.scrollbar.state().overflowAmount.y)).toBe(0)
      await expect.poll(() => page.locator('#host').evaluate(element => element.scrollTop)).toBe(0)
      await expect(page.locator('#host > .os-scrollbar-vertical')).toContainClass('os-scrollbar-unusable')
      await page.evaluate(() => window.scrollbar.destroy())
      expect(await imageListeners()).toBe(0)
      expect(await imageListeners('#ignored-avatar')).toBe(0)
    } finally {
      await session.detach()
    }
  })
}
