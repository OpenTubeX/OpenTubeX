import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from '@playwright/test'
import { compileStyle } from 'vue/compiler-sfc'

// Set ANDROID_CDP_URL to a locked emulator's forwarded WebView debug socket
// to run these same layout regressions in Android WebView.
let browser
let host
let styles
before(async () => {
  browser = process.env.ANDROID_CDP_URL
    ? await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  host = process.env.ANDROID_CDP_URL
    ? browser.contexts()[0].pages()[0]
    : await browser.newPage()
  const paths = ['App.css', 'components/ft-shaka-video-player/ft-shaka-video-player.css']
  styles = (await Promise.all(paths.map(async path => {
    const source = await readFile(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
    return compileStyle({ source, filename: path, id: 'data-v-pip-test', scoped: true }).code
  }))).join('\n')
})
after(async () => { await browser?.close() })

for (const { width, height } of [{ width: 400, height: 225 }, { width: 320.8, height: 180.25 }]) {
  for (const mode of ['inline', 'mini', 'morph', 'zoom', 'shorts']) {
    test(`Android PiP fills the ${width} × ${height} viewport from ${mode}`, async () => {
      const handle = await host.evaluateHandle(({ styles, mode, width, height }) => {
        const frame = document.createElement('iframe')
        frame.style.cssText = `position:fixed;inset:0;width:${width}px;height:${height}px;border:0;z-index:2147483647`
        const mini = mode === 'mini' || mode === 'morph'
        frame.srcdoc = `<style>
          :root { --ui-roundness: 1; --secondary-text-color: #aaa; }
          body { margin:0; }
          ${styles}
        </style><body class="androidPictureInPicture">
          <div class="app capacitorTabs capacitorPhoneLayout" data-v-pip-test>
          <div class="ftVideoPlayer shaka-video-container ${mini ? 'scrollMiniPlayer mobileMiniBar' : ''} ${mode === 'shorts' ? 'shortsPlayer' : ''}"
            data-v-pip-test data-android-picture-in-picture-target ${mode === 'morph' ? 'data-mobile-mini-morph' : ''}
            style="--mobile-mini-left:12px;--mobile-mini-top:24px;--mobile-mini-width:300px;--mobile-mini-height:75px;
            --mobile-mini-video-base-left:8px;--mobile-mini-video-base-top:6px;
            --mobile-mini-video-base-width:112px;--mobile-mini-video-base-height:63px;
            --mobile-mini-video-clip:inset(0 20px 0 0)">
            <video class="player" data-v-pip-test ${mode === 'zoom' ? 'style="transform:translate(10px, 20px) scale(2)"' : ''}></video>
            <div class="shaka-controls-container">Controls</div>
          </div>
          </div>
        </body>`
        document.body.append(frame)
        return frame
      }, { styles, mode, width, height })
      const element = handle.asElement()
      try {
        const frame = await element.contentFrame()
        await frame.locator('video').waitFor()
        const geometry = await frame.evaluate(() => {
          const video = document.querySelector('video')
          const rect = video.getBoundingClientRect()
          const style = getComputedStyle(video)
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            clip: style.clipPath,
            fit: style.objectFit,
            controls: getComputedStyle(document.querySelector('.shaka-controls-container')).display,
          }
        })
        assert.ok(Math.abs(geometry.x) < 1 && Math.abs(geometry.y) < 1, JSON.stringify(geometry))
        assert.ok(Math.abs(geometry.width - geometry.viewportWidth) < 1, JSON.stringify(geometry))
        assert.ok(Math.abs(geometry.height - geometry.viewportHeight) < 1, JSON.stringify(geometry))
        assert.equal(geometry.clip, 'none')
        assert.equal(geometry.fit, 'contain')
        assert.equal(geometry.controls, 'none')
        await frame.locator('body').evaluate(body => body.classList.remove('androidPictureInPicture'))
        if (mode === 'mini') {
          assert.equal(await frame.locator('video').evaluate(video => getComputedStyle(video).width), '112px')
        }
      } finally { await handle.evaluate(frame => frame.remove()) }
    })
  }
}
