import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from '@playwright/test'
import { compileStyle } from 'vue/compiler-sfc'

let browser
let host
let styles
let layoutSource
before(async () => {
  browser = process.env.ANDROID_CDP_URL
    ? await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  host = process.env.ANDROID_CDP_URL ? browser.contexts()[0].pages()[0] : await browser.newPage()
  const css = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.css', import.meta.url), 'utf8')
  const shakaCss = await readFile(new URL('../../node_modules/shaka-player/dist/controls.css', import.meta.url), 'utf8')
  styles = shakaCss + compileStyle({ source: css, filename: 'player.css', id: 'data-v-controls-test', scoped: true }).code
  const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
  layoutSource = source.slice(source.indexOf('    const controlPanelCompactClasses = ['), source.indexOf('    /** @param {HTMLElement} controlPanel */\n    function scheduleControlPanelLayout'))
})
after(async () => { await browser?.close() })

for (const classic of [false, true]) {
  for (const scale of [1, 1.25]) {
    test(`portrait controls move PiP and captions into settings and restore them when widened (${classic ? 'classic' : 'glass'}, scale ${scale})`, async () => {
      const handle = await host.evaluateHandle(({ styles, classic, scale }) => {
        const frame = document.createElement('iframe')
        frame.style.cssText = 'position:fixed;inset:0;width:360px;height:240px;border:0;z-index:2147483647'
        frame.srcdoc = `<style>
          :root { --ui-roundness:1; --app-font-family:Arial; }
          body { margin:0; }
          ${styles}
        </style><body class="capacitorTabs">
          <div class="ftVideoPlayer shaka-video-container ${classic ? 'classicPlayerControls' : ''}" shaka-controls="true" data-v-controls-test style="width:100%;height:240px;zoom:${scale}">
            <div class="shaka-controls-container" shown="true">
              <div class="shaka-bottom-controls">
                <div class="shaka-controls-button-panel">
                  <div class="ft-time-display-group"><button class="shaka-current-time">1:18:15 / 1:55:22</button></div>
                  <button class="ft-chapters-button"><span class="ft-chapters-icon">▣</span><span class="ft-chapters-current-title">Chapter title</span><span class="ft-chapters-chevron">⌄</span></button>
                  <div class="shaka-spacer"></div>
                  <div class="ft-quick-playback-rate-bar"><button class="ft-quick-playback-rate-button">Normal</button></div>
                  <button class="caption-toggle-button">CC</button>
                  <button class="shaka-pip-button">PiP</button>
                  <button class="shaka-overflow-menu-button">⚙</button>
                  <button class="shaka-fullscreen-button">⛶</button>
                </div>
              </div>
              <div class="shaka-overflow-menu shaka-hidden"><button class="shaka-caption-button">Captions</button><button class="shaka-pip-button">Picture in Picture</button></div>
            </div>
          </div>
        </body>`
        document.body.append(frame)
        return frame
      }, { styles, classic, scale })
      try {
        const frame = await handle.asElement().contentFrame()
        await frame.locator('.shaka-controls-button-panel').waitFor()
        const layout = () => frame.evaluate(layoutSource => {
          const panel = document.querySelector('.shaka-controls-button-panel')
          // Exercise the component's actual layout function in this frame.
          // eslint-disable-next-line no-new-func
          new Function(`${layoutSource}\nupdateControlPanelLayout(arguments[0])`)(panel)
          const visible = selector => getComputedStyle(panel.querySelector(selector)).display !== 'none'
          return {
            pip: visible('.shaka-pip-button'),
            captions: visible('.caption-toggle-button'),
            settings: visible('.shaka-overflow-menu-button'),
            fullscreen: visible('.shaka-fullscreen-button'),
            settingsStartRadius: getComputedStyle(panel.querySelector('.shaka-overflow-menu-button')).borderStartStartRadius,
            spacerWidth: panel.querySelector('.shaka-spacer').getBoundingClientRect().width,
            trailingSpace: panel.getBoundingClientRect().right - panel.querySelector('.shaka-fullscreen-button').getBoundingClientRect().right,
            classes: panel.className,
          }
        }, layoutSource)
        const portrait = await layout()
        assert.equal(portrait.pip, false, JSON.stringify(portrait))
        assert.equal(portrait.captions, false, JSON.stringify(portrait))
        assert.equal(portrait.settings, true)
        assert.equal(portrait.fullscreen, true)
        assert.ok(portrait.spacerWidth < 1, JSON.stringify(portrait))
        if (!classic) assert.notEqual(portrait.settingsStartRadius, '0px', JSON.stringify(portrait))
        await frame.locator('.shaka-overflow-menu').evaluate(menu => menu.classList.remove('shaka-hidden'))
        assert.equal(await frame.locator('.shaka-overflow-menu > .shaka-caption-button').isVisible(), true)
        assert.equal(await frame.locator('.shaka-overflow-menu > .shaka-pip-button').isVisible(), true)
        await frame.locator('.shaka-overflow-menu').evaluate(menu => menu.classList.add('shaka-hidden'))
        await handle.evaluate(frame => { frame.style.width = '1600px' })
        const landscape = await layout()
        assert.equal(landscape.pip, true, JSON.stringify(landscape))
        assert.equal(landscape.captions, true, JSON.stringify(landscape))
        assert.ok(landscape.spacerWidth < 1, JSON.stringify(landscape))
        assert.ok(Math.abs(landscape.trailingSpace) < 1, JSON.stringify(landscape))
        const player = frame.locator('.ftVideoPlayer')
        await player.evaluate(element => element.classList.add('shortsPlayer'))
        const shorts = await frame.locator('.ft-quick-playback-rate-bar').evaluate(element => ({
          bar: element.getBoundingClientRect().width,
          panel: element.parentElement.getBoundingClientRect().width,
          grow: getComputedStyle(element).flexGrow,
        }))
        assert.equal(shorts.grow, '0', JSON.stringify(shorts))
        assert.ok(shorts.bar < shorts.panel / 2, JSON.stringify(shorts))
        await player.evaluate(element => element.classList.remove('shortsPlayer'))
        await handle.evaluate(frame => { frame.style.width = '360px' })
        const restored = await layout()
        assert.equal(restored.pip, false, JSON.stringify(restored))
        assert.equal(restored.captions, false, JSON.stringify(restored))

        const rateBar = frame.locator('.ft-quick-playback-rate-bar')
        await rateBar.evaluate(element => {
          for (const speed of ['0.5×', '1.5×', '2×', '3×']) {
            const button = element.firstElementChild.cloneNode(true)
            button.textContent = speed
            element.append(button)
          }
        })
        await layout()
        const endOffset = await rateBar.evaluate(element => {
          element.scrollLeft = element.scrollWidth
          return element.scrollLeft
        })
        assert.ok(endOffset > 0, 'multiple rates must overflow the portrait bar')
        await handle.evaluate(frame => { frame.style.width = '1600px' })
        await layout()
        const expanded = await rateBar.evaluate(element => ({ offset: element.scrollLeft, content: element.scrollWidth, viewport: element.clientWidth }))
        assert.equal(expanded.offset, 0, JSON.stringify(expanded))
        assert.equal(expanded.content, expanded.viewport, JSON.stringify(expanded))
        await handle.evaluate(frame => { frame.style.width = '360px' })
        await layout()
        const narrowed = await rateBar.evaluate(element => ({ offset: element.scrollLeft, content: element.scrollWidth, viewport: element.clientWidth }))
        assert.equal(narrowed.offset, 0, JSON.stringify(narrowed))
        assert.ok(narrowed.content > narrowed.viewport, JSON.stringify(narrowed))
      } finally { await handle.evaluate(frame => frame.remove()) }
    })
  }
}
