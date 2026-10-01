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

for (const phase of ['Entering', 'Restoring']) {
  test(`Android PiP ${phase.toLowerCase()} keeps the video at its in-app destination without a second animation`, async () => {
    const handle = await host.evaluateHandle(({ styles, phase }) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;inset:0;width:400px;height:800px;border:0;z-index:2147483647'
      frame.srcdoc = `<style>
        body { margin:0; --android-pip-source-top:60px; --android-pip-source-width:400px; --android-pip-source-height:225px; }
        ${styles}
        video { display:block; height:225px; }
        .shaka-controls-container { position:absolute; }
      </style><body class="${phase === 'Entering' ? 'androidPictureInPicture ' : ''}androidPictureInPicture${phase}">
        <div class="app capacitorTabs capacitorPhoneLayout" data-v-pip-test>
          <div class="routerView" data-v-pip-test>
            <div class="ftVideoPlayer shaka-video-container" data-v-pip-test data-android-picture-in-picture-target style="margin-block-start:0;inline-size:400px;block-size:225px">
              <video class="player" data-v-pip-test></video>
              <div class="shaka-controls-container">Controls</div>
            </div>
            <div class="details"><span style="visibility:visible">Page details</span></div>
          </div>
        </div>
      </body>`
      document.body.append(frame)
      return frame
    }, { styles, phase })
    try {
      const frame = await handle.asElement().contentFrame()
      await frame.locator('video').waitFor()
      await frame.waitForTimeout(300)
      const geometry = await frame.evaluate(() => {
        const video = document.querySelector('video')
        const rect = video.getBoundingClientRect()
        return { y: rect.y, width: rect.width, height: rect.height,
          transitions: getComputedStyle(video).transitionDuration,
          details: getComputedStyle(document.querySelector('.details span')).visibility }
      })
      // WebView can report fractional rectangles even for integral CSS values.
      for (const [axis, expected] of Object.entries({ y: 60, width: 400, height: 225 })) {
        assert.ok(Math.abs(geometry[axis] - expected) < 0.01,
          `Android must preserve the original video bounds: ${JSON.stringify(geometry)}`)
      }
      assert.equal(geometry.transitions, '0s', 'restoring the normal layout must not start another CSS animation')
      assert.equal(geometry.details, phase === 'Entering' ? 'hidden' : 'visible')
    } finally { await handle.evaluate(frame => frame.remove()) }
  })
}

for (const { width, height } of [{ width: 400, height: 225 }, { width: 320.8, height: 180.25 }]) {
  for (const mode of ['inline', 'mini', 'morph', 'zoom', 'shorts']) {
    test(`Android PiP preserves the ${width} × ${height} live video from ${mode}`, async () => {
      const handle = await host.evaluateHandle(({ styles, mode, width, height }) => {
        const frame = document.createElement('iframe')
        frame.style.cssText = 'position:fixed;inset:0;width:480px;height:800px;border:0;z-index:2147483647'
        const mini = mode === 'mini' || mode === 'morph'
        frame.srcdoc = `<style>
          :root { --ui-roundness: 1; --secondary-text-color: #aaa; }
          body { margin:0; --android-pip-source-left:12px; --android-pip-source-top:60px; --android-pip-source-width:${width}px; --android-pip-source-height:${height}px; }
          ${styles}
        </style><body>
          <div class="app capacitorTabs capacitorPhoneLayout" data-v-pip-test>
          <div class="ftVideoPlayer shaka-video-container ${mini ? 'scrollMiniPlayer mobileMiniBar' : ''} ${mode === 'shorts' ? 'shortsPlayer' : ''}"
            data-v-pip-test data-android-picture-in-picture-target ${mode === 'morph' ? 'data-mobile-mini-morph' : ''}
            style="inline-size:${width}px;block-size:${height}px;margin-block-start:60px;margin-inline-start:12px;--mobile-mini-left:12px;--mobile-mini-top:24px;--mobile-mini-width:300px;--mobile-mini-height:75px;
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
        await frame.locator('body').evaluate(body => body.classList.add('androidPictureInPicture'))
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
        assert.ok(Math.abs(geometry.x - 12) < 1 && Math.abs(geometry.y - 60) < 1, JSON.stringify(geometry))
        assert.ok(Math.abs(geometry.width - width) < 1, JSON.stringify(geometry))
        assert.ok(Math.abs(geometry.height - height) < 1, JSON.stringify(geometry))
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
