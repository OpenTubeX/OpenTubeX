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
    return { scale: app.$store.getters.getUiScale, auto: app.$store.getters.getMobileAutoPictureInPicture,
      mini: app.$store.getters.getScrollMiniPlayerEnabled, animation: app.$store.getters.getAnimationSpeed,
      motion: app.$store.getters.getReducedMotion, route: app.$router.currentRoute.value.fullPath }
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
        app.$store.commit('setMobileAutoPictureInPicture', settings.auto)
        app.$store.commit('setScrollMiniPlayerEnabled', settings.mini)
        app.$store.commit('setAnimationSpeed', settings.animation)
        app.$store.commit('setReducedMotion', settings.motion)
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
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' }).trim())
    assert.ok(Number.isFinite(duration) && duration > 0, 'the recording has a valid duration')
    const frameBytes = width * height * 3
    const frames = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', path, '-vf',
      `fps=15,scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: Math.ceil(duration * 15 + 2) * frameBytes })
    let pipFrames = 0
    const clocks = []
    let enteredAt
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
        enteredAt ??= time
        // Geometry stays checked throughout the capture. Read the live clock
        // over the first four seconds of entry, rather than OCRing idle PiP
        // frames recorded while the native screenshot checks finish.
        if (time - enteredAt > 4) continue
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

for (const [scale, trigger, scroll] of [[100, 'button'], [125, 'button'], [100, 'home'], [125, 'home'], [100, 'home', 'offscreen'],
  [100, 'button', 'partial'], [100, 'home', 'partial'], [125, 'home', 'partial']]) {
  const label = scroll ? `${trigger}-${scroll}` : trigger
  test(`native PiP preserves the real inline player at ${scale}% UI scale through ${label}`, { skip: !enabled }, async () => {
    await page.evaluate(scale => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', scale), scale)
    await page.evaluate(async trigger => {
      const video = document.querySelector('video')
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setMobileAutoPictureInPicture', trigger === 'home')
      video.currentTime = 2
      await video.play()
    }, trigger)
    await page.evaluate(scroll => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setScrollMiniPlayerEnabled', !scroll)
      if (scroll) {
        // Stand in for a long description/comments section while retaining
        // the real Watch layout and its scroll viewport.
        const content = document.createElement('div')
        content.id = 'pip-offscreen-content'
        content.style.height = '2000px'
        document.querySelector('.videoLayout').append(content)
        const video = document.querySelector('video').getBoundingClientRect()
        window.scrollTo(0, scroll === 'partial' ? window.scrollY + video.bottom - 40 : 1000)
      }
    }, scroll)
    await page.waitForTimeout(400)
    if (scroll === 'partial') assert.ok(await page.evaluate(() => {
      const rect = document.querySelector('video').getBoundingClientRect()
      return rect.top < 0 && rect.bottom > 0 && rect.bottom <= 41
    }), 'only a narrow strip of the inline video remains inside the viewport')
    else if (scroll) assert.ok(await page.evaluate(() => document.querySelector('video').getBoundingClientRect().bottom <= 0),
      'the real inline video has scrolled entirely above the viewport')
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
    const remote = `/sdcard/opentubex-pip-regression-${scale}-${label}.mp4`
    const recorder = spawn('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'screenrecord', '--time-limit', '180', remote], { stdio: 'ignore' })
    const recording = new Promise(resolve => recorder.once('exit', resolve))
    const stopRecording = async () => {
      if (recorder.exitCode === null) {
        const pids = adb('shell', 'pidof screenrecord || true').trim().split(/\s+/).filter(Boolean)
        if (pids.length) adb('shell', 'kill', '-2', ...pids)
      }
      await recording
    }
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
        if ((!visible || sample === 0) && process.env.ANDROID_ARTIFACT_DIR) {
          await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${label}-${sample}.png`, screenshot)
        }
        assert.ok(visible,
          `PiP must keep the video visible across the entire native window without a page/black flash: ${JSON.stringify(diagnostic)}`)
        ;[left, top, right, bottom] = videoBounds
        clocks.push(clock)
      }
      assert.ok(new Set(clocks.slice(-3)).size > 1, 'PiP must keep showing live video')
      // Keep recording until the native samples confirm entry, rather than
      // letting a wall-clock deadline expire while a busy emulator starts up.
      await stopRecording()
      await assertRecordedEntry(recording, remote, scale, label)
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
        const expected = [...start.rect]
        if (scroll) expected[1] = 0
        assert.ok(frame.rect.every((value, axis) => Math.abs(value - expected[axis]) <= 1),
          `PiP must preserve the live video element's geometry: ${JSON.stringify(frame)}`)
        assert.deepEqual(frame.inner, start.inner, 'Chromium must keep the original viewport during PiP')
      }
      const returned = frames.filter(frame => frame.returned && !frame.active && frame.outer[0] === start.outerWidth)
      assert.ok(returned.length > 2, 'captured the restored player over several frames')
      assert.ok(returned.every(frame => Math.abs(frame.rect[1] - start.y) < 1 && Math.abs(frame.rect[2] - start.width) < 1),
        'returning must not animate from the mini-player back to the inline player')
    } finally {
      await stopRecording()
      if (process.env.ANDROID_ARTIFACT_DIR) {
        await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${label}-trace.json`,
          JSON.stringify(await page.evaluate(() => window.__stopPipLifecycleTrace?.())))
      }
      adb('shell', 'rm', '-f', remote)
      adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
      await page.evaluate(() => {
        document.querySelector('video')?.pause()
        document.querySelector('#pip-offscreen-content')?.remove()
        window.scrollTo(0, 0)
      })
    }
  })
}

for (const scale of [100, 125]) {
  test(`native PiP uses its accepted crop when leaving during the scroll mini-player morph at ${scale}%`, { skip: !enabled }, async () => {
    await page.evaluate(async scale => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.commit('setScrollMiniPlayerEnabled', false)
      store.commit('setUiScale', scale)
      store.commit('setMobileAutoPictureInPicture', true)
      // Widen the race so native entry consistently overlaps the morph.
      store.commit('setAnimationSpeed', 25)
      store.commit('setReducedMotion', 'off')
      window.scrollTo(0, 0)
      const video = document.querySelector('video')
      video.currentTime = 2
      await video.play()
    }, scale)
    await page.waitForFunction(() => !document.querySelector('.ftVideoPlayer').classList.contains('scrollMiniPlayer') &&
      !document.querySelector('[data-mobile-mini-morph]'))
    try {
      await page.evaluate(() => {
        const content = document.createElement('div')
        content.id = 'pip-offscreen-content'
        content.style.height = '2000px'
        document.querySelector('.videoLayout').append(content)
        window.__pipAcceptedLayout = null
        window.__pipCaptureLayout = event => {
          if (event.active && event.transitioning) window.__pipAcceptedLayout = event.layout
        }
        window.addEventListener('opentubex:android-pip', window.__pipCaptureLayout)
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setScrollMiniPlayerEnabled', true)
        window.scrollTo(0, 1000)
      })
      await page.waitForSelector('[data-mobile-mini-morph]')
      adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
      await page.waitForFunction(() => document.body.classList.contains('androidPictureInPicture') &&
        !document.body.classList.contains('androidPictureInPictureEntering'), null, { polling: 100, timeout: 15000 })
      const geometry = await page.evaluate(() => ({
        accepted: window.__pipAcceptedLayout,
        actual: document.querySelector('video').getBoundingClientRect().toJSON(),
      }))
      assert.ok(geometry.accepted, 'native entry returns the layout paired with its crop')
      for (const axis of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(geometry.actual[axis] - geometry.accepted.rect[axis]) < 1,
          `the video must match the accepted crop at ${axis}: ${JSON.stringify(geometry)}`)
      }
      await page.waitForTimeout(600)
      const activity = adb('shell', 'dumpsys', 'activity', 'activities') + adb('shell', 'dumpsys', 'activity', 'top')
      const bounds = activity.match(/mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)[^\n]*mWindowingMode=pinned/) ??
        activity.match(/Stack #4:\s+mFullscreen=false\s+mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)/)
      assert.ok(bounds, 'the native window entered PiP')
      const png = execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
      if (process.env.ANDROID_ARTIFACT_DIR) await writeFile(
        `${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-mini-morph.png`, png)
      const pixels = await page.evaluate(async ({ png, bounds }) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), character => character.charCodeAt(0))], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const [left, top, right, bottom] = bounds
        // Sample the fixture near every edge, excluding rounded corners and its
        // central clock. DOM assertions alone cannot catch a stale native crop.
        return [0.03, 0.15, 0.85, 0.97].flatMap(y => [0.1, 0.5, 0.9].map(x =>
          [...context.getImageData(Math.round(left + (right - left) * x),
            Math.round(top + (bottom - top) * y), 1, 1).data].slice(0, 3)))
      }, { png: png.toString('base64'), bounds: bounds.slice(1).map(Number) })
      assert.ok(pixels.every(rgb => rgb.every((value, index) => Math.abs(value - [32, 38, 48][index]) < 8)),
        `PiP must show video at every edge without clipping or black bands: ${JSON.stringify(pixels)}`)
    } finally {
      adb('shell', 'am', 'start', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
      await page.waitForFunction(() => !document.body.classList.contains('androidPictureInPicture') &&
        !document.body.classList.contains('androidPictureInPictureRestoring'))
      await page.evaluate(() => {
        window.removeEventListener('opentubex:android-pip', window.__pipCaptureLayout)
        delete window.__pipCaptureLayout
        delete window.__pipAcceptedLayout
        document.querySelector('video')?.pause()
        document.querySelector('#pip-offscreen-content')?.remove()
        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setScrollMiniPlayerEnabled', false)
        window.scrollTo(0, 0)
      })
    }
  })
}
