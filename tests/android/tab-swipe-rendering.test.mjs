import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from '@playwright/test'

// For Android, acquire the lab device lock and forward its WebView debug socket,
// then set ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port> when running this test.
let browser
let context
let host
before(async () => {
  browser = process.env.ANDROID_CDP_URL
    ? await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  context = process.env.ANDROID_CDP_URL
    ? browser.contexts()[0]
    : await browser.newContext({ viewport: { width: 400, height: 700 } })
  host = process.env.ANDROID_CDP_URL ? context.pages()[0] : await context.newPage()
})
after(async () => { await browser?.close() })

for (const scale of [1, 1.25]) {
  test(`prewarmed tabs do not bleed through a shorter presented page at scale ${scale}`, async () => {
    const component = await readFile(new URL('../../src/renderer/components/TabContent/TabContent.vue', import.meta.url), 'utf8')
    const styles = component.match(/<style scoped>([\s\S]*?)<\/style>/)[1]
    // Use the shipped tab styles in an isolated frame, including a fixed child
    // like the player. A short active page must not expose its loaded neighbor.
    const frameElement = await host.evaluateHandle(({ styles, scale }) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;inset:0;width:320px;height:500px;z-index:2147483647;border:0'
      frame.srcdoc = `<style>
        :root { --bg-color: black; }
        body { margin:0; background:black; zoom:${scale}; }
        main { position:relative; min-height:500px; }
        ${styles}
        article { background:#222; color:white; height:160.25px; }
        .neighbor { height:450px; background:magenta; }
        .fixed { position:fixed; bottom:0; height:40px; width:100%; background:cyan; }
      </style><main>
        <div class="tabContent pageSwipePrewarm" inert aria-hidden="true"><div class="neighbor">Background page<div class="fixed">Player controls</div></div></div>
        <div class="tabContent pageSwipePresented"><article>Subscriptions</article></div>
      </main>`
      document.body.append(frame)
      return frame
    }, { styles, scale })
    const element = frameElement.asElement()
    try {
      const frame = await element.contentFrame()
      await frame.locator('article').waitFor()
      assert.equal(await frame.locator('body').evaluate(node => Number(getComputedStyle(node).zoom)), scale)
      const neighbor = frame.locator('.pageSwipePrewarm')
      const bounds = await neighbor.boundingBox()
      assert.ok(bounds.height > 0, 'Prewarming retains layout for the swipe')
      const actual = await element.screenshot()
      await neighbor.evaluate(node => { node.style.display = 'none' })
      const expected = await element.screenshot()
      assert.ok(actual.equals(expected), 'Inactive neighboring page must contribute no visible pixels')

      await neighbor.evaluate(node => {
        node.style.display = ''
        node.classList.replace('pageSwipePrewarm', 'pageSwipeTo')
        node.style.left = '160px'
      })
      await frame.locator('.pageSwipePresented').evaluate(node => {
        node.classList.add('pageSwipeFrom')
        node.style.left = '-160px'
      })
      const swiping = await element.screenshot()
      const target = frame.locator('.pageSwipeTo')
      await target.evaluate(node => { node.style.display = 'none' })
      const withoutTarget = await element.screenshot()
      assert.ok(!swiping.equals(withoutTarget), 'The neighboring page paints when the swipe starts')

      await target.evaluate(node => {
        node.style.display = ''
        node.style.left = ''
        node.classList.replace('pageSwipeTo', 'pageSwipePrewarm')
      })
      await frame.locator('.pageSwipePresented').evaluate(node => {
        node.classList.remove('pageSwipeFrom')
        node.style.left = ''
      })
      assert.ok((await element.screenshot()).equals(expected), 'Cancelling the swipe hides the neighbor again')
    } finally { await element.evaluate(node => node.remove()) }
  })
}
