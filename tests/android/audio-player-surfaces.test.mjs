import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from '@playwright/test'
import { compileStyle } from 'vue/compiler-sfc'

let browser
let host
let styles
before(async () => {
  browser = process.env.ANDROID_CDP_URL
    ? await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  host = process.env.ANDROID_CDP_URL ? browser.contexts()[0].pages()[0] : await browser.newPage()
  styles = (await Promise.all(['App.css', 'components/ft-shaka-video-player/ft-shaka-video-player.css'].map(async path => {
    const source = await readFile(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
    return compileStyle({ source, filename: path, id: 'data-v-audio-test', scoped: true }).code
  }))).join('\n')
})
after(async () => { await browser?.close() })

for (const mode of ['minimize drag', 'restore drag', 'mini bar', 'picture-in-picture']) {
  test(`audio artwork remains painted during ${mode}`, async () => {
    const handle = await host.evaluateHandle(({ styles, mode }) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;inset:0;width:400px;height:800px;border:0;z-index:2147483647'
      const mini = mode === 'restore drag' || mode === 'mini bar'
      const morph = mode.endsWith('drag')
      frame.srcdoc = `<style>
        :root { --ui-roundness:1; --card-bg-color:#222; }
        body { margin:0; --android-pip-source-left:0px; --android-pip-source-top:60px; --android-pip-source-width:400px; --android-pip-source-height:225px; }
        ${styles}
      </style><body class="${mode === 'picture-in-picture' ? 'androidPictureInPicture' : ''}">
        <div class="app capacitorTabs capacitorPhoneLayout" data-v-audio-test>
          <div class="ftVideoPlayer shaka-video-container musicAudioPlayer ${mini ? 'scrollMiniPlayer mobileMiniBar' : ''}" data-v-audio-test
            ${morph ? 'data-inline-mini-drag data-mobile-mini-morph' : ''}
            ${mode === 'picture-in-picture' ? 'data-android-picture-in-picture-target' : ''}
            style="width:400px;height:225px;--mobile-mini-left:0px;--mobile-mini-top:160px;--mobile-mini-width:400px;--mobile-mini-height:225px;
              --mobile-mini-video-base-left:0px;--mobile-mini-video-base-top:0px;--mobile-mini-video-base-width:400px;--mobile-mini-video-base-height:225px">
            <video class="player audioOnly" data-v-audio-test></video>
            <div class="musicAudioSurface" data-v-audio-test>
              <div class="musicAudioContent" data-v-audio-test>
                <img class="musicAudioArtwork" data-v-audio-test src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cpath fill='lime' d='M0 0h80v80H0z'/%3E%3C/svg%3E">
              </div>
            </div>
          </div>
        </div>
      </body>`
      document.body.append(frame)
      return frame
    }, { styles, mode })
    try {
      const frame = await handle.asElement().contentFrame()
      await frame.locator('img').waitFor({ state: 'attached' })
      const painted = await frame.locator('img').evaluate(image => {
        const rect = image.getBoundingClientRect()
        const surface = image.closest('.musicAudioSurface')
        const bounds = surface.getBoundingClientRect()
        return {
          display: getComputedStyle(surface).display,
          visibility: getComputedStyle(image).visibility,
          width: rect.width, height: rect.height,
          surface: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          inSurface: rect.x >= bounds.x && rect.y >= bounds.y && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1,
        }
      })
      assert.notEqual(painted.display, 'none', 'audio artwork must not disappear while video is transparent')
      assert.equal(painted.visibility, 'visible', 'native PiP must reveal the audio surface')
      assert.ok(painted.width > 10 && painted.height > 10 && painted.inSurface, JSON.stringify(painted))
      if (mode === 'mini bar') {
        assert.equal(painted.surface.width, 80, 'audio must occupy the thumbnail slot')
        assert.equal(painted.surface.height, 45)
      }
      if (mode === 'picture-in-picture') {
        assert.equal(painted.surface.y, 60, 'audio must occupy the same native PiP source rect as video')
        assert.equal(painted.surface.width, 400)
        assert.equal(painted.surface.height, 225)
      }
    } finally { await handle.evaluate(frame => frame.remove()) }
  })
}
