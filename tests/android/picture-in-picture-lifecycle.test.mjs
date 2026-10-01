import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

// Run against a current debug APK on an exclusively locked emulator, with its
// WebView socket forwarded to ANDROID_CDP_URL. Exercise the mounted Watch and
// mini-player composable, rather than a standalone copy of the player's CSS.
const enabled = Boolean(process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL?.startsWith('emulator-'))
let browser
let page
let originalSettings
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' })
before(async () => {
  if (!enabled) return
  adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
  const deadline = Date.now() + 15000
  let socket
  while (Date.now() < deadline) {
    const pid = adb('shell', 'pidof', 'org.opentubex.app.dev').trim()
    const name = `webview_devtools_remote_${pid}`
    if (pid && adb('shell', 'cat', '/proc/net/unix').includes(name)) { socket = name; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(socket, 'the app WebView debugger is ready')
  adb('forward', `tcp:${new URL(process.env.ANDROID_CDP_URL).port}`, `localabstract:${socket}`)
  browser = await chromium.connectOverCDP(process.env.ANDROID_CDP_URL, { noDefaults: true })
  page = browser.contexts()[0].pages()[0]
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__ && !document.body.classList.contains('androidPictureInPicture'))
  await page.waitForSelector('#app .app')
  originalSettings = await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__.config.globalProperties
    return { scale: app.$store.getters.getUiScale, auto: app.$store.getters.getAndroidAutoPictureInPicture,
      mini: app.$store.getters.getScrollMiniPlayerEnabled, route: app.$router.currentRoute.value.fullPath }
  })
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/watch/abcdefghijk'))
  await page.waitForSelector('.videoLayout')
  const media = await readFile(new URL('../../e2e/fixtures/media/demo.webm', import.meta.url))
  await page.evaluate(media => {
    const app = document.querySelector('#app').__vue_app__
    const find = vnode => {
      if (!vnode) return null
      if (vnode?.component?.proxy && 'ytDlpStreamsPending' in vnode.component.proxy) return vnode.component.proxy
      const subtree = find(vnode?.component?.subTree)
      if (subtree) return subtree
      for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
        const match = find(child)
        if (match) return match
      }
      return null
    }
    const watch = find(app._container._vnode)
    if (!watch) throw new Error('Watch component is not mounted')
    watch.videoLoadGeneration++
    watch.isLoading = false
    watch.ytDlpStreamsPending = false
    watch.errorMessage = null
    watch.isUpcoming = false
    watch.playabilityStatus = 'OK'
    watch.videoTitle = 'Native PiP regression'
    watch.activeFormat = 'legacy'
    watch.legacyFormats = [{ url: `data:video/webm;base64,${media}`, mimeType: 'video/webm',
      width: 640, height: 360, qualityLabel: '360p', fps: 30, localFile: true, localFileLabel: 'test' }]
    app.config.globalProperties.$store.commit('setScrollMiniPlayerEnabled', true)
  }, media.toString('base64'))
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  if (await skip.isVisible()) await skip.click()
  await page.evaluate(() => { const video = document.querySelector('video'); video.loop = true; video.pause(); video.currentTime = 2 })
})
after(async () => {
  if (browser) {
    adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
    try {
      if (!page.isClosed() && originalSettings) await page.evaluate(async settings => {
        window.__stopPipLifecycleTrace?.()
        const app = document.querySelector('#app').__vue_app__.config.globalProperties
        app.$store.commit('setUiScale', settings.scale)
        app.$store.commit('setAndroidAutoPictureInPicture', settings.auto)
        app.$store.commit('setScrollMiniPlayerEnabled', settings.mini)
        await app.$router.push(settings.route)
      }, originalSettings)
    } finally { await browser.close() }
  }
})

async function assertRecordedEntry(recording, remote, scale, trigger) {
  await recording
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-pip-entry-'))
  const path = join(directory, 'entry.mp4')
  try {
    adb('pull', remote, path)
    if (process.env.ANDROID_ARTIFACT_DIR) {
      await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${trigger}-entry.mp4`, await readFile(path))
    }
    // Native recordings expose intermediate surface buffers that DOM geometry
    // and occasional screenshots miss. The fixture has a solid dark background.
    const width = 270; const height = 480
    const frames = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', path, '-vf',
      `fps=15,scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 32 * 1024 * 1024 })
    let pipFrames = 0
    const clocks = []
    for (let offset = 0; offset < frames.length; offset += width * height * 3) {
      const mask = new Uint8Array(width * height)
      for (let pixel = 0; pixel < mask.length; pixel++) {
        const rgb = offset + pixel * 3
        mask[pixel] = Math.abs(frames[rgb] - 32) < 8 && Math.abs(frames[rgb + 1] - 38) < 8 && Math.abs(frames[rgb + 2] - 48) < 8 ? 1 : 0
      }
      const queue = new Int32Array(mask.length)
      let largest = { count: 0, width: 0, height: 0 }
      for (let pixel = 0; pixel < mask.length; pixel++) {
        if (!mask[pixel]) continue
        let count = 1; let cursor = 0
        let left = width; let right = 0; let top = height; let bottom = 0
        queue[0] = pixel; mask[pixel] = 0
        while (cursor < count) {
          const point = queue[cursor++]
          const x = point % width; const y = Math.floor(point / width)
          left = Math.min(left, x); right = Math.max(right, x)
          top = Math.min(top, y); bottom = Math.max(bottom, y)
          for (const neighbor of [x > 0 ? point - 1 : -1, x + 1 < width ? point + 1 : -1, point - width, point + width]) {
            if (neighbor < 0 || neighbor >= mask.length || !mask[neighbor]) continue
            mask[neighbor] = 0; queue[count++] = neighbor
          }
        }
        if (count > largest.count) largest = { count, left, top, width: right - left + 1, height: bottom - top + 1 }
      }
      if (largest.width > 60 && largest.width < 260) {
        const time = offset / (width * height * 3 * 15)
        assert.ok(largest.width / largest.height < 2.5,
          `native entry clipped the video at ${time.toFixed(3)}s: ${largest.width}x${largest.height}`)
        pipFrames++
        // Read the clock burned into native video pixels. A progressing DOM
        // currentTime also passes when a static transition capture is frozen.
        const x = largest.left + Math.round(largest.width * 0.05)
        const y = largest.top + Math.round(largest.height * 0.34)
        const clockWidth = Math.min(width - x, Math.round(largest.width * 0.95))
        const clockHeight = Math.round(largest.height * 0.34)
        const png = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
          '-s', `${width}x${height}`, '-i', '-', '-vf', `crop=${clockWidth}:${clockHeight}:${x}:${y},scale=iw*6:ih*6`,
          '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
        { input: frames.subarray(offset, offset + width * height * 3), maxBuffer: 1024 * 1024 })
        const text = execFileSync('tesseract', ['stdin', 'stdout', '--psm', '7'],
          { input: png, encoding: 'utf8', env: { ...process.env, OMP_THREAD_LIMIT: '1' }, stdio: ['pipe', 'pipe', 'ignore'] })
        const clock = text.match(/\d{2}:\d{2}:\d{2}[.:]\d{3}/)?.[0]
        if (clock) clocks.push({ time, clock })
      }
    }
    assert.ok(pipFrames > 2, 'the recording captured several native PiP frames')
    assert.ok(clocks.length > 15, 'the native recording contains readable live video clocks')
    let lastClock
    let heldSince
    for (const { time, clock } of clocks) {
      if (clock !== lastClock) { lastClock = clock; heldSince = time }
      // Legacy Android's window animation and software GPU can hold a few
      // recording samples. Catch the reported half-second/static-frame stall.
      assert.ok(time - heldSince <= 0.35, `native PiP froze a video frame for ${(time - heldSince).toFixed(3)}s`)
    }
  } finally {
    adb('shell', 'rm', '-f', remote)
    await rm(directory, { recursive: true, force: true })
  }
}

for (const [scale, trigger] of [[100, 'button'], [125, 'button'], [100, 'home'], [125, 'home']]) {
  test(`native PiP preserves the real inline player at ${scale}% UI scale through ${trigger}`, { skip: !enabled }, async () => {
    await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
    await page.evaluate(async trigger => {
      const video = document.querySelector('video')
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setAndroidAutoPictureInPicture', trigger === 'home')
      video.currentTime = 2
      await video.play()
    }, trigger)
    await page.waitForTimeout(400)
    const start = await page.evaluate(() => {
      const video = document.querySelector('video')
      const player = video.closest('.ftVideoPlayer')
      const frames = []
      let active = false
      let returned = false
      let returning = false
      let frame
      let nativeSize
      const onPip = event => { nativeSize = [event.windowWidth, event.windowHeight]; if (!event.transitioning) { active = event.active; returned ||= !event.active } }
      window.addEventListener('opentubex:android-pip', onPip)
      const track = () => {
        const rect = video.getBoundingClientRect()
        frames.push({ active, returned, returning, entering: document.body.classList.contains('androidPictureInPictureEntering'),
          rect: [rect.x, rect.y, rect.width, rect.height], outer: [outerWidth, outerHeight],
          inner: [innerWidth, innerHeight], visual: [visualViewport.width, visualViewport.scale],
          nativeSize, cssSize: [document.documentElement.style.getPropertyValue('--android-pip-window-width'), document.documentElement.style.getPropertyValue('--android-pip-window-height')],
          container: [player.getBoundingClientRect().width, player.getBoundingClientRect().height],
          body: document.body.className, target: player.hasAttribute('data-android-picture-in-picture-target'), mini: player.classList.contains('scrollMiniPlayer') })
        frame = requestAnimationFrame(track)
      }
      track()
      window.__beginPipReturn = () => { returning = true }
      window.__stopPipLifecycleTrace = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('opentubex:android-pip', onPip)
        return frames
      }
      const rect = video.getBoundingClientRect()
      return { y: rect.y, width: rect.width, outerWidth, rect: [rect.x, rect.y, rect.width, rect.height], inner: [innerWidth, innerHeight] }
    })
    const remote = `/sdcard/opentubex-pip-regression-${scale}-${trigger}.mp4`
    const recorder = spawn('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'screenrecord', '--time-limit', '4', remote], { stdio: 'ignore' })
    const recording = new Promise(resolve => recorder.once('exit', resolve))
    await page.waitForTimeout(300)
    try {
      if (trigger === 'home') adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
      else await page.evaluate(() => document.querySelector('.ftVideoPlayer .shaka-pip-button').click())
      await page.waitForFunction(() => document.body.classList.contains('androidPictureInPicture') && !document.body.classList.contains('androidPictureInPictureEntering'))
      assert.deepEqual(await page.evaluate(() => [document.documentElement, document.body].map(element => {
        const style = getComputedStyle(element)
        return [style.overflowX, style.overflowY]
      })), [['hidden', 'hidden'], ['hidden', 'hidden']], 'PiP hides document overflow on both axes')
      await page.waitForTimeout(400)
      const activity = adb('shell', 'dumpsys', 'activity', 'activities') + adb('shell', 'dumpsys', 'activity', 'top')
      const bounds = activity.match(/mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)[^\n]*mWindowingMode=pinned/) ??
        activity.match(/Stack #4:\s+mFullscreen=false\s+mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)/) ??
        activity.split('ACTIVITY com.android.systemui/.pip.phone.PipMenuActivity')[1]?.match(/appBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)/)
      assert.ok(bounds, 'the native PiP window has screen bounds')
      let [left, top, right, bottom] = bounds.slice(1).map(Number)
      const clocks = []
      // DOM geometry alone misses Chromium's stale video/compositor buffers.
      // Sample native screenshots through the first paints after the mode change.
      for (let sample = 0; sample < 8; sample++) {
        const screenshot = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
        const { visible, clock, videoBounds, diagnostic } = await page.evaluate(async ({ png, nativeWidth, nativeHeight }) => {
          const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = canvas.getContext('2d')
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          // Task bounds can describe an earlier PiP position while Android
          // animates/repositions its surface. Find the fixture in rendered
          // pixels instead, and require its background to fill the window.
          // The native entry animation can still scale its surface by a few percent.
          const { width, height } = canvas
          const rgba = context.getImageData(0, 0, width, height).data
          const mask = new Uint8Array(width * height)
          for (let pixel = 0; pixel < mask.length; pixel++) {
            const offset = pixel * 4
            mask[pixel] = Math.abs(rgba[offset] - 32) < 8 && Math.abs(rgba[offset + 1] - 38) < 8 && Math.abs(rgba[offset + 2] - 48) < 8 ? 1 : 0
          }
          const queue = new Int32Array(mask.length)
          let videoBounds = null
          const candidates = []
          for (let pixel = 0; pixel < mask.length && !videoBounds; pixel++) {
            if (!mask[pixel]) continue
            let count = 1
            let cursor = 0
            queue[0] = pixel
            mask[pixel] = 0
            let left = width; let right = 0; let top = height; let bottom = 0
            while (cursor < count) {
              const point = queue[cursor++]
              const x = point % width; const y = Math.floor(point / width)
              left = Math.min(left, x); right = Math.max(right, x)
              top = Math.min(top, y); bottom = Math.max(bottom, y)
              for (const neighbor of [x > 0 ? point - 1 : -1, x + 1 < width ? point + 1 : -1, point - width, point + width]) {
                if (neighbor < 0 || neighbor >= mask.length || !mask[neighbor]) continue
                mask[neighbor] = 0
                queue[count++] = neighbor
              }
            }
            const w = right - left + 1; const h = bottom - top + 1
            if (count > 10000) candidates.push([left, top, w, h, count])
            if (Math.abs(w - nativeWidth) < Math.max(4, nativeWidth * 0.1) && Math.abs(h - nativeHeight) < Math.max(4, nativeHeight * 0.1) && count > w * h * 0.85) {
              videoBounds = [left, top, right + 1, bottom + 1]
            }
          }
          if (!videoBounds) return { visible: false, videoBounds: null, clock: null, diagnostic: { candidates,
            outer: [outerWidth, outerHeight], inner: [innerWidth, innerHeight], scale: visualViewport.scale,
            rect: document.querySelector('video').getBoundingClientRect().toJSON() } }
          const [left, top, right, bottom] = videoBounds
          // The fixture burns a running clock into the video. Its pixels must
          // keep changing throughout the native transition.
          const pixels = context.getImageData(Math.round(left + (right - left) * 0.55),
            Math.round(top + (bottom - top) * 0.4), Math.round((right - left) * 0.4),
            Math.round((bottom - top) * 0.2)).data
          let clock = 0
          for (const value of pixels) clock = (Math.imul(clock, 31) + value) | 0
          return { visible: true, videoBounds, clock }
        }, { png: screenshot.toString('base64'), nativeWidth: right - left, nativeHeight: bottom - top })
        if (!visible && process.env.ANDROID_ARTIFACT_DIR) {
          await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${trigger}-${sample}.png`, screenshot)
        }
        assert.ok(visible,
          `PiP must keep the video visible across the entire native window without a page/black flash: ${JSON.stringify(diagnostic)}`)
        ;[left, top, right, bottom] = videoBounds
        clocks.push(clock)
      }
      assert.ok(new Set(clocks.slice(-3)).size > 1, 'PiP must keep showing live video')
      await assertRecordedEntry(recording, remote, scale, trigger)
      const api = Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim())
      if (api >= 31 && trigger === 'button') {
        const x = Math.round((left + right) / 2)
        const y = Math.round((top + bottom) / 2)
        adb('shell', `input tap ${x} ${y}; input tap ${x} ${y}`)
        await page.waitForTimeout(400)
      }
      await page.evaluate(() => window.__beginPipReturn())
      if (api >= 31 && trigger === 'home') {
        const x = String(Math.round((left + right) / 2))
        const y = String(Math.round((top + bottom) / 2))
        adb('shell', 'input', 'tap', x, y)
        await page.waitForTimeout(500)
        adb('shell', 'input', 'tap', x, y)
      } else {
        adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
      }
      await page.waitForFunction(() => !document.body.classList.contains('androidPictureInPicture') && !document.body.classList.contains('androidPictureInPictureRestoring'))
      await page.waitForTimeout(500)
      const frames = await page.evaluate(() => window.__stopPipLifecycleTrace())
      assert.ok(frames.some(frame => frame.active), 'the native window actually entered PiP')
      assert.ok(frames.every(frame => !frame.mini), 'native PiP must not activate the scroll mini-player')
      for (const frame of frames.filter(frame => frame.active && !frame.returning)) {
        assert.ok(frame.rect.every((value, axis) => Math.abs(value - start.rect[axis]) <= 1),
          `PiP must preserve the live video element's geometry: ${JSON.stringify(frame)}`)
        assert.deepEqual(frame.inner, start.inner, 'Chromium must keep the original viewport during PiP')
      }
      const returned = frames.filter(frame => frame.returned && !frame.active && frame.outer[0] === start.outerWidth)
      assert.ok(returned.length > 2, 'captured the restored player over several frames')
      assert.ok(returned.every(frame => Math.abs(frame.rect[1] - start.y) < 1 && Math.abs(frame.rect[2] - start.width) < 1),
        'returning must not animate from the mini-player back to the inline player')
    } finally {
      await recording
      if (process.env.ANDROID_ARTIFACT_DIR) {
        await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${trigger}-trace.json`,
          JSON.stringify(await page.evaluate(() => window.__stopPipLifecycleTrace?.())))
      }
      adb('shell', 'rm', '-f', remote)
      adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
      await page.evaluate(() => document.querySelector('video')?.pause())
    }
  })
}
