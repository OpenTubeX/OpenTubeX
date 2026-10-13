import { test, expect } from '../../helpers/app.mjs'
import { sampleColors } from '../../helpers/colors.mjs'
import { DEMO_MEDIA_DURATION_SECONDS } from '../../helpers/media.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

test.use({
  seed: {
    settings: {
      videoPlaybackEngine: 'built-in',
      ytDlpPlaybackEngineDefaultMigration: true,
      useSponsorBlock: true,
      sponsorBlockSelfPromo: { color: 'Yellow', skip: 'showInSeekBar' },
      sponsorBlockHighlight: { color: '#26a69a', skip: 'showInSeekBar' },
      baseTheme: 'system',
      systemDarkTheme: 'dark',
      systemLightTheme: 'light',
      mainColor: 'Red',
      secColor: 'Blue'
    }
  }
})

async function prepareMarkers(app, page) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([{
      videoID: 'jNQXAC9IVRw',
      segments: [
        ...[[2, 5], [8, 11], [14, 17]].map((segment, index) => ({
          UUID: `selfpromo-${index}`, actionType: 'skip', category: 'selfpromo', segment
        })),
        { UUID: 'highlight', actionType: 'poi', category: 'poi_highlight', segment: [12, 12] }
      ].map(segment => ({ videoDuration: DEMO_MEDIA_DURATION_SECONDS, votes: 1, locked: 0, description: '', ...segment }))
    }]),
    contentType: 'application/json'
  }))
  const video = await openMockedVideo(page)
  await video.evaluate(element => {
    element.pause()
    element.currentTime = 7
    element.style.opacity = '0'
    Object.defineProperty(element, 'buffered', {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 13 })
    })
  })
  const player = page.locator('.ftVideoPlayer')
  const track = player.locator('.shaka-seek-bar-container')
  const markers = track.locator('.sponsorBlockMarker')
  await expect(markers).toHaveCount(4)
  await expect(markers.first()).toHaveCSS('background-color', 'rgb(255, 235, 59)')
  await expect(track.locator('.sponsorBlockPointMarker')).toHaveCSS('background-color', 'rgb(38, 166, 154)')
  await player.hover()
  await waitForTrack(7)
  async function expectMarkerColors(played = 7, bufferedStart = 0, bufferedEnd = 13) {
    const { points, colors, times } = await markers.evaluateAll(markers => {
      const trackElement = markers[0].closest('.shaka-seek-bar-container')
      const track = trackElement.getBoundingClientRect()
      const duration = trackElement.closest('.ftVideoPlayer').querySelector('video').duration
      const points = []
      const colors = []
      const times = []
      markers.forEach(marker => {
        const bounds = marker.getBoundingClientRect()
        const color = getComputedStyle(marker).backgroundColor.match(/\d+/g).map(Number)
        const startPercent = Number(marker.style.left.match(/[\d.]+/)[0])
        const widthPercent = parseFloat(marker.style.width) || 0
        // Stay clear of the thumb shadow when it splits the middle segment.
        for (const fraction of marker.classList.contains('sponsorBlockPointMarker') ? [0.5] : [0.1, 0.9]) {
          points.push([bounds.left + bounds.width * fraction - track.left, bounds.top + bounds.height / 2 - track.top])
          colors.push(color)
          times.push((startPercent + widthPercent * fraction) / 100 * duration)
        }
      })
      return { points, colors, times }
    })
    const actual = await sampleColors(app, track, points)
    for (const [index, color] of colors.entries()) {
      const time = times[index]
      const brightness = time < played ? 0.65 : time >= bufferedStart && time < bufferedEnd ? 1 : 0.85
      const expected = color.map(channel => Math.round(channel * brightness))
      // GPU gradient dithering can round a shaded channel by one level.
      expect(Math.max(...expected.map((channel, component) => Math.abs(actual[index][component] - channel))),
        JSON.stringify({ time, played, bufferedStart, bufferedEnd, actual: actual[index], expected })).toBeLessThanOrEqual(1)
    }
    return actual
  }

  async function waitForTrack(played, bufferedStart = 0, bufferedEnd = 13) {
    await expect.poll(() => track.locator('input').inputValue()).toBe(String(played))
    await expect.poll(() => track.evaluate((element, expected) => {
      const stops = [...getComputedStyle(element).backgroundImage.matchAll(/(-?[\d.]+)%/g)].map(stop => Number(stop[1]))
      const duration = element.closest('.ftVideoPlayer').querySelector('video').duration
      return Math.max(...[stops[0], stops[2], stops[4]].map((stop, index) => Math.abs(stop - expected[index] / duration * 100)))
    }, [bufferedStart, played, bufferedEnd])).toBeLessThan(0.01)
  }

  return { video, player, track, markers, waitForTrack, expectMarkerColors }
}

test('SponsorBlock markers stay visible on unbuffered track and distinguish played portions', async ({ app, page }, testInfo) => {
  const { video, player, track, waitForTrack, expectMarkerColors } = await prepareMarkers(app, page)
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
    for (const [width, scale] of [[1000, 1], [420, 1.25]]) {
      await app.electronApp.evaluate(({ BrowserWindow }, scale) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale)
      }, scale)
      await player.evaluate((element, width) => { element.style.width = `${width}px` }, width)
      await video.evaluate(element => { element.currentTime = 7 })
      await player.hover()
      await waitForTrack(7)
      for (const background of ['#000', '#fff', 'repeating-linear-gradient(110deg, #fafafa 0 18px, #142b43 18px 36px)']) {
        await player.evaluate((element, background) => { element.style.background = background }, background)
        await player.hover()
        await track.locator('input').focus()
        await track.screenshot({ path: testInfo.outputPath(`markers-${scheme}-${width}.png`) })
        const colors = await expectMarkerColors()
        // Keep unbuffered yellow readable while making played portions subdued.
        expect(colors[5][0]).toBeGreaterThanOrEqual(190)
        expect(colors[5][1]).toBeGreaterThanOrEqual(175)
        expect(colors[0][1]).toBeLessThan(colors[2][1] - 25)
        expect(colors[0]).not.toEqual(colors[2])
        if (width === 1000 && background === '#000') {
          const box = await player.boundingBox()
          await page.screenshot({
            path: testInfo.outputPath(`controls-${scheme}.png`),
            clip: { x: box.x, y: box.y + box.height - 100, width: box.width, height: 100 }
          })
        }
      }
      await player.evaluate(element => { element.style.background = '#000' })
      for (const time of [9.5, 18, 1]) {
        await video.evaluate((element, time) => { element.currentTime = time }, time)
        await waitForTrack(time)
        await expectMarkerColors(time)
        if (time === 9.5 && width === 1000) {
          const box = await player.boundingBox()
          await page.screenshot({
            path: testInfo.outputPath(`partial-segment-${scheme}.png`),
            clip: { x: box.x, y: box.y + box.height - 100, width: box.width, height: 100 }
          })
        }
      }
    }
  }
  await video.evaluate(element => { element.currentTime = 7 })
  await waitForTrack(7)
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
  })
  await player.evaluate(element => { element.style.width = '1000px' })
  async function setBuffer(start, end) {
    await video.evaluate((element, [start, end]) => {
      Object.defineProperty(element, 'buffered', {
        configurable: true,
        get: () => ({ length: 1, start: () => start, end: () => end })
      })
      element.dispatchEvent(new Event('progress'))
    }, [start, end])
  }
  // The middle range splits at both the playhead and the moving buffer boundary.
  for (const [time, start, end] of [[7, 0, 9.5], [9.5, 0, 13], [7, 10, 13], [7, 0, 18]]) {
    await setBuffer(start, end)
    await video.evaluate((element, time) => { element.currentTime = time }, time)
    await waitForTrack(time, start, end)
    await expectMarkerColors(time, start, end)
  }
  await video.evaluate(element => {
    element.currentTime = 1
    Object.defineProperty(element, 'buffered', {
      configurable: true,
      get: () => ({ length: 2, start: index => [0, 10][index], end: index => [5, 13][index] })
    })
  })
  await waitForTrack(1)
  const input = track.locator('input')
  const bounds = await input.boundingBox()
  const fraction = await video.evaluate(element => 7 / element.duration)
  await page.mouse.move(bounds.x + 6 + (bounds.width - 12) * fraction, bounds.y + bounds.height / 2)
  await page.mouse.down()
  const target = Number(await input.inputValue())
  // While dragging through a buffer gap, Shaka collapses the buffered range to the target.
  await waitForTrack(target, target, target)
  await expectMarkerColors(target, target, target)
  await page.mouse.up()
  await waitForTrack(target)
  await expectMarkerColors(target)
})

test('SponsorBlock markers preserve category hues across accent colors', async ({ app, page }, testInfo) => {
  const { player, track, markers, expectMarkerColors } = await prepareMarkers(app, page)
  await player.evaluate(element => { element.style.width = '1000px'; element.style.background = '#000' })
  for (const accent of ['Red', 'Blue', 'Green']) {
    await page.evaluate(accent => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateMainColor', accent), accent)
    await player.hover()
    // Theme/size changes rebuild Shaka's controls; wait for that layout before painting the color fixture.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // Exercise category colors independently of the accent beneath the markers.
    for (const color of ['#4caf50', '#e91e63', '#2196f3', '#ffeb3b', '#26a69a']) {
      await markers.evaluateAll((markers, color) => markers.forEach(marker => {
        marker.classList.remove('mainYellow')
        marker.style.setProperty('--primary-color', color)
      }), color)
      await expect(markers.first()).toHaveCSS('background-color', `rgb(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)})`)
      await expectMarkerColors()
      await track.screenshot({ path: testInfo.outputPath(`palette-${accent}-${color.slice(1)}.png`) })
    }
  }
})
