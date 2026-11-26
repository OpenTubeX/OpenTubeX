import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect as baseExpect } from '@playwright/test'
import { androidAppId, blockAppNetwork, connectAndroidApp } from '../helpers/android-webview.mjs'
import { replaceWatchVideo } from '../helpers/android-watch.mjs'

// Run against a current debug APK on an emulator with
// _scripts/androidScriptTests.mjs, or forward its WebView socket and set
// ANDROID_CDP_URL=http://127.0.0.1:<forwarded-port> and ANDROID_SERIAL.
// Needs ffmpeg and ffprobe. Exercises the mounted Watch page and mini-player,
// rather than a standalone copy of the player's CSS.
const enabled = Boolean(process.env.ANDROID_CDP_URL && process.env.ANDROID_SERIAL?.startsWith('emulator-'))
// A busy software-rendered emulator can take longer than Playwright's 5 s
// default to enter or leave picture-in-picture.
const expect = baseExpect.configure({ timeout: 30000 })

// The fixture is a solid color that neither the launcher, the wallpaper, the
// app's themes nor a black frame share, with a white box that crosses a band
// across its middle. The box's position tells how far the video has played,
// in native screenshots and recordings alike.
const FIXTURE = { width: 640, height: 360, fps: 30, rgb: [192, 40, 144] }
const BOX = { top: 150, height: 60, width: 80, speed: 240, travel: 560 }
// The page around the player gets a color that neither the fixture, the
// launcher nor the wallpaper share, so recordings show when Android's entry
// animation crops the page instead of a video-only frame.
const PAGE_RGB = [0, 255, 0]
const PAGE_STYLE = `body:not(.androidPictureInPicture) .app, body:not(.androidPictureInPicture) .app *:not(.ftVideoPlayer, .ftVideoPlayer *) {
  background: rgb(${PAGE_RGB.join(' ')}) !important;
}`

let browser
let page
let session
let originalSettings
// The default PiP window size while a double tap has enlarged it. Android
// reuses the enlarged size for the next entry.
let defaultPictureInPictureSize
const adb = (...args) => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, ...args], { encoding: 'utf8' })
const screencap = () => execFileSync('adb', ['-s', process.env.ANDROID_SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
const launchApp = () => adb('shell', 'am', 'start', '-n', `${androidAppId()}/org.opentubex.app.MainActivity`)

/** Reads the native picture-in-picture window's screen bounds, or null outside it. */
function pictureInPictureBounds() {
  const activity = adb('shell', 'dumpsys', 'activity', 'activities') + adb('shell', 'dumpsys', 'activity', 'top')
  const bounds = activity.match(/mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)[^\n]*mWindowingMode=pinned/) ??
    activity.match(/Stack #4:\s+mFullscreen=false\s+mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)/)
  return bounds ? bounds.slice(1).map(Number) : null
}

/**
 * Leaves picture-in-picture by launching the app. SystemUI ignores a launch
 * while the window still animates into picture-in-picture, so launch again
 * until the app has left it.
 */
async function leavePictureInPicture() {
  await expect(async () => {
    launchApp()
    await baseExpect(page.locator('body')).not.toHaveClass(/androidPictureInPicture(?:\s|$)/, { timeout: 5000 })
  }).toPass({ timeout: 60000 })
}

before(async () => {
  if (!enabled) return
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-pip-fixture-'))
  let media
  try {
    const path = join(directory, 'fixture.webm')
    const color = `0x${FIXTURE.rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`
    execFileSync('ffmpeg', ['-v', 'error',
      '-f', 'lavfi', '-i', `color=c=${color}:s=${FIXTURE.width}x${FIXTURE.height}:r=${FIXTURE.fps}:d=10`,
      '-f', 'lavfi', '-i', `color=c=white:s=${BOX.width}x${BOX.height}:r=${FIXTURE.fps}:d=10`,
      '-filter_complex', `[0][1]overlay=x='mod(t*${BOX.speed},${BOX.travel})':y=${BOX.top}`,
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-threads', '1', path])
    media = (await readFile(path)).toString('base64')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  ;({ browser, page } = await connectAndroidApp())
  session = await browser.contexts()[0].newCDPSession(page)
  await page.waitForFunction(() => !document.body.classList.contains('androidPictureInPicture'))
  originalSettings = await page.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__.config.globalProperties
    return {
      scale: app.$store.getters.getUiScale,
      auto: app.$store.getters.getMobileAutoPictureInPicture,
      animation: app.$store.getters.getAnimationSpeed,
      motion: app.$store.getters.getReducedMotion,
      route: app.$router.currentRoute.value.fullPath
    }
  })
  await blockAppNetwork(page)
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/watch/abcdefghijk'))
  const watch = await replaceWatchVideo(page, {
    videoTitle: 'Native PiP regression',
    activeFormat: 'legacy',
    legacyFormats: [{
      url: `data:video/webm;base64,${media}`,
      mimeType: 'video/webm',
      width: FIXTURE.width,
      height: FIXTURE.height,
      qualityLabel: '360p',
      fps: FIXTURE.fps,
      localFile: true,
      localFileLabel: 'test'
    }]
  })
  await watch.dispose()
  await page.evaluate(style => {
    const element = document.createElement('style')
    element.id = 'pip-lifecycle-page-color'
    element.textContent = style
    document.head.append(element)
  }, PAGE_STYLE)
  await page.evaluate(() => { const video = document.querySelector('video'); video.loop = true; video.pause(); video.currentTime = 2 })
})

after(async () => {
  if (!browser) return
  const available = () => !page.isClosed() && originalSettings
  // Restore the app even when it cannot leave PiP, and still report why.
  let exitError
  try {
    if (available() && await page.evaluate(() => document.body.classList.contains('androidPictureInPicture'))) {
      await leavePictureInPicture()
    }
  } catch (error) {
    exitError = error
  }
  try {
    if (available()) {
      await page.evaluate(async settings => {
        window.__stopPipLifecycleTrace?.()
        window.__androidTestNetwork?.restore()
        document.querySelector('#pip-lifecycle-page-color')?.remove()
        document.querySelector('video')?.pause()
        const app = document.querySelector('#app').__vue_app__.config.globalProperties
        app.$store.commit('setUiScale', settings.scale)
        app.$store.commit('setMobileAutoPictureInPicture', settings.auto)
        app.$store.commit('setAnimationSpeed', settings.animation)
        app.$store.commit('setReducedMotion', settings.motion)
        await app.$router.push(settings.route)
      }, originalSettings)
    }
  } catch (error) {
    throw exitError ? new AggregateError([exitError, error], 'Could not leave PiP or restore the app') : error
  } finally {
    await browser.close()
  }
  if (exitError) throw exitError
})

/**
 * Finds the fixture in a frame's RGB pixels: the largest region of its color,
 * and where the box sits in that region's band, in fixture pixels.
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 */
function locateFixture(pixels, width, height) {
  const [red, green, blue] = FIXTURE.rgb
  const mask = new Uint8Array(width * height)
  for (let pixel = 0; pixel < mask.length; pixel++) {
    const offset = pixel * 3
    mask[pixel] = Number(Math.abs(pixels[offset] - red) < 24 && Math.abs(pixels[offset + 1] - green) < 24 &&
      Math.abs(pixels[offset + 2] - blue) < 24)
  }
  const queue = new Int32Array(mask.length)
  let largest = null
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) continue
    let count = 1
    let cursor = 0
    let left = width; let right = 0; let top = height; let bottom = 0
    queue[0] = pixel
    mask[pixel] = 0
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
    if (!largest || count > largest.count) {
      largest = { count, left, top, width: right - left + 1, height: bottom - top + 1 }
    }
  }
  if (!largest) return null
  // The white box's left edge in the middle row of its band.
  const row = largest.top + Math.round(largest.height * (BOX.top + BOX.height / 2) / FIXTURE.height)
  let box = null
  for (let x = largest.left; x < largest.left + largest.width && box === null; x++) {
    const offset = (row * width + x) * 3
    if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 180) {
      box = (x - largest.left) * FIXTURE.width / largest.width
    }
  }
  return { ...largest, box }
}

/**
 * Counts the pixels of the page color in a frame's RGB pixels.
 * @param {Uint8Array} pixels
 */
function countPagePixels(pixels) {
  let count = 0
  for (let offset = 0; offset < pixels.length; offset += 3) {
    if (PAGE_RGB.every((value, channel) => Math.abs(pixels[offset + channel] - value) < 40)) count++
  }
  return count
}

const pictureInPictureSize = ([left, top, right, bottom]) => ({ width: right - left, height: bottom - top })

/**
 * Double-taps the PiP window, which switches between its default and its
 * enlarged size, and returns its new bounds.
 * @param {boolean} enlarge whether the window must grow or shrink
 * @param {string} message
 */
async function togglePictureInPictureSize(enlarge, message) {
  const before = pictureInPictureBounds()
  const [left, top, right, bottom] = before
  const x = Math.round((left + right) / 2)
  const y = Math.round((top + bottom) / 2)
  adb('shell', `input tap ${x} ${y}; input tap ${x} ${y}`)
  let after
  await expect.poll(() => {
    after = pictureInPictureBounds()
    if (!after) return false
    const change = pictureInPictureSize(after).width - pictureInPictureSize(before).width
    return enlarge ? change > 0 : change < 0
  }, { message }).toBe(true)
  return after
}

/**
 * Decodes a native screenshot to RGB pixels.
 * @param {Buffer} png
 */
function decodeScreenshot(png) {
  // The PNG header's IHDR chunk starts with the width and height.
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { input: png, maxBuffer: width * height * 3 + 1024 })
  return { pixels, width, height }
}

/**
 * Finds when a sequence of box positions held the same video frame longest.
 * @param {{ time: number, box: number }[]} positions
 */
function longestHold(positions) {
  let longest = { seconds: 0, at: 0 }
  let lastBox
  let heldSince
  for (const { time, box } of positions) {
    // The box moves 16 fixture pixels between samples at full speed, and
    // scaling blurs its edge by less.
    if (lastBox === undefined || Math.abs(box - lastBox) > 4) { lastBox = box; heldSince = time }
    if (time - heldSince > longest.seconds) longest = { seconds: time - heldSince, at: heldSince }
  }
  return longest
}

async function assertRecordedEntry(remote, scale, trigger) {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-pip-entry-'))
  const path = join(directory, 'entry.mp4')
  try {
    adb('pull', remote, path)
    if (process.env.ANDROID_ARTIFACT_DIR) {
      await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${trigger}-entry.mp4`, await readFile(path))
    }
    // Native recordings expose intermediate surface buffers that DOM geometry
    // and occasional screenshots miss.
    const width = 270; const height = 480; const fps = 15
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', path], { encoding: 'utf8' }).trim())
    assert.ok(Number.isFinite(duration) && duration > 0, 'the recording has a valid duration')
    const frameBytes = width * height * 3
    const frames = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', path, '-vf',
      `fps=${fps},scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: Math.ceil(duration * fps + 2) * frameBytes })
    let pipFrames = 0
    let pageFrame
    const inline = []
    const entry = []
    let enteredAt
    let entryStarted = false
    for (let offset = 0; offset < frames.length; offset += frameBytes) {
      const frame = frames.subarray(offset, offset + frameBytes)
      const fixture = locateFixture(frame, width, height)
      const time = offset / (frameBytes * fps)
      // Once the window starts shrinking, it must show the video on black,
      // including in frames that crop the video away entirely. Android's
      // entry animation crops the window's frame down to the video, and
      // showed the page around it when automatic entry left it in place,
      // which an enlarged PiP window fills for most of the animation.
      entryStarted ||= !!fixture && fixture.width < 260
      if (entryStarted) {
        const pagePixels = countPagePixels(frame)
        if (pagePixels > 50) pageFrame ??= { time, pagePixels }
      }
      if (!fixture) continue
      // The inline player spans the screen's width; the window shrinks from
      // there into picture-in-picture.
      if (fixture.width >= 260) {
        if (enteredAt === undefined && fixture.box !== null) inline.push({ time, box: fixture.box })
        continue
      }
      if (fixture.width <= 60) continue
      assert.ok(fixture.width / fixture.height < 2.5,
        `native entry clipped the video at ${time.toFixed(3)}s: ${fixture.width}x${fixture.height}`)
      pipFrames++
      enteredAt ??= time
      // Geometry stays checked throughout the capture. Follow the playing
      // video over the first four seconds of entry, rather than idle frames
      // recorded while the native screenshot checks finish. A progressing DOM
      // currentTime also passes when a static transition capture is frozen.
      if (time - enteredAt <= 4 && fixture.box !== null) entry.push({ time, box: fixture.box })
    }
    assert.ok(pipFrames > 2, 'the recording captured several native PiP frames')
    assert.equal(pageFrame, undefined, 'native PiP entry must show only the video, not the page around it')
    assert.ok(inline.length > 15, `the recording shows the inline video's moving box: ${inline.length} frames`)
    assert.ok(entry.length > 15, `the recording shows the PiP video's moving box: ${entry.length} frames`)
    // Legacy Android's window animation and a busy software-rendered emulator
    // hold frames in inline playback too. Catch the reported half-second
    // static-frame stall: a hold during entry that inline playback on the same
    // device did not show.
    const inlineHold = longestHold(inline)
    const entryHold = longestHold(entry)
    assert.ok(entryHold.seconds <= Math.max(0.35, inlineHold.seconds + 0.15),
      `native PiP froze a video frame for ${entryHold.seconds.toFixed(3)}s at ${entryHold.at.toFixed(3)}s, ` +
      `while inline playback held one for at most ${inlineHold.seconds.toFixed(3)}s`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Tells whether the PiP window shows its menu. Android 17 draws the menu
 * without a window of its own, but on every version it dims the video.
 * @param {number[]} bounds the PiP window's screen bounds
 */
function pictureInPictureMenuShown([left, top, right, bottom]) {
  if (/PipMenuView/.test(adb('shell', 'dumpsys', 'window', 'visible'))) return true
  const { pixels, width, height } = decodeScreenshot(screencap())
  const fixture = locateFixture(pixels, width, height)
  return !fixture || fixture.count < (right - left) * (bottom - top) / 2
}

/** Double-taps the enlarged PiP window back to its default size, and returns its bounds. */
async function restorePictureInPictureSize() {
  let bounds = await togglePictureInPictureSize(false, 'a second double tap restores the PiP window size')
  // Android can move the restored window by a pixel.
  await expect.poll(() => (bounds = pictureInPictureBounds()) && pictureInPictureSize(bounds).width,
    { message: 'the PiP window has its default size again' }).toBe(defaultPictureInPictureSize.width)
  defaultPictureInPictureSize = undefined
  return bounds
}

/** Waits until the video's bounds stay the same over two animation frames. */
function waitForStableVideo() {
  return expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const rect = () => JSON.stringify(document.querySelector('video').getBoundingClientRect())
    const before = rect()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect() === before)))
  }))).toBe(true)
}

for (const [scale, trigger, scroll] of [[100, 'button'], [125, 'home'], [100, 'home', 'pinned']]) {
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
    if (scroll) {
      await page.evaluate(() => {
        // Stand in for a long description/comments section while retaining
        // the real Watch layout and its scroll viewport.
        const content = document.createElement('div')
        content.id = 'pip-offscreen-content'
        content.style.height = '2000px'
        document.querySelector('.videoLayout').append(content)
        window.scrollTo(0, 1000)
      })
      await expect.poll(() => page.evaluate(() => window.scrollY > 0 && document.querySelector('video').getBoundingClientRect().top >= 0),
        { message: 'the scrolled page keeps the inline video pinned in view' }).toBe(true)
    }
    await waitForStableVideo()
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
        frames.push({
          active,
          returned,
          returning,
          entering: document.body.classList.contains('androidPictureInPictureEntering'),
          rect: [rect.x, rect.y, rect.width, rect.height],
          outer: [outerWidth, outerHeight],
          inner: [innerWidth, innerHeight],
          visual: [visualViewport.width, visualViewport.scale],
          nativeSize,
          cssSize: [document.documentElement.style.getPropertyValue('--android-pip-window-width'), document.documentElement.style.getPropertyValue('--android-pip-window-height')],
          container: [player.getBoundingClientRect().width, player.getBoundingClientRect().height],
          body: document.body.className,
          target: player.hasAttribute('data-android-picture-in-picture-target'),
          mini: player.classList.contains('scrollMiniPlayer')
        })
        frame = requestAnimationFrame(track)
      }
      track()
      window.__pipLifecycleFrames = frames
      window.__beginPipReturn = () => { returning = true }
      window.__stopPipLifecycleTrace = () => {
        cancelAnimationFrame(frame)
        window.removeEventListener('opentubex:android-pip', onPip)
        delete window.__pipLifecycleFrames
        delete window.__stopPipLifecycleTrace
        return frames
      }
      const rect = video.getBoundingClientRect()
      return { y: rect.y, width: rect.width, outerWidth, rect: [rect.x, rect.y, rect.width, rect.height], inner: [innerWidth, innerHeight] }
    })
    const remote = `/sdcard/opentubex-pip-regression-${scale}-${label}.mp4`
    adb('shell', 'rm', '-f', remote)
    const recorder = spawn('adb', ['-s', process.env.ANDROID_SERIAL, 'shell', 'screenrecord', '--time-limit', '180', remote], { stdio: 'ignore' })
    const recording = new Promise(resolve => recorder.once('exit', resolve))
    const stopRecording = async () => {
      if (recorder.exitCode === null) {
        const pids = adb('shell', 'pidof screenrecord || true').trim().split(/\s+/).filter(Boolean)
        if (pids.length) adb('shell', 'kill', '-2', ...pids)
      }
      await recording
    }
    let trace
    try {
      // screenrecord creates its file once it captures.
      await expect.poll(() => adb('shell', `test -e ${remote} && echo recording || true`).trim(),
        { message: 'screenrecord starts' }).toBe('recording')
      // Record inline playback first, which shows how smoothly this device
      // plays the video.
      const inlineFrames = FIXTURE.fps * 1.5 + 1
      await page.evaluate(required => {
        const video = document.querySelector('video')
        let callback
        window.__pipInlineFrames = 0
        const count = () => {
          callback = ++window.__pipInlineFrames < required ? video.requestVideoFrameCallback(count) : undefined
        }
        callback = video.requestVideoFrameCallback(count)
        window.__stopPipInlineFrames = () => { if (callback !== undefined) video.cancelVideoFrameCallback(callback) }
      }, inlineFrames)
      await page.waitForFunction(required => window.__pipInlineFrames >= required, inlineFrames, { timeout: 30000 })
      if (trigger === 'home') adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
      else await page.evaluate(() => document.querySelector('.ftVideoPlayer .shaka-pip-button').click())
      await page.waitForFunction(() => document.body.classList.contains('androidPictureInPicture') && !document.body.classList.contains('androidPictureInPictureEntering'),
        null, { polling: 100, timeout: 30000 })
      assert.deepEqual(await page.evaluate(() => [document.documentElement, document.body].map(element => {
        const style = getComputedStyle(element)
        return [style.overflowX, style.overflowY]
      })), [['hidden', 'hidden'], ['hidden', 'hidden']], 'PiP hides document overflow on both axes')
      let bounds
      await expect.poll(() => (bounds = pictureInPictureBounds()), { message: 'the native PiP window has screen bounds' }).not.toBeNull()
      if (defaultPictureInPictureSize) {
        assert.ok(pictureInPictureSize(bounds).width > defaultPictureInPictureSize.width,
          `the entry reuses the enlarged PiP window: ${JSON.stringify(bounds)}`)
      }
      let [left, top, right, bottom] = bounds
      const boxes = []
      // DOM geometry alone misses Chromium's stale video/compositor buffers.
      // Sample native screenshots through the first paints after the mode change.
      for (let sample = 0; sample < 8; sample++) {
        const screenshot = screencap()
        // Task bounds can describe an earlier PiP position while Android
        // animates/repositions its surface. Find the fixture in rendered
        // pixels instead, and require its color to fill the window. The
        // native entry animation can still scale its surface by a few percent.
        const { pixels, width, height } = decodeScreenshot(screenshot)
        const fixture = locateFixture(pixels, width, height)
        const nativeWidth = right - left
        const nativeHeight = bottom - top
        const visible = !!fixture && Math.abs(fixture.width - nativeWidth) < Math.max(4, nativeWidth * 0.1) &&
          Math.abs(fixture.height - nativeHeight) < Math.max(4, nativeHeight * 0.1) &&
          fixture.count > fixture.width * fixture.height * 0.85
        if ((!visible || sample === 0) && process.env.ANDROID_ARTIFACT_DIR) {
          await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${label}-${sample}.png`, screenshot)
        }
        assert.ok(visible,
          `PiP must keep the video visible across the entire native window without a page/black flash: ${JSON.stringify({ fixture, bounds: [left, top, right, bottom] })}`)
        ;[left, top, right, bottom] = [fixture.left, fixture.top, fixture.left + fixture.width, fixture.top + fixture.height]
        boxes.push(fixture.box)
      }
      assert.ok(new Set(boxes.slice(-3)).size > 1, `PiP must keep showing live video: ${JSON.stringify(boxes)}`)
      // Keep recording until the native samples confirm entry, rather than
      // letting a wall-clock deadline expire while a busy emulator starts up.
      await stopRecording()
      await assertRecordedEntry(remote, scale, label)
      const api = Number(adb('shell', 'getprop', 'ro.build.version.sdk').trim())
      if (api >= 31 && trigger === 'button') {
        // A double tap enlarges the window, which must keep the video's
        // geometry too. The next test's automatic entry reuses that size.
        const size = pictureInPictureSize(pictureInPictureBounds())
        await togglePictureInPictureSize(true, 'a double tap enlarges the PiP window')
        defaultPictureInPictureSize = size
      } else if (defaultPictureInPictureSize) {
        // Android would keep the enlarged size for the tests that follow.
        ;[left, top, right, bottom] = await restorePictureInPictureSize()
      }
      await page.evaluate(() => window.__beginPipReturn())
      if (api >= 31 && trigger === 'home') {
        // A tap shows the window's menu, and a tap on its middle expands it.
        const x = String(Math.round((left + right) / 2))
        const y = String(Math.round((top + bottom) / 2))
        await expect(async () => {
          adb('shell', 'input', 'tap', x, y)
          await baseExpect.poll(() => pictureInPictureMenuShown([left, top, right, bottom]), { timeout: 5000 }).toBe(true)
          adb('shell', 'input', 'tap', x, y)
          await baseExpect(page.locator('body')).not.toHaveClass(/androidPictureInPicture(?:\s|$)/, { timeout: 5000 })
        }).toPass({ timeout: 60000 })
      } else {
        await leavePictureInPicture()
      }
      await page.waitForFunction(() => !document.body.classList.contains('androidPictureInPicture') && !document.body.classList.contains('androidPictureInPictureRestoring'))
      await page.waitForFunction(outerWidth => window.__pipLifecycleFrames
        .filter(frame => frame.returned && !frame.active && frame.outer[0] === outerWidth).length > 2, start.outerWidth)
      const frames = trace = await page.evaluate(() => window.__stopPipLifecycleTrace())
      assert.ok(frames.some(frame => frame.active), 'the native window actually entered PiP')
      assert.ok(frames.every(frame => !frame.mini), 'native PiP must not activate the scroll mini-player')
      for (const frame of frames.filter(frame => frame.active && !frame.returning)) {
        const expected = [...start.rect]
        assert.ok(frame.rect.every((value, axis) => Math.abs(value - expected[axis]) <= 1),
          `PiP must preserve the live video element's geometry: ${JSON.stringify(frame)}`)
        assert.deepEqual(frame.inner, start.inner, 'Chromium must keep the original viewport during PiP')
      }
      const returned = frames.filter(frame => frame.returned && !frame.active && frame.outer[0] === start.outerWidth)
      assert.ok(returned.every(frame => Math.abs(frame.rect[1] - start.y) < 1 && Math.abs(frame.rect[2] - start.width) < 1),
        'returning must not animate from the mini-player back to the inline player')
    } finally {
      await stopRecording()
      adb('shell', 'rm', '-f', remote)
      if (defaultPictureInPictureSize && trigger === 'home' && pictureInPictureBounds()) {
        await restorePictureInPictureSize().catch(error => console.warn('Could not restore the PiP window size', error))
      }
      if (await page.evaluate(() => document.body.classList.contains('androidPictureInPicture'))) await leavePictureInPicture()
      trace ??= await page.evaluate(() => window.__stopPipLifecycleTrace?.())
      if (process.env.ANDROID_ARTIFACT_DIR) {
        await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-${label}-trace.json`, JSON.stringify(trace))
      }
      await page.evaluate(() => {
        window.__stopPipInlineFrames?.()
        delete window.__stopPipInlineFrames
        delete window.__pipInlineFrames
        document.querySelector('video')?.pause()
        document.querySelector('#pip-offscreen-content')?.remove()
        window.scrollTo(0, 0)
      })
    }
  })
}

for (const scale of [100, 125]) {
  test(`native PiP uses its accepted crop when leaving during the mini-player morph at ${scale}%`, { skip: !enabled }, async () => {
    await page.evaluate(async scale => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
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
    let png
    let pixels
    try {
      await page.evaluate(() => {
        window.__pipAcceptedLayout = null
        window.__pipCaptureLayout = event => {
          if (event.active && event.transitioning) window.__pipAcceptedLayout = event.layout
        }
        window.addEventListener('opentubex:android-pip', window.__pipCaptureLayout)
      })
      // Portrait phones pin the player while scrolling, and dock it without
      // a morph after navigation, so swipe it into the mini-player.
      const box = await page.locator('.ftVideoPlayer').boundingBox()
      const down = { x: box.x + 12, y: box.y + 12 }
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [down] })
      for (const distance of [30, 80, 140]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...down, y: down.y + distance }] })
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      // The released player keeps morphing into the mini-player.
      await page.waitForSelector('.ftVideoPlayer[data-mobile-mini-morph]')
      adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
      await page.waitForFunction(() => document.body.classList.contains('androidPictureInPicture') &&
        !document.body.classList.contains('androidPictureInPictureEntering'), null, { polling: 100, timeout: 30000 })
      const geometry = await page.evaluate(() => ({
        accepted: window.__pipAcceptedLayout,
        actual: document.querySelector('video').getBoundingClientRect().toJSON(),
      }))
      assert.ok(geometry.accepted, 'native entry returns the layout paired with its crop')
      for (const axis of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(geometry.actual[axis] - geometry.accepted.rect[axis]) < 1,
          `the video must match the accepted crop at ${axis}: ${JSON.stringify(geometry)}`)
      }
      // Sample the fixture near every edge, excluding rounded corners and its
      // band. DOM assertions alone cannot catch a stale native crop, which
      // stays; wait for Android to finish placing the window.
      await expect.poll(async () => {
        const bounds = pictureInPictureBounds()
        if (!bounds) return null
        png = screencap()
        const screen = decodeScreenshot(png)
        const [left, top, right, bottom] = bounds
        const points = [0.03, 0.15, 0.85, 0.97].flatMap(y => [0.1, 0.5, 0.9].map(x =>
          [Math.round(left + (right - left) * x), Math.round(top + (bottom - top) * y)]))
        // Bounds from a window that Android is still moving can lie outside
        // the screenshot. Retry with fresh ones.
        if (points.some(([x, y]) => x < 0 || y < 0 || x >= screen.width || y >= screen.height)) {
          pixels = { outside: points, screen: [screen.width, screen.height] }
          return false
        }
        pixels = points.map(([x, y]) => {
          const offset = (y * screen.width + x) * 3
          return [...screen.pixels.subarray(offset, offset + 3)]
        })
        return pixels.every(rgb => rgb.every((value, index) => Math.abs(value - FIXTURE.rgb[index]) < 24))
      }, { message: 'PiP must show video at every edge without clipping or black bands' }).toBe(true)
      if (process.env.ANDROID_ARTIFACT_DIR) {
        await writeFile(`${process.env.ANDROID_ARTIFACT_DIR}/${process.env.ANDROID_SERIAL}-${scale}-mini-morph.png`, png)
      }
    } catch (error) {
      if (pixels) error.message += `\n${JSON.stringify(pixels)}`
      throw error
    } finally {
      await leavePictureInPicture()
      await page.waitForFunction(() => !document.body.classList.contains('androidPictureInPictureRestoring'))
      await page.evaluate(() => {
        window.removeEventListener('opentubex:android-pip', window.__pipCaptureLayout)
        delete window.__pipCaptureLayout
        delete window.__pipAcceptedLayout
        document.querySelector('video')?.pause()
        document.querySelector('.mobileMiniBarReturn')?.click()
      })
      await page.waitForSelector('.videoLayout')
      await page.waitForFunction(() => !document.querySelector('.ftVideoPlayer').classList.contains('scrollMiniPlayer') &&
        !document.querySelector('[data-mobile-mini-morph]'))
    }
  })
}
